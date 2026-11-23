import { describe, expect, it } from 'vitest';
import {
  FOLDER_MARKER,
  ancestorFolders,
  buildObjectKey,
  davPathToKey,
  folderMarkerKey,
  folderOf,
  folderOfMarkerKey,
  isMarkerKey,
  isUnder,
  keyToDavHref,
  nameOf,
  normalizeFolder,
  parentFolder,
  validateFileName,
} from '../src/lib/paths';
import { contentDisposition, sanitizeEntryName } from '../src/lib/mime';
import { parseSingleRange } from '../src/lib/http';
import { uniqueEntryNames } from '../src/lib/zip';

describe('object keys', () => {
  it('treats root as no prefix at all', () => {
    expect(buildObjectKey('root', 'notes..txt')).toBe('notes..txt');
    expect(buildObjectKey('', 'notes.txt')).toBe('notes.txt');
    expect(buildObjectKey('docs/2026', 'report.pdf')).toBe('docs/2026/report.pdf');
  });

  it('rejects ambiguous segments instead of silently repairing them', () => {
    expect(() => normalizeFolder('../private')).toThrow();
    expect(() => normalizeFolder('docs//2026')).toThrow();
    expect(() => normalizeFolder('docs/')).toThrow();
    expect(() => buildObjectKey('docs', '../a.txt')).toThrow();
    expect(() => buildObjectKey('docs', 'a/b.txt')).toThrow();
    expect(() => validateFileName(FOLDER_MARKER)).toThrow('Reserved file name');
  });

  it('derives folder and name from the key both ways', () => {
    expect(folderOf('a/b/c.txt')).toBe('a/b');
    expect(folderOf('c.txt')).toBe('root');
    expect(nameOf('a/b/c.txt')).toBe('c.txt');
    expect(parentFolder('a/b')).toBe('a');
    expect(parentFolder('a')).toBe('root');
    expect(ancestorFolders('a/b/c')).toEqual(['a', 'a/b', 'a/b/c']);
  });

  it('knows what a folder marker is', () => {
    expect(folderMarkerKey('a/b')).toBe('a/b/.cv-folder');
    expect(isMarkerKey('a/b/.cv-folder')).toBe(true);
    expect(isMarkerKey('a/b/real.txt')).toBe(false);
    expect(folderOfMarkerKey('a/b/.cv-folder')).toBe('a/b');
    expect(folderOfMarkerKey('plain.txt')).toBeNull();
  });

  it('matches folders by segment, not by string prefix', () => {
    expect(isUnder('a/b', 'a')).toBe(true);
    expect(isUnder('a', 'a')).toBe(true);
    expect(isUnder('ab', 'a')).toBe(false);
    expect(isUnder('a/b', 'root')).toBe(true);
  });

  it('round-trips WebDAV paths through encoding', () => {
    expect(davPathToKey('a%20b/c.txt/')).toBe('a%20b/c.txt');
    expect(davPathToKey('')).toBe('');
    expect(keyToDavHref('a b/c.txt')).toBe('/dav/a%20b/c.txt');
    expect(keyToDavHref('docs', true)).toBe('/dav/docs/');
    expect(keyToDavHref('')).toBe('/dav/');
    expect(() => davPathToKey('a//b')).toThrow();
    expect(() => davPathToKey('a/../b')).toThrow();
  });
});

describe('range parsing', () => {
  it('accepts the single ranges a player actually sends', () => {
    expect(parseSingleRange('bytes=0-9', 100)).toEqual({ offset: 0, length: 10 });
    expect(parseSingleRange('bytes=90-', 100)).toEqual({ offset: 90, length: 10 });
    expect(parseSingleRange('bytes=-10', 100)).toEqual({ offset: 90, length: 10 });
    expect(parseSingleRange('bytes=0-999', 100)).toEqual({ offset: 0, length: 100 });
  });

  it('refuses anything it cannot serve exactly', () => {
    expect(parseSingleRange('bytes=100-', 100)).toBeNull();
    expect(parseSingleRange('bytes=9-5', 100)).toBeNull();
    expect(parseSingleRange('bytes=0-1,5-6', 100)).toBeNull();
    expect(parseSingleRange('items=0-1', 100)).toBeNull();
    expect(parseSingleRange('bytes=0-1', 0)).toBeNull();
  });
});

describe('download headers and zip entry names', () => {
  it('writes an RFC 6266 disposition with an ASCII fallback', () => {
    const header = contentDisposition('attachment', '报告 2026.pdf');
    expect(header).toContain('attachment; filename="__ 2026.pdf"');
    expect(header).toContain("filename*=UTF-8''%E6%8A%A5%E5%91%8A%202026.pdf");
    expect(contentDisposition('inline', 'a"b\nc.txt')).not.toMatch(/[\r\n]/);
  });

  it('strips traversal out of zip entry names', () => {
    expect(sanitizeEntryName('../etc/passwd')).toBe('etc/passwd');
    expect(sanitizeEntryName('a\\b/c.txt')).toBe('a/b/c.txt');
    expect(sanitizeEntryName('/a//b.txt')).toBe('a/b.txt');
  });

  it('de-duplicates colliding names instead of failing the archive', () => {
    expect(uniqueEntryNames(['a.txt', 'a.txt', 'a.txt'])).toEqual(['a.txt', 'a (1).txt', 'a (2).txt']);
    expect(uniqueEntryNames(['x/a.txt', 'y/a.txt'])).toEqual(['x/a.txt', 'y/a.txt']);
    expect(uniqueEntryNames(['../a.txt', '../a.txt'])).toEqual(['a.txt', 'a (1).txt']);
  });
});
