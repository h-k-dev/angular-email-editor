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
  'display: inline-block; padding: 14px 28px; background-color: rgb(26, 115, 232); ' +
  'color: rgb(255, 255, 255); font-weight: bold; text-decoration: none;';

describe('divider block', () => {
  it('round-trips to a full-width rule', () => {
    expect(roundTrip('<hr>')).toBe(DIVIDER);
    expect(roundTrip(DIVIDER)).toBe(DIVIDER);
  });

  it('renders as --- in plain text', () => {
    expect(emailPlainText('<div>above</div><hr><div>below</div>')).toBe('above\n---\nbelow');
  });
});

describe('button block', () => {
  it('serializes as a padded inline-block anchor', () => {
    expect(roundTrip(`<a href="https://x.io" style="${BUTTON_STYLE}">Shop now</a>`)).toBe(
      `<a href="https://x.io" style="${BUTTON_STYLE}">Shop now</a>`,
    );
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
      `<a href="#" style="${BUTTON_STYLE}">bold?</a>`,
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
    const editor = createEditor({ parent: host, extensions: emailExtensions, content: '<div>hi</div>' });
    try {
      editor.exec((state, dispatch) => {
        dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)));
        return true;
      });
      editor.commands['insertButton']();
      expect(editor.getHTML()).toBe(`<div>hi</div><a href="#" style="${BUTTON_STYLE}">Button</a>`);
    } finally {
      editor.destroy();
      host.remove();
    }
  });
});
