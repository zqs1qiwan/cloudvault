import { describe, expect, it } from 'vitest';
import { isStaticAsset } from '../src/lib/http';

describe('static asset routing', () => {
  it('serves the brand files', () => {
    expect(isStaticAsset('/favicon.svg')).toBe(true);
    expect(isStaticAsset('/brand/cloudvault-mark.png')).toBe(true);
    expect(isStaticAsset('/og-image.png')).toBe(true);
  });

  it('keeps HTML on the Worker routes', () => {
    expect(isStaticAsset('/login.html')).toBe(false);
    expect(isStaticAsset('/')).toBe(false);
  });

  it('is case-insensitive and ignores extensionless paths', () => {
    expect(isStaticAsset('/FAVICON.SVG')).toBe(true);
    expect(isStaticAsset('/js/i18n')).toBe(false);
  });
});
