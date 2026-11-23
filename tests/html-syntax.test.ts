import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('HTML inline scripts', () => {
  for (const name of readdirSync('public').filter((file) => file.endsWith('.html'))) {
    it(`${name} contains valid JavaScript`, () => {
      const html = readFileSync(join('public', name), 'utf8');
      const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
      for (const [, source] of scripts) {
        expect(() => new Function(source)).not.toThrow();
      }
    });
  }

  it('uses the generated Tailwind stylesheet instead of the runtime CDN', () => {
    const pages = readdirSync('public').filter((file) => file.endsWith('.html'));
    for (const name of pages) {
      const html = readFileSync(join('public', name), 'utf8');
      expect(html).toContain('/css/tailwind.css');
      expect(html).not.toContain('cdn.tailwindcss.com');
    }
    expect(readFileSync('public/css/tailwind.css', 'utf8').length).toBeGreaterThan(1000);
  });

  it('marks file search fields as search-only inputs', () => {
    for (const name of ['dashboard.html', 'guest.html']) {
      const html = readFileSync(join('public', name), 'utf8');
      expect(html).toMatch(/type="search"[^>]*autocomplete="off"/);
      expect(html).toContain('data-1p-ignore');
      expect(html).toContain('data-lpignore="true"');
    }
    const dashboard = readFileSync(join('public', 'dashboard.html'), 'utf8');
    expect(dashboard).toContain('role="search"');
    expect(dashboard).toMatch(/id="file-search"[^>]*readonly[^>]*onfocus="this\.removeAttribute\('readonly'\)"/);
  });

  it('draws every share link icon with the canonical Heroicons link path', () => {
    const canonical =
      'M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244';
    const pages = readdirSync('public').filter((file) => file.endsWith('.html'));
    let found = 0;
    for (const name of pages) {
      const html = readFileSync(join('public', name), 'utf8');
      for (const match of html.matchAll(/<path[^>]*\bd="(M13\.19 8\.688[^"]*)"/g)) {
        found += 1;
        expect(match[1], `${name} has a malformed share link icon`).toBe(canonical);
      }
    }
    expect(found).toBeGreaterThanOrEqual(5);
  });

  it('gives Chrome a dedicated username field on the login form', () => {
    const html = readFileSync(join('public', 'login.html'), 'utf8');
    expect(html).toMatch(/name="username"[\s\S]*?autocomplete="username"/);
    expect(html).toMatch(/name="password"[\s\S]*?autocomplete="current-password"/);
  });

  it('ships brand metadata, icons and the language switch on every page', () => {
    const pages = readdirSync('public').filter((file) => file.endsWith('.html'));
    for (const name of pages) {
      const html = readFileSync(join('public', name), 'utf8');
      expect(html, `${name} must load the UI language layer`).toContain('/js/i18n.js');
      expect(html, `${name} must expose a language switch`).toContain('data-lang-toggle');
      expect(html, `${name} must declare a favicon`).toContain('rel="icon"');
      expect(html, `${name} must declare an Apple touch icon`).toContain('rel="apple-touch-icon"');
      expect(html, `${name} must declare the web app manifest`).toContain('rel="manifest"');
      expect(html, `${name} must declare a social preview image`).toContain('property="og:image"');
    }
    for (const file of [
      'public/favicon.svg',
      'public/favicon.ico',
      'public/apple-touch-icon.png',
      'public/icon-192.png',
      'public/icon-512.png',
      'public/og-image.png',
      'public/manifest.webmanifest',
      'public/brand/cloudvault-mark.svg',
      'public/brand/cloudvault-lockup-dark.svg',
      'public/brand/cloudvault-lockup-light.svg',
    ]) {
      expect(readFileSync(file).length, `${file} must not be empty`).toBeGreaterThan(200);
    }
  });

  it('links the English and Chinese README versions to each other', () => {
    const en = readFileSync('README.md', 'utf8');
    const zh = readFileSync('README.zh-CN.md', 'utf8');
    expect(en).toContain('[中文](README.zh-CN.md)');
    expect(zh).toContain('[English](README.md)');
    expect(en).toContain('public/brand/cloudvault-lockup-light.svg');
    expect(zh).toContain('public/brand/cloudvault-lockup-light.svg');
  });
});
