import { Command, EditorState, TextSelection } from 'prosemirror-state';
import { createSchema } from '../schema';
import { parseHTML, serializeToHTML } from '../html';
import { emailExtensions } from './kits';
import { SplitKeepingMarks } from './split-keeping-marks';
import { HardBreak } from './nodes/hard-break';
import { TextStyle } from './marks/text-style';
import { Link } from './marks/link';

const schema = createSchema(emailExtensions);
const ctx = { schema, extensions: emailExtensions };
const enter = SplitKeepingMarks.keymap!(ctx)['Enter'];
const shiftEnter = HardBreak.keymap!(ctx)['Shift-Enter'];
const setFontFamily = TextStyle.commands!(ctx)['setFontFamily'];
const setLink = Link.commands!(ctx)['setLink'];

const FONT = 'font-family: Georgia, Times, serif;';

/** A cursor in a single empty `<div>` line. */
function emptyLine(): EditorState {
  const doc = parseHTML('<div></div>', schema);
  return EditorState.create({ doc, selection: TextSelection.create(doc, 1) });
}

function run(state: EditorState, command: Command): EditorState {
  let next = state;
  command(state, (tr) => (next = state.apply(tr)));
  return next;
}

/** Mimic the view: inserted text carries the active marks (stored, else the
    marks at the cursor). */
function type(state: EditorState, text: string): EditorState {
  const { from } = state.selection;
  const marks = state.storedMarks ?? state.selection.$from.marks();
  const tr = state.tr.insertText(text, from);
  for (const mark of marks) tr.addMark(from, from + text.length, mark);
  return state.apply(tr);
}

describe('font persistence across breaks (Gmail-style)', () => {
  it('carries a bare-cursor font across Enter onto the new line', () => {
    let state = emptyLine();
    state = run(state, setFontFamily('Georgia, Times, serif')); // pick font, no selection
    state = type(state, 'first');
    state = run(state, enter);
    state = type(state, 'second');

    expect(serializeToHTML(state.doc, schema)).toBe(
      `<div><span style="${FONT}">first</span></div><div><span style="${FONT}">second</span></div>`,
    );
  });

  it('carries the font across a Shift-Enter line break', () => {
    let state = emptyLine();
    state = run(state, setFontFamily('Georgia, Times, serif'));
    state = type(state, 'aaa');
    state = run(state, shiftEnter);
    state = type(state, 'bbb');

    expect(serializeToHTML(state.doc, schema)).toBe(
      `<div><span style="${FONT}">aaa<br>bbb</span></div>`,
    );
  });
});

describe('links still stop at a break (splittable: false)', () => {
  it('does not drag a link onto the next paragraph on Enter', () => {
    const doc = parseHTML('<div>ab</div>', schema);
    let state = EditorState.create({ doc, selection: TextSelection.create(doc, 1, 3) });
    state = run(state, setLink({ href: 'https://example.com' }));
    // Cursor to the end of the linked word, then a new line.
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
    state = run(state, enter);
    state = type(state, 'cd');

    const html = serializeToHTML(state.doc, schema);
    expect(html).toContain('</a></div><div>cd</div>');
    expect(html).not.toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">cd',
    );
  });
});
