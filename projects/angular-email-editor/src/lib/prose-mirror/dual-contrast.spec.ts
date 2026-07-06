import {
  DUAL_CONTRAST_DARK,
  DUAL_CONTRAST_LIGHT,
  contrastRatio,
  emailTextPalette,
  passesDualContrast,
} from './dual-contrast';

describe('dual-contrast', () => {
  it('computes the canonical white/black ratio', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
  });

  it('rejects the extremes the inverters handle worst', () => {
    expect(passesDualContrast('#ffffff')).toBe(false); // invisible in light mode
    expect(passesDualContrast('#000000')).toBe(false); // invisible after inversion
    expect(passesDualContrast('#ffff00')).toBe(false); // classic light-mode disaster
  });

  it('every palette color reads against both references — proven, not promised', () => {
    for (const color of emailTextPalette) {
      expect(
        contrastRatio(color.value, DUAL_CONTRAST_LIGHT),
        `${color.name} vs light`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrastRatio(color.value, DUAL_CONTRAST_DARK),
        `${color.name} vs dark`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
