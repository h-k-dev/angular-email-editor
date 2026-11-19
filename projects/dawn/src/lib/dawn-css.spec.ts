import { dawnDarkColor, dawnStaysLight, parseCssColor } from './color';
import {
  dawnBandOf,
  dawnDarkDeclarations,
  dawnDarkDocument,
  dawnDarkDeclarationsOf,
  dawnDarkLegacyColor,
  dawnDarkStyleSheet,
  declaresDark,
} from './css';

const doc = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('Dawn on CSS', () => {
  it('reads every colour CSS writes: names, short and long hex, rgb() and hsl()', () => {
    expect(parseCssColor('White')).toEqual([1, 1, 1, 1]);
    expect(parseCssColor('#fff')).toEqual([1, 1, 1, 1]);
    expect(parseCssColor('#ff000080')?.[3]).toBeCloseTo(0.502, 3);
    expect(parseCssColor('rgb(255, 0, 0)')).toEqual([1, 0, 0, 1]);
    expect(parseCssColor('rgba(0 0 0 / 50%)')).toEqual([0, 0, 0, 0.5]);
    expect(parseCssColor('hsl(0, 100%, 50%)')?.slice(0, 3)).toEqual([1, 0, 0]);
    expect(parseCssColor('url(a.png)')).toBeNull();
  });

  it('leaves what is no colour as it was', () => {
    expect(dawnDarkColor('inherit')).toBe('inherit');
    expect(dawnDarkLegacyColor('none')).toBeNull();
    expect(dawnDarkLegacyColor('#ffffff')).toBe('#333333');
  });

  it('draws the colours a declaration paints dark, and nothing else', () => {
    expect(
      dawnDarkDeclarations(
        'color: #000; background: url(white.png) #ffffff; font-family: Tan, serif; width: 600px',
      ),
    ).toBe(
      'color: rgb(255, 255, 255); background: url(white.png) rgb(51, 51, 51); font-family: Tan, serif; width: 600px',
    );
    // Only what changes, for a sheet laid over the block.
    expect(dawnDarkDeclarationsOf('color:#000;width:1px;border:0')).toEqual([
      ['color', 'rgb(255, 255, 255)'],
    ]);
  });

  it('keeps what is dark already: a surface is never drawn lighter, ink never darker', () => {
    // An ink band and the white text on it, as written — a white logo on
    // the band stays readable.
    expect(dawnDarkDeclarations('background-color: #0f0f0f; color: #ffffff')).toBe(
      'background-color: #0f0f0f; color: #ffffff',
    );
    expect(dawnDarkDeclarationsOf('background-color: #0f0f0f; color: #ffffff')).toEqual([]);
    // A brand fill a turn would only lighten stays the brand's.
    expect(dawnDarkColor('#ff3c00', 'surface')).toBe('#ff3c00');
    // The other way round, both are drawn.
    expect(dawnDarkColor('#ffffff', 'surface')).toBe('rgb(51, 51, 51)');
    expect(dawnDarkColor('#121212', 'ink')).toBe('rgb(241, 241, 241)');
    // A border says nothing of what lies beneath it: always drawn.
    expect(dawnDarkDeclarations('border-top: 1px solid #000000')).toBe(
      'border-top: 1px solid rgb(255, 255, 255)',
    );
    // The legacy attributes, by what they paint.
    expect(dawnDarkLegacyColor('#0f0f0f', 'surface')).toBeNull();
    expect(dawnDarkLegacyColor('#ffffff', 'ink')).toBeNull();
    expect(dawnDarkLegacyColor('#ffffff', 'surface')).toBe('#333333');
  });

  it('draws a border by the band it lies on: as written on a kept one', () => {
    expect(dawnBandOf('background-color: #0f0f0f')).toBe('kept');
    expect(dawnBandOf('background: url(a.png) #ffffff')).toBe('drawn');
    expect(dawnBandOf('background-color: rgba(0, 0, 0, 0.1); color: #000')).toBeNull();
    // The block's own band first, else the one beneath it.
    expect(dawnDarkDeclarations('background: #0f0f0f; border: 1px solid #2a2a2a')).toBe(
      'background: #0f0f0f; border: 1px solid #2a2a2a',
    );
    expect(dawnDarkDeclarations('border-top: 1px solid #2a2a2a', 'kept')).toBe(
      'border-top: 1px solid #2a2a2a',
    );
    expect(dawnDarkDeclarations('border-top: 1px solid #000000', 'drawn')).toBe(
      'border-top: 1px solid rgb(255, 255, 255)',
    );
    // For a sheet over the block: a border with no band of its own comes
    // with what was written, for the page to choose by the band beneath.
    expect(dawnDarkDeclarationsOf('border-top: 1px solid #000000')).toEqual([
      ['border-top', '1px solid rgb(255, 255, 255)', '1px solid #000000'],
    ]);
    expect(dawnDarkDeclarationsOf('background: #fff; border-color: #000')).toEqual([
      ['background', 'rgb(51, 51, 51)'],
      ['border-color', 'rgb(255, 255, 255)'],
    ]);
  });

  it('finds the band of a whole message: the nearest fill at or above', () => {
    const message = doc(
      '<table><tr><td id="ink" style="background-color: #0f0f0f">' +
        '<p id="on-ink" style="border-top: 1px solid #2a2a2a">a</p>' +
        '<div style="background-color: #ffffff"><p id="on-card" style="border-top: 1px solid #000000">b</p></div>' +
        '</td></tr><tr><td bgcolor="#111111"><table id="legacy" bordercolor="#222222"></table></td></tr></table>' +
        '<p id="on-page" style="border-top: 1px solid #000000">c</p>',
    );
    dawnDarkDocument(message);
    const style = (id: string) => message.getElementById(id)?.getAttribute('style');
    expect(style('ink')).toBe('background-color: #0f0f0f');
    expect(style('on-ink')).toBe('border-top: 1px solid #2a2a2a');
    expect(style('on-card')).toBe('border-top: 1px solid rgb(255, 255, 255)');
    expect(style('on-page')).toBe('border-top: 1px solid rgb(255, 255, 255)');
    expect(message.getElementById('legacy')?.getAttribute('bordercolor')).toBe('#222222');
  });

  it('draws a style sheet’s declarations dark, never its selectors', () => {
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
    expect(declaresDark(doc('<style>:root { supported-color-schemes: light dark; }</style>'))).toBe(
      true,
    );
    expect(declaresDark(doc('<meta name="color-scheme" content="light"><p>x</p>'))).toBe(false);
    expect(declaresDark(doc('<p style="color: red">x</p>'))).toBe(false);
  });

  // A marker's yellow: WebKit's transform leaves it as bright as it was,
  // and the light ink dark writes with could not be read on it.
  describe('a background that stays light', () => {
    const YELLOW = 'background-color: rgb(255, 255, 0);';

    it('knows the few light colours dark leaves light — never a page’s white or grey', () => {
      expect(dawnStaysLight('#ffff00')).toBe(true);
      expect(dawnStaysLight('rgb(255, 255, 0)')).toBe(true);
      expect(dawnStaysLight('#ffffff')).toBe(false);
      expect(dawnStaysLight('#f5f5f5')).toBe(false);
      expect(dawnStaysLight('#000000')).toBe(false);
      expect(dawnStaysLight('url(a.png)')).toBe(false);
    });

    it('is a band of its own: drawn, and still light', () => {
      expect(dawnBandOf(YELLOW)).toBe('light');
      expect(dawnBandOf('background-color: #ffffff')).toBe('drawn');
      expect(dawnBandOf('background-color: #000000')).toBe('kept');
    });

    it('writes its text in the light scheme’s ink where it says none', () => {
      expect(dawnDarkDeclarations(YELLOW)).toMatch(/color: #000000;$/);
      expect(dawnDarkDeclarations('background-color: yellow')).toMatch(/; color: #000000;$/);
      expect(dawnDarkDeclarationsOf(YELLOW)).toContainEqual(['color', '#000000']);
    });

    it('keeps the ink it says itself as written — never drawn lighter', () => {
      const style = `${YELLOW} color: #333333; border: 1px solid #000000`;
      const dark = dawnDarkDeclarations(style);
      expect(dark).toContain('color: #333333');
      expect(dark.match(/color: #000000/g)).toBeNull();
      // Its border is drawn, like on any drawn band.
      expect(dark).not.toContain('solid #000000');
      expect(dawnDarkDeclarationsOf(style).map(([property]) => property)).not.toContain('color');
    });

    it('leaves every other band’s text to dark, as before', () => {
      expect(dawnDarkDeclarations('background-color: #ffffff')).not.toContain('color: #000000');
      expect(dawnDarkDeclarations('background-color: #ffffff; color: #000000')).toContain(
        'color: rgb(255, 255, 255)',
      );
      expect(dawnDarkDeclarationsOf('background-color: #ffffff').map(([p]) => p)).toEqual([
        'background-color',
      ]);
    });

    it('holds for what lies on it in a message: its own text, and a child’s own colour', () => {
      const message = doc(
        `<p>before <span id="mark" style="${YELLOW}">DATUM <b id="in" style="color: #222222">x</b>` +
          '<font id="font" color="#111111">y</font></span> after</p>' +
          '<table><tr><td id="cell" bgcolor="#ffff00">z</td></tr></table>',
      );
      dawnDarkDocument(message);
      const style = (id: string) => message.getElementById(id)!.getAttribute('style') ?? '';
      expect(style('mark')).toMatch(/color: #000000;$/);
      expect(style('in')).toBe('color: #222222');
      expect(message.getElementById('font')!.getAttribute('color')).toBe('#111111');
      // A band by its `bgcolor` alone gets a style to say its ink in.
      expect(style('cell')).toBe('color: #000000;');
    });
  });
});
