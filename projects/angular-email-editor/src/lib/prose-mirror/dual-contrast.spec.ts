import {
  DUAL_CONTRAST_DARK,
  DUAL_CONTRAST_LIGHT,
  FILL_TEXT_COLOR,
  FILL_TEXT_COLOR_RGB,
  contrastRatio,
  emailBackgroundPalette,
  emailTextPalette,
  isFillTextColor,
  passesDualBackground,
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

describe('dual-contrast backgrounds', () => {
  it('rejects fills that are not safe pale tints', () => {
    expect(passesDualBackground('#000000')).toBe(false); // not pale; black text invisible on it
    expect(passesDualBackground('#c5221f')).toBe(false); // saturated red: too dark to fill
    expect(passesDualBackground('#5f6368')).toBe(false); // a text-palette mid-tone is not a fill
  });

  it('every background fill carries its paired text now and after inversion', () => {
    for (const color of emailBackgroundPalette) {
      expect(passesDualBackground(color.value), `${color.name} dual-safe`).toBe(true);
      // The concrete pair every fill ships with: AA body text in light mode.
      expect(
        contrastRatio(color.value, FILL_TEXT_COLOR),
        `${color.name} vs paired text`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('recognises the paired fill text in hex and CSSOM rgb form only', () => {
    expect(isFillTextColor(FILL_TEXT_COLOR)).toBe(true);
    expect(isFillTextColor(FILL_TEXT_COLOR_RGB)).toBe(true);
    expect(isFillTextColor('rgb(32,33,36)')).toBe(false); // not a CSSOM serialisation
    expect(isFillTextColor('#202125')).toBe(false);
    expect(isFillTextColor(null)).toBe(false);
  });
});
