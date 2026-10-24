/**
 * Dawn dark, in real Chromium — `npm run test:render`: the invert-lightness
 * transform, worked through by hand from its matrix, and the message it is
 * applied to.
 */
import { PAPER } from './dawn.render';
import {
  DAWN_DARK_SURFACE,
  dawnDarkColor,
  dawnDarkDeclarations,
  dawnDarkStyleSheet,
  declaresDark,
  invertLightness,
  parseColor,
  renderDawnDark,
} from './dawn-dark.render';

const doc = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('Dawn dark (render)', () => {
  it('turns colours as WebKit does: white to #333333, black to white, a hue kept', () => {
    // White: no hue to turn; each row’s sum plus its offset of 1 — 0.2.
    expect(dawnDarkColor('#ffffff')).toBe('rgb(51, 51, 51)');
    // Black: only the offsets.
    expect(dawnDarkColor('#000000')).toBe('rgb(255, 255, 255)');
    // Red: turned to cyan (0, 1, 1), then the matrix — a light red.
    expect(dawnDarkColor('#ff0000')).toBe('rgb(247, 43, 43)');
    // Alpha passes through.
    expect(invertLightness([1, 1, 1, 0.5])[3]).toBe(0.5);
  });

  it('reads every colour CSS writes: names, short and long hex, rgb() and hsl()', () => {
    expect(parseColor('White')).toEqual([1, 1, 1, 1]);
    expect(parseColor('#fff')).toEqual([1, 1, 1, 1]);
    expect(parseColor('#ff000080')?.[3]).toBeCloseTo(0.502, 3);
    expect(parseColor('rgb(255, 0, 0)')).toEqual([1, 0, 0, 1]);
    expect(parseColor('rgba(0 0 0 / 50%)')).toEqual([0, 0, 0, 0.5]);
    expect(parseColor('hsl(0, 100%, 50%)')?.slice(0, 3)).toEqual([1, 0, 0]);
    expect(parseColor('url(a.png)')).toBeNull();
  });

  it('filters the colours a declaration paints, and nothing else', () => {
    expect(
      dawnDarkDeclarations(
        'color: #000; background: url(white.png) #ffffff; font-family: Tan, serif; width: 600px',
      ),
    ).toBe(
      'color: rgb(255, 255, 255); background: url(white.png) rgb(51, 51, 51); font-family: Tan, serif; width: 600px',
    );
  });

  it('filters a style sheet’s declarations, never its selectors', () => {
    // The sheet's own spacing stays as it was.
    expect(
      dawnDarkStyleSheet(
        '#abc { color: black } @media (max-width: 480px) { .a { border: 1px solid white } }',
      ),
    ).toBe(
      '#abc { color: rgb(255, 255, 255) } @media (max-width: 480px) { .a { border: 1px solid rgb(51, 51, 51) } }',
    );
  });

  it('knows a message that handles dark itself, by its meta or its CSS', () => {
    expect(declaresDark(doc('<meta name="color-scheme" content="light dark"><p>x</p>'))).toBe(true);
    expect(declaresDark(doc('<style>:root { supported-color-schemes: light dark; }</style>'))).toBe(true);
    expect(declaresDark(doc('<meta name="color-scheme" content="light"><p>x</p>'))).toBe(false);
    expect(declaresDark(doc('<p style="color: red">x</p>'))).toBe(false);
  });

  it('turns a message that declares nothing, on the dark surface', () => {
    const html = renderDawnDark(
      '<table bgcolor="#ffffff"><tr><td style="color: #000000">Hi</td></tr></table>' +
        '<img src="photo.png" style="border: 0">',
      { dark: true },
    );
    const drawn = doc(html);
    expect(drawn.querySelector('table')?.getAttribute('bgcolor')).toBe('#333333');
    expect(drawn.querySelector('td')?.getAttribute('style')).toBe('color: rgb(255, 255, 255)');
    // A picture is not a colour: untouched.
    expect(drawn.querySelector('img')?.getAttribute('src')).toBe('photo.png');
    expect(html).toContain(`html { background: ${DAWN_DARK_SURFACE}; }`);
    expect(html).not.toContain('invert(');
  });

  it('draws a message that declares dark with its own dark rules, unfiltered', () => {
    const html = renderDawnDark(
      '<!doctype html><html><head><meta name="color-scheme" content="light dark">' +
        '<style>@media (prefers-color-scheme: dark) { .t { color: #eeeeee } }</style></head>' +
        '<body><p class="t" style="color: #111111">Hi</p></body></html>',
      { dark: true },
    );
    expect(doc(html).querySelector('p')?.getAttribute('style')).toBe('color: #111111');
    expect(html).toContain('(min-width: 0px)');
  });

  it('is the paper the editor writes on: the surfaces are the paper’s colours', () => {
    expect(DAWN_DARK_SURFACE).toBe(PAPER.dark);
    expect(renderDawnDark('<p>x</p>')).toContain(`background: ${PAPER.light}`);
  });
});
