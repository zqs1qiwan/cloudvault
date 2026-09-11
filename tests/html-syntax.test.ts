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
  });
});
