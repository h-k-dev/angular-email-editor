import { dawnDarkColor, parseCssColor } from './color';
import {
  dawnDarkDeclarations,
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
});
