import {
  DARK_MODE_SURFACES,
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

/** Gmail's forced inversion, as the preview draws it: `invert(1)
    hue-rotate(180deg)`, channel by channel. */
function inverted(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => 255 - c);
  const rows = [
    [-0.574, 1.43, 0.144],
    [0.426, 0.43, 0.144],
    [0.426, 1.43, -0.856],
  ];
  return (
    '#' +
    rows
      .map(([x, y, z]) => Math.round(Math.max(0, Math.min(255, x * r + y * g + z * b))))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
  );
}

describe('dark-mode variants', () => {
  const paleFills = emailBackgroundPalette.filter(({ dark }) => dark);
  const darkFills = paleFills.map(({ dark }) => dark!);
  const coloured = emailTextPalette.filter(({ exception }) => !exception);
  const black = emailTextPalette.find(({ name }) => name === 'Black')!;

  it('every colour but white has a variant, and every fill but black', () => {
    expect(emailTextPalette.filter(({ dark }) => !dark).map(({ name }) => name)).toEqual(['White']);
    expect(emailBackgroundPalette.filter(({ dark }) => !dark).map(({ name }) => name)).toEqual([
      'Black',
    ]);
  });

  it('every colour reads at AA on white and on every pale fill', () => {
    for (const color of coloured) {
      for (const fill of paleFills) {
        expect(
          contrastRatio(color.value, fill.value),
          `${color.name} on ${fill.name}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('every colour reads at AA once Gmail inverts it', () => {
    for (const color of coloured) {
      expect(
        contrastRatio(inverted(color.value), inverted('#ffffff')),
        color.name,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('every variant reads at AA on each dark page and on every dark fill', () => {
    for (const color of coloured) {
      for (const surface of [...DARK_MODE_SURFACES, ...darkFills]) {
        expect(
          contrastRatio(color.dark!, surface),
          `${color.name} variant on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('black is the body text: AAA on every light surface and, as its variant, on every dark one', () => {
    for (const fill of paleFills) {
      expect(contrastRatio(black.value, fill.value), fill.name).toBeGreaterThanOrEqual(7);
    }
    for (const surface of [...DARK_MODE_SURFACES, ...darkFills]) {
      expect(contrastRatio(black.dark!, surface), surface).toBeGreaterThanOrEqual(7);
    }
    expect(contrastRatio(inverted(black.value), inverted('#ffffff'))).toBeGreaterThanOrEqual(7);
  });

  it('every fill carries its paired text at AAA in both modes', () => {
    for (const fill of emailBackgroundPalette) {
      const text = fillTextColor(fill.value);
      expect(contrastRatio(fill.value, text), `${fill.name} light`).toBeGreaterThanOrEqual(7);
      const textDark = emailTextPalette.find(({ value }) => value === text)?.dark ?? text;
      expect(
        contrastRatio(fill.dark ?? fill.value, textDark),
        `${fill.name} dark`,
      ).toBeGreaterThanOrEqual(7);
    }
  });
});
