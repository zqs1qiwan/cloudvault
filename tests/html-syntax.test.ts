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
});
