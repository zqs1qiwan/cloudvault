import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('light/dark theme parity', () => {
  it('compiles accent utilities from the theme variables instead of baking in cyan', () => {
    const css = read('public/css/tailwind.css');
    expect(css).toContain('rgb(var(--color-primary-channels)');
    expect(css).toContain('rgb(var(--color-primary-strong-channels)');
  });

  it('does not leave fixed Tailwind grays on theme-aware pages', () => {
    const files = ['public/dashboard.html', 'public/guest.html', 'public/share.html', 'public/js/share.js'];
    for (const file of files) {
      const source = read(file);
      expect(source, `${file} still uses a fixed gray surface`).not.toMatch(
        /\b(?:text|bg|border|hover:bg|hover:text)-gray-\d/,
      );
    }
  });

  it('styles native selects and follows the active colour scheme', () => {
    const css = read('public/css/app.css');
    expect(css).toMatch(/html\.light\s*\{[\s\S]*?color-scheme:\s*light/);
    expect(css).toMatch(/select\s*\{[\s\S]*?background:\s*var\(--bg-primary\)/);
    expect(css).toContain('select option { background: var(--bg-secondary)');
  });

  it('keeps light-theme control tokens above the background', () => {
    const css = read('public/css/app.css');
    expect(css).toContain('--switch-off');
    expect(css).toContain('--warning-bg');
    expect(css).toMatch(/html\.light\s*\{[\s\S]*?--danger:/);
    expect(css).toMatch(/html\.light\s*\{[\s\S]*?--success:/);
  });
});
