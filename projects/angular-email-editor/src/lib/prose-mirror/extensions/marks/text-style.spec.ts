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
  toEmailSafeColor,
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

describe('textStyle text-transform', () => {
  const roundTrip = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

  it('parses, emits and round-trips the case the words are shown in', () => {
    const out = roundTrip('<div><span style="text-transform: uppercase">home</span></div>');
    expect(out).toBe('<div><span style="text-transform: uppercase;">home</span></div>');
    expect(roundTrip(out)).toBe(out);
    // `none` is the words as written: no mark.
    expect(roundTrip('<div><span style="text-transform: none">x</span></div>')).toBe(
      '<div>x</div>',
    );
  });

  it('sets and clears through the commands, and the uppercase action toggles', () => {
    const doc = parseHTML('<div>home</div>', schema);
    let state = EditorState.create({ doc, selection: TextSelection.create(doc, 1, 5) });
    const run = (command: (s: EditorState, d: (tr: any) => void) => boolean) =>
      command(state, (tr) => (state = state.apply(tr)));
    run(commands['setTextTransform']('uppercase'));
    expect(serializeToHTML(state.doc, schema)).toContain('text-transform: uppercase;');
    const action = TextStyle.actions!({ schema, extensions: emailExtensions })[0];
    expect(action.id).toBe('uppercase');
    expect(action.isActive!(state)).toBe(true);
    run(action.command);
    expect(action.isActive!(state)).toBe(false);
    expect(serializeToHTML(state.doc, schema)).toBe('<div>home</div>');
    run(commands['setTextTransform']('capitalize'));
    run(commands['unsetTextTransform']());
    expect(serializeToHTML(state.doc, schema)).toBe('<div>home</div>');
  });
});

describe('toEmailSafeColor', () => {
  it('reads no colour in a CSS-wide keyword — the CSSOM’s word for a shorthand’s colour', () => {
    expect(toEmailSafeColor('initial')).toBeNull();
    expect(toEmailSafeColor('transparent')).toBeNull();
    expect(toEmailSafeColor('inherit')).toBeNull();
    expect(toEmailSafeColor('#bd8714')).toBe('#bd8714');
  });
});

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

describe('textStyle background (highlight)', () => {
  it('applies a fill paired with the near-black fill text colour and round-trips', () => {
    const once = applyToHello(commands['setBackgroundColor']('#fef7e0'));
    expect(once).toBe(
      '<div><span style="color: rgb(32, 33, 36); background-color: rgb(254, 247, 224);">hello</span></div>',
    );
    expect(canonical(once)).toBe(once);
  });

  it('pairs a black fill with white text, absorbs it on parse, and round-trips', () => {
    const once = applyToHello(commands['setBackgroundColor']('#202124'));
    expect(once).toBe(
      '<div><span style="color: rgb(255, 255, 255); background-color: rgb(32, 33, 36);">hello</span></div>',
    );
    expect(canonical(once)).toBe(once);
    // White on a pale fill is someone's choice, not the pair: it stays.
    const authored =
      '<div><span style="color: rgb(255, 255, 255); background-color: rgb(254, 247, 224);">hello</span></div>';
    expect(canonical(authored)).toBe(authored);
  });

  it('absorbs the paired colour on parse — clearing the fill leaves no colour behind', () => {
    const doc = parseHTML(
      '<div><span style="color: rgb(32, 33, 36); background-color: rgb(254, 247, 224);">hello</span></div>',
      schema,
    );
    let state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1, doc.content.size - 1),
    });
    commands['unsetBackgroundColor']()(state, (tr) => (state = state.apply(tr)));
    expect(serializeToHTML(state.doc, schema)).toBe('<div>hello</div>');
  });

  it('keeps the paired colour as an authored colour when there is no fill', () => {
    // Absorption is scoped to the pair: the same near-black *without* a fill
    // is someone's deliberate colour choice and must survive.
    const authored = '<div><span style="color: rgb(32, 33, 36);">hello</span></div>';
    expect(canonical(authored)).toBe(authored);
  });

  it('merges a highlight with text colour on one span', () => {
    const doc = parseHTML('<div>hello</div>', schema);
    let state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1, doc.content.size - 1),
    });
    const apply = (command: ReturnType<(typeof commands)[string]>) =>
      command(state, (tr) => (state = state.apply(tr)));
    apply(commands['setColor']('#c5221f'));
    apply(commands['setBackgroundColor']('#fef7e0'));
    expect(serializeToHTML(state.doc, schema)).toBe(
      '<div><span style="color: rgb(197, 34, 31); background-color: rgb(254, 247, 224);">hello</span></div>',
    );
  });

  it('merges a highlight with text colour at a bare caret, for the text typed next', () => {
    const doc = parseHTML('<div>hello</div>', schema);
    let state = EditorState.create({ doc, selection: TextSelection.create(doc, 6) });
    const apply = (command: ReturnType<(typeof commands)[string]>) =>
      command(state, (tr) => (state = state.apply(tr)));
    apply(commands['setColor']('#c5221f'));
    apply(commands['setBackgroundColor']('#fef7e0'));
    expect(state.storedMarks?.map((mark) => mark.attrs)).toEqual([
      expect.objectContaining({ color: '#c5221f', backgroundColor: '#fef7e0' }),
    ]);
  });

  it('unsetBackgroundColor clears only the fill', () => {
    const doc = parseHTML(
      '<div><span style="color: #c5221f; background-color: #fef7e0;">hello</span></div>',
      schema,
    );
    let state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1, doc.content.size - 1),
    });
    commands['unsetBackgroundColor']()(state, (tr) => (state = state.apply(tr)));
    expect(serializeToHTML(state.doc, schema)).toBe(
      '<div><span style="color: rgb(197, 34, 31);">hello</span></div>',
    );
  });
});
