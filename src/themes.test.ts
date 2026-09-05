import { describe, expect, it } from 'vitest';
import { THEMES } from './themes';

function channel(value: string): number {
  const normalized = Number.parseInt(value, 16) / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.slice(1);
  return 0.2126 * channel(value.slice(0, 2)) + 0.7152 * channel(value.slice(2, 4)) + 0.0722 * channel(value.slice(4, 6));
}

function contrast(a: string, b: string): number {
  const [bright, dark] = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (bright + 0.05) / (dark + 0.05);
}

describe('color themes', () => {
  it('contains 30 uniquely named themes', () => {
    expect(THEMES).toHaveLength(40);
    expect(new Set(THEMES.map(({ id }) => id)).size).toBe(40);
    expect(new Set(THEMES.map(({ name }) => name)).size).toBe(40);
  });

  it('keeps body and primary button text readable', () => {
    THEMES.forEach(({ colors }) => {
      expect(contrast(colors.ink, colors.surface)).toBeGreaterThanOrEqual(7);
      expect(contrast(colors.accentStrong, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    });
  });
});
