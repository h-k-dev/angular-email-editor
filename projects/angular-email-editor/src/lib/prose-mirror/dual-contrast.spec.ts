import {
  DUAL_CONTRAST_DARK,
  DUAL_CONTRAST_LIGHT,
  FILL_TEXT_COLOR,
  FILL_TEXT_COLOR_LIGHT,
  FILL_TEXT_COLOR_RGB,
  contrastRatio,
  emailBackgroundPalette,
  emailTextPalette,
  fillTextColor,
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
    for (const color of emailTextPalette.filter(({ exception }) => !exception)) {
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

  it('offers black and white as exceptions on record — each one really fails the rule', () => {
    const exceptions = emailTextPalette.filter(({ exception }) => exception);
    expect(exceptions.map(({ name }) => name)).toEqual(['Black', 'White']);
    for (const color of exceptions) {
      expect(passesDualContrast(color.value), color.name).toBe(false);
    }
  });
});

describe('dual-contrast backgrounds', () => {
  it('rejects mid-tone fills that neither paired text survives', () => {
    expect(passesDualBackground('#808080')).toBe(false); // neither text reads on it
    expect(passesDualBackground('#e53935')).toBe(false); // white only reaches 4.2:1
    expect(passesDualBackground('#2196f3')).toBe(false); // reads now, not once inverted
  });

  it('pairs a pale fill with near-black text and a dark one with white', () => {
    expect(fillTextColor('#fef7e0')).toBe(FILL_TEXT_COLOR);
    expect(fillTextColor('#ffffff')).toBe(FILL_TEXT_COLOR);
    expect(fillTextColor('#202124')).toBe(FILL_TEXT_COLOR_LIGHT);
    // The CSSOM's form, as a parsed style hands it over.
    expect(fillTextColor('rgb(32, 33, 36)')).toBe(FILL_TEXT_COLOR_LIGHT);
    expect(fillTextColor('#000')).toBe(FILL_TEXT_COLOR_LIGHT);
    // A colour this cannot read keeps the near-black it always had.
    expect(fillTextColor('black')).toBe(FILL_TEXT_COLOR);
  });

  it('every background fill carries its paired text now and after inversion', () => {
    for (const color of emailBackgroundPalette) {
      expect(passesDualBackground(color.value), `${color.name} dual-safe`).toBe(true);
      // The concrete pair every fill ships with: AA body text in light mode.
      expect(
        contrastRatio(color.value, fillTextColor(color.value)),
        `${color.name} vs paired text`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(emailBackgroundPalette.map(({ name }) => name)).toContain('White');
    expect(emailBackgroundPalette.map(({ name }) => name)).toContain('Black');
  });

  it("recognises a fill's paired text in hex and CSSOM rgb form only", () => {
    const pale = 'rgb(254, 247, 224)';
    expect(isFillTextColor(FILL_TEXT_COLOR, pale)).toBe(true);
    expect(isFillTextColor(FILL_TEXT_COLOR_RGB, pale)).toBe(true);
    expect(isFillTextColor('rgb(32,33,36)', pale)).toBe(false); // not a CSSOM serialisation
    expect(isFillTextColor('#202125', pale)).toBe(false);
    expect(isFillTextColor(null, pale)).toBe(false);
    // White is the dark fill's pair — and an authored colour on a pale one.
    expect(isFillTextColor('rgb(255, 255, 255)', 'rgb(32, 33, 36)')).toBe(true);
    expect(isFillTextColor('rgb(255, 255, 255)', pale)).toBe(false);
    expect(isFillTextColor(FILL_TEXT_COLOR_RGB, 'rgb(32, 33, 36)')).toBe(false);
  });
});
