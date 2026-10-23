import {
  DARK_FILL_CLASS,
  DARK_LINE_CLASS,
  DARK_TEXT_CLASS,
  darkModeEditorCss,
  emailBorderPalette,
  markDarkMode,
} from './dark-mode';
import { TABLE_BORDER_COLOR } from './extensions/nodes/table';

const RED = '#c5221f';
const BLACK = '#202124';
const PALE_RED = '#fce8e6';

const classesOf = (html: string, selector: string): string[] => {
  const template = document.createElement('template');
  template.innerHTML = html;
  return Array.from(template.content.querySelector(selector)?.classList ?? []);
};

describe('markDarkMode', () => {
  it('lights a palette colour on the page, with Apple’s query and Outlook’s marker', () => {
    const { html, css } = markDarkMode(`<p><span style="color: ${RED}">x</span></p>`);
    expect(classesOf(html, 'span')).toEqual([`${DARK_TEXT_CLASS}c5221f`]);
    expect(css).toContain(
      '@media (prefers-color-scheme: dark) { .aee-dt-c5221f { color: #ff695b !important; } }',
    );
    expect(css).toContain('[data-ogsc] .aee-dt-c5221f { color: #ff695b !important; }');
  });

  it('darkens a pale fill and lights its paired text together', () => {
    const { html, css } = markDarkMode(
      `<p><span style="color: ${BLACK}; background-color: ${PALE_RED}">x</span></p>`,
    );
    expect(classesOf(html, 'span')).toEqual([
      `${DARK_FILL_CLASS}fce8e6`,
      `${DARK_TEXT_CLASS}202124`,
    ]);
    expect(css).toContain('[data-ogsb] .aee-db-fce8e6 { background-color: #4a2624 !important; }');
  });

  it('reads a fill in the CSSOM’s rgb form (a column panel) and a bgcolor', () => {
    const { html } = markDarkMode(
      '<div id="a" style="background-color: rgb(252, 232, 230); color: #202124;">x</div>' +
        '<table><tbody><tr><td id="b" bgcolor="#FCE8E6">y</td></tr></tbody></table>',
    );
    expect(classesOf(html, '#a')).toContain(`${DARK_FILL_CLASS}fce8e6`);
    expect(classesOf(html, '#b')).toContain(`${DARK_FILL_CLASS}fce8e6`);
  });

  it('keeps a fill light while it holds a colour outside the palette — and what is in it', () => {
    const { html } = markDarkMode(
      `<div id="fill" style="background-color: ${PALE_RED}; color: ${BLACK};">` +
        `<span id="red" style="color: ${RED}">a</span><span style="color: #333333">b</span></div>`,
    );
    expect(classesOf(html, '#fill')).toEqual([]);
    expect(classesOf(html, '#red')).toEqual([]);
  });

  it('leaves palette text alone under a background outside the palette', () => {
    const { html } = markDarkMode(
      `<div style="background-color: #ffcc00;"><div id="inner" style="background-color: ${PALE_RED}; color: ${BLACK};">` +
        `<span id="red" style="color: ${RED}">a</span></div></div>`,
    );
    expect(classesOf(html, '#inner')).toEqual([]);
    expect(classesOf(html, '#red')).toEqual([]);
  });

  it('never moves a picture’s background, nor a colour without a variant', () => {
    const { html, css } = markDarkMode(
      `<div style="background-color: ${PALE_RED}; background-image: url(x.png)">` +
        `<span style="color: ${RED}">a</span></div><span style="color: #ffffff">b</span>`,
    );
    expect(html).not.toContain('aee-d');
    expect(css).toBe('');
  });

  it('hands the input back byte for byte when nothing moves', () => {
    const input = '<p>Hello&nbsp;<b>world</b></p><!--[if mso]><table><![endif]-->';
    expect(markDarkMode(input)).toEqual({ html: input, css: '' });
  });

  it('knows the grid line a bordered table is inserted with', () => {
    const probe = document.createElement('div');
    probe.style.color = emailBorderPalette[0].value;
    expect(probe.style.color).toBe(TABLE_BORDER_COLOR);
  });

  it('darkens the table grid line on the page — Apple’s query and Outlook’s background marker', () => {
    const cell = `<td style="padding: 7px 9px; border: 1px solid ${TABLE_BORDER_COLOR};">x</td>`;
    const { html, css } = markDarkMode(`<table><tbody><tr>${cell}</tr></tbody></table>`);
    expect(classesOf(html, 'td')).toEqual([`${DARK_LINE_CLASS}e6e5e3`]);
    expect(css).toContain('.aee-dl-e6e5e3 { border-color: #383836 !important; }');
    expect(css).toContain('[data-ogsb] .aee-dl-e6e5e3 { border-color: #383836 !important; }');
  });

  it('keeps a grid line light under a background that stays light', () => {
    const { html } = markDarkMode(
      `<div style="background-color: #ffcc00;"><table><tbody><tr>` +
        `<td style="border: 1px solid ${TABLE_BORDER_COLOR};">x</td></tr></tbody></table></div>`,
    );
    expect(classesOf(html, 'td')).toEqual([]);
  });

  it('keeps every line as it is for an empty border list', () => {
    const input = `<table><tbody><tr><td style="border: 1px solid ${TABLE_BORDER_COLOR};">x</td></tr></tbody></table>`;
    expect(markDarkMode(input, { text: [], background: [], border: [] })).toEqual({
      html: input,
      css: '',
    });
  });

  it('keeps the classes already there (a stacking column)', () => {
    const { html } = markDarkMode(
      `<div class="aee-stack" style="display: inline-block; background-color: ${PALE_RED}; color: ${BLACK};">x</div>`,
    );
    expect(classesOf(html, 'div')).toEqual([
      'aee-stack',
      `${DARK_FILL_CLASS}fce8e6`,
      `${DARK_TEXT_CLASS}202124`,
    ]);
  });
});

describe('darkModeEditorCss', () => {
  it('scopes every rule and hands the variants over in custom properties', () => {
    const css = darkModeEditorCss('.paper > .aee-editor');
    const rules = css.split('\n');
    expect(rules.every((rule) => rule.startsWith('.paper > .aee-editor '))).toBe(true);
    expect(css).toContain('--aee-dark-text: #ff695b;');
    expect(css).toContain('--aee-dark-fill: #4a2624;');
    expect(css).toContain('color: var(--aee-dark-text) !important;');
    expect(css).toContain('background-color: var(--aee-dark-fill) !important;');
    expect(css).toContain('--aee-dark-line: #383836;');
    expect(css).toContain('border-color: var(--aee-dark-line) !important;');
  });

  it('is empty for a palette without variants', () => {
    expect(
      darkModeEditorCss('.x', {
        text: [{ name: 'A', value: '#123456' }],
        background: [],
        border: [],
      }),
    ).toBe('');
  });

  it('keeps the library’s grid line for a palette that names no border', () => {
    expect(darkModeEditorCss('.x', { text: [], background: [] })).toContain(
      '--aee-dark-line: #383836;',
    );
  });
});
