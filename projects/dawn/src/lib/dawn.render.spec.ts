/**
 * Dawn, in real Chromium — `npm run test:render`: the invert-lightness
 * transform, worked through by hand from its matrix, and the message it is
 * drawn on.
 */
import { DAWN_SURFACE, dawnDarkColor, invertLightness } from './color';
import { renderDawn } from './render';

const doc = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('Dawn (render)', () => {
  it('draws colours as WebKit does: white to #333333, black to white, a hue kept', () => {
    // White: no hue to turn; each row’s sum plus its offset of 1 — 0.2.
    expect(dawnDarkColor('#ffffff')).toBe('rgb(51, 51, 51)');
    // Black: only the offsets.
    expect(dawnDarkColor('#000000')).toBe('rgb(255, 255, 255)');
    // Red: turned to cyan (0, 1, 1), then the matrix — a light red.
    expect(dawnDarkColor('#ff0000')).toBe('rgb(247, 43, 43)');
    // Alpha passes through.
    expect(invertLightness([1, 1, 1, 0.5])[3]).toBe(0.5);
  });

  it('draws a message that declares nothing dark, on the dark surface', () => {
    const html = renderDawn(
      '<table bgcolor="#ffffff"><tr><td style="color: #000000">Hi</td></tr></table>' +
        '<img src="photo.png" style="border: 0">',
      { scheme: 'dark' },
    );
    const drawn = doc(html);
    expect(drawn.querySelector('table')?.getAttribute('bgcolor')).toBe('#333333');
    expect(drawn.querySelector('td')?.getAttribute('style')).toBe('color: rgb(255, 255, 255)');
    // A picture is not a colour: untouched.
    expect(drawn.querySelector('img')?.getAttribute('src')).toBe('photo.png');
    expect(html).toContain(`html { background: ${DAWN_SURFACE.dark}; }`);
    expect(html).not.toContain('invert(');
  });

  it('draws a message that declares dark with its own dark rules, untouched', () => {
    const html = renderDawn(
      '<!doctype html><html><head><meta name="color-scheme" content="light dark">' +
        '<style>@media (prefers-color-scheme: dark) { .t { color: #eeeeee } }</style></head>' +
        '<body><p class="t" style="color: #111111">Hi</p></body></html>',
      { scheme: 'dark' },
    );
    expect(doc(html).querySelector('p')?.getAttribute('style')).toBe('color: #111111');
    expect(html).toContain('(min-width: 0px)');
  });

  it('writes nothing dark into a fragment: dark is drawn, never sent', () => {
    // The library's own dark-mode classes would make the fragment declare
    // dark, and Dawn would then leave its colours alone.
    const html = renderDawn('<p style="color: #202124">Hi</p>', { scheme: 'dark' });
    expect(html).not.toContain('aee-dt-');
    expect(doc(html).querySelector('p')?.getAttribute('style')).toBe(
      `color: ${dawnDarkColor('#202124')}`,
    );
  });

  it('lies on its light surface in light, the email as it is', () => {
    const html = renderDawn('<p style="color: #202124">x</p>', { scheme: 'light' });
    expect(html).toContain(`background: ${DAWN_SURFACE.light}`);
    expect(doc(html).querySelector('p')?.getAttribute('style')).toBe('color: #202124');
  });
});
