import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FILES = [
  'public/brand/cloudvault-mark.svg',
  'public/brand/cloudvault-mark-small.svg',
  'public/brand/cloudvault-lockup-light.svg',
  'public/brand/cloudvault-lockup-dark.svg',
  'public/favicon.svg',
];

const ORANGE = '#F38020';
const INK = '#0B1018';
const WHITE = '#FFFFFF';

describe('brand artwork', () => {
  it('stays flat: at most two colours, no gradients or filters', () => {
    for (const file of FILES) {
      const svg = readFileSync(file, 'utf8');
      expect(svg, `${file} must not use gradients`).not.toMatch(/gradient/i);
      expect(svg, `${file} must not use filters`).not.toMatch(/filter|drop-shadow/i);
      expect(svg, `${file} must not use opacity`).not.toMatch(/opacity/i);

      const colours = new Set(svg.match(/#[0-9a-f]{6}/gi)?.map((value) => value.toUpperCase()) ?? []);
      expect(colours.has(ORANGE), `${file} must use Cloudflare orange`).toBe(true);
      for (const colour of colours) {
        expect([ORANGE, INK, WHITE], `${file} uses ${colour}`).toContain(colour);
      }
      expect(colours.size, `${file} must use no more than two colours`).toBeLessThanOrEqual(2);
    }
  });

  it('keeps the orange cloud and the two-tone wordmark in every lockup', () => {
    for (const file of ['public/brand/cloudvault-lockup-light.svg', 'public/brand/cloudvault-lockup-dark.svg']) {
      const svg = readFileSync(file, 'utf8');
      expect(svg).toContain('CloudVault');
      expect(svg).toContain('M140 360');
      expect(svg).toContain('<tspan fill="#F38020">Cloud</tspan>Vault');
    }
  });
});
