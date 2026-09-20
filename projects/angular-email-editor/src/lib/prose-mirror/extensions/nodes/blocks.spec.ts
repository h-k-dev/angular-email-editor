import { TextSelection } from 'prosemirror-state';
import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { lintHTML } from '../../html-source';
import { emailPlainText } from '../../plain-text';
import { createEditor } from '../../editor';
import { emailExtensions } from '../kits';

const schema = createSchema(emailExtensions);
const roundTrip = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

const DIVIDER =
  '<hr style="height: 1px; width: 100%; background-color: rgb(224, 224, 224); ' +
  'margin-top: 12px; margin-bottom: 12px;">';
const BUTTON_STYLE =
  'display: inline-block; background-color: rgb(26, 115, 232); color: rgb(255, 255, 255); ' +
  'font-weight: bold; text-decoration: none; border-width: 14px 28px; border-style: solid; ' +
  'border-color: rgb(26, 115, 232);';

describe('divider block', () => {
  it('round-trips to a full-width rule', () => {
    expect(roundTrip('<hr>')).toBe(DIVIDER);
    expect(roundTrip(DIVIDER)).toBe(DIVIDER);
  });

  it('renders as --- in plain text', () => {
    expect(emailPlainText('<div>above</div><hr><div>below</div>')).toBe('above\n---\nbelow');
  });
});

describe('button', () => {
  it('serializes as a bordered inline-block anchor — the Outlook-safe button', () => {
    expect(roundTrip(`<a href="https://x.io" style="${BUTTON_STYLE}">Shop now</a>`)).toBe(
      `<div><a href="https://x.io" style="${BUTTON_STYLE}">Shop now</a></div>`,
    );
  });

  it('sits on a line of text, or in a table cell', () => {
    expect(
      roundTrip(`<div>Click <a href="https://x.io" style="${BUTTON_STYLE}">here</a></div>`),
    ).toBe(`<div>Click <a href="https://x.io" style="${BUTTON_STYLE}">here</a></div>`);
    const inCell = roundTrip(
      `<table><tbody><tr><td><a href="https://x.io" style="${BUTTON_STYLE}">Shop</a></td></tr></tbody></table>`,
    );
    expect(inCell).toContain(`<a href="https://x.io" style="${BUTTON_STYLE}">Shop</a>`);
    expect(inCell).toContain('<td');
    expect(roundTrip(inCell)).toBe(inCell);
  });

  it('is distinct from a plain link — no display:inline-block, stays a link', () => {
    const link = roundTrip('<div><a href="https://x.io">plain</a></div>');
    expect(link).toBe(
      '<div><a href="https://x.io" target="_blank" rel="noopener noreferrer">plain</a></div>',
    );
    // And an inline-block anchor is NOT read as a link inside a paragraph.
    expect(roundTrip(`<a href="https://x.io" style="${BUTTON_STYLE}">CTA</a>`)).not.toContain(
      'target="_blank"',
    );
  });

  it('flattens the label to plain text (atom reads textContent)', () => {
    expect(roundTrip(`<a href="#" style="${BUTTON_STYLE}"><strong>bold?</strong></a>`)).toBe(
      `<div><a href="#" style="${BUTTON_STYLE}">bold?</a></div>`,
    );
  });

  it('produces lint-clean output', () => {
    expect(lintHTML(`<a href="https://x.io" style="${BUTTON_STYLE}">Go</a>`)).toEqual([]);
    expect(lintHTML(DIVIDER)).toEqual([]);
  });

  it('renders its label in plain text', () => {
    expect(emailPlainText(`<a href="https://x.io" style="${BUTTON_STYLE}">Shop now</a>`)).toBe(
      'Shop now',
    );
  });

  it('insertButton drops a default button as an inert atom', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor({
      parent: host,
      extensions: emailExtensions,
      content: '<div>hi</div>',
    });
    try {
      editor.exec((state, dispatch) => {
        dispatch?.(
          state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)),
        );
        return true;
      });
      editor.commands['insertButton']();
      expect(editor.getHTML()).toBe(`<div>hi<a href="#" style="${BUTTON_STYLE}">Button</a></div>`);
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it('insertButton drops a button into a table cell', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor({
      parent: host,
      extensions: emailExtensions,
      content: '<table><tbody><tr><td></td></tr></tbody></table>',
    });
    try {
      editor.exec((state, dispatch) => {
        let cell = 0;
        state.doc.descendants((node, pos) => {
          if (node.type.name === 'tableCell') cell = pos;
          return true;
        });
        dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, cell + 1)));
        return true;
      });
      expect(editor.commands['insertButton']()).toBe(true);
      const html = editor.getHTML();
      expect(html).toContain(`<a href="#" style="${BUTTON_STYLE}">Button</a>`);
      expect(html).toContain('<td');
      expect(html).not.toContain('</table><a');
      expect(roundTrip(html)).toBe(html);
    } finally {
      editor.destroy();
      host.remove();
    }
  });
});
