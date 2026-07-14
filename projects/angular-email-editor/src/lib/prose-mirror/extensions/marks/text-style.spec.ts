import { EditorState, TextSelection } from 'prosemirror-state';
import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { emailExtensions } from '../kits';
import {
  TextStyle,
  emailFontFamilies,
  emailFontSizes,
  isSafeFontFamily,
  parseFontFamily,
} from './text-style';

const schema = createSchema(emailExtensions);
const commands = TextStyle.commands!({ schema, extensions: emailExtensions });
const canonical = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

/** Run a textStyle command with the whole `<div>` text selected. */
function applyToHello(command: ReturnType<(typeof commands)[string]>): string {
  const doc = parseHTML('<div>hello</div>', schema);
  let state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, 1, doc.content.size - 1),
  });
  command(state, (tr) => (state = state.apply(tr)));
  return serializeToHTML(state.doc, schema);
}

describe('textStyle font-size', () => {
  it('applies a curated size as an inline font-size', () => {
    expect(applyToHello(commands['setFontSize'](16))).toBe(
      '<div><span style="font-size: 16px;">hello</span></div>',
    );
  });

  it('refuses a size outside the allowed set', () => {
    const doc = parseHTML('<div>hello</div>', schema);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1, doc.content.size - 1),
    });
    expect(commands['setFontSize'](13)(state)).toBe(false);
  });

  it('offers only phone-safe sizes (≥14px) in the picker', () => {
    expect(emailFontSizes.every((size) => size >= 14)).toBe(true);
  });
});

describe('textStyle font-family', () => {
  for (const font of emailFontFamilies) {
    it(`applies "${font.name}" as its canonical stack and is a round-trip fixpoint`, () => {
      const once = applyToHello(commands['setFontFamily'](font.stack));
      expect(once).toBe(`<div><span style="font-family: ${font.stack};">hello</span></div>`);
      // Re-parsing our own output must change nothing (the schema is law).
      expect(canonical(once)).toBe(once);
    });
  }

  it('refuses a font outside the curated set', () => {
    const doc = parseHTML('<div>hello</div>', schema);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1, doc.content.size - 1),
    });
    expect(commands['setFontFamily']('Comic Sans MS, cursive')(state)).toBe(false);
  });

  it('normalises quotes and case when parsing a hand-typed value', () => {
    expect(parseFontFamily('"arial", Helvetica, SANS-SERIF')).toBe('Arial, Helvetica, sans-serif');
    expect(isSafeFontFamily('georgia,times,serif')).toBe(true);
    expect(parseFontFamily('Wingdings')).toBe(null);
  });
});

describe('textStyle attribute merging', () => {
  it('merges colour, size and family into one span rather than nesting', () => {
    const doc = parseHTML('<div>hello</div>', schema);
    let state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1, doc.content.size - 1),
    });
    const apply = (command: ReturnType<(typeof commands)[string]>) =>
      command(state, (tr) => (state = state.apply(tr)));
    apply(commands['setColor']('#1a73e8'));
    apply(commands['setFontSize'](18));
    apply(commands['setFontFamily']('Georgia, Times, serif'));

    expect(serializeToHTML(state.doc, schema)).toBe(
      '<div><span style="color: rgb(26, 115, 232); font-size: 18px; font-family: Georgia, Times, serif;">hello</span></div>',
    );
  });

  it('unsetFontFamily clears only the family, keeping the rest', () => {
    const doc = parseHTML(
      '<div><span style="color: #1a73e8; font-family: Georgia, Times, serif;">hello</span></div>',
      schema,
    );
    let state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1, doc.content.size - 1),
    });
    commands['unsetFontFamily']()(state, (tr) => (state = state.apply(tr)));
    expect(serializeToHTML(state.doc, schema)).toBe(
      '<div><span style="color: rgb(26, 115, 232);">hello</span></div>',
    );
  });
});
