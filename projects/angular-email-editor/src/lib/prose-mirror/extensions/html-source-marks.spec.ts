import { Command, EditorState, TextSelection } from 'prosemirror-state';
import { createSchema } from '../schema';
import { emailExtensions, htmlSourceExtensions } from './kits';
import { createSourceMarks } from './html-source-marks';

const sourceSchema = createSchema(htmlSourceExtensions);
const marks = createSourceMarks({ extensions: emailExtensions });
const keymap = marks.keymap!({ schema: sourceSchema, extensions: htmlSourceExtensions });

const BOLD_OPEN = '<strong style="font-weight: bold;">';

function stateFrom(text: string, from: number, to: number): EditorState {
  const lineType = sourceSchema.nodes['codeLine'];
  const lines = text
    .split('\n')
    .map((line) => lineType.create(null, line ? sourceSchema.text(line) : null));
  const doc = sourceSchema.topNodeType.create(null, lines);
  return EditorState.create({ doc, selection: TextSelection.create(doc, from, to) });
}

function run(command: Command, state: EditorState): EditorState {
  command(state, (tr) => (state = state.apply(tr)));
  return state;
}

function text(state: EditorState): string {
  const lines: string[] = [];
  state.doc.forEach((line) => lines.push(line.textContent));
  return lines.join('\n');
}

describe('html-source marks', () => {
  it('mirrors the mark keymaps of the rich kit', () => {
    expect(Object.keys(keymap)).toEqual(
      expect.arrayContaining(['Mod-b', 'Mod-B', 'Mod-i', 'Mod-u']),
    );
  });

  it('bolds the selected source text through the email schema', () => {
    // "<div>hello world</div>": "world" is at text offset 11 → pm 12..17.
    let state = stateFrom('<div>hello world</div>', 12, 17);
    state = run(keymap['Mod-b'], state);
    expect(text(state)).toBe(`<div>hello ${BOLD_OPEN}world</strong></div>`);
  });

  it('toggles back off using the restored selection', () => {
    let state = stateFrom('<div>hello world</div>', 12, 17);
    state = run(keymap['Mod-b'], state);
    state = run(keymap['Mod-b'], state);
    expect(text(state)).toBe('<div>hello world</div>');
  });

  it('clamps a selection spanning tags onto the visible text', () => {
    let state = stateFrom('<div>hi</div>', 1, 14); // the whole line, tags included
    state = run(keymap['Mod-b'], state);
    expect(text(state)).toBe(`<div>${BOLD_OPEN}hi</strong></div>`);
  });

  it('resolves a partially marked range like the visual editor does', () => {
    // The kit's toggle delegates to isMarkActive (rangeHasMark): a range that
    // is bold anywhere counts as active, so toggling unsets — the source
    // editor inherits exactly that behaviour, custom nuances included.
    const source = `<div>${BOLD_OPEN}ab</strong> cd</div>`;
    const from = 1 + source.indexOf('ab');
    const to = 1 + source.indexOf('cd') + 2;
    let state = stateFrom(source, from, to);
    state = run(keymap['Mod-b'], state);
    expect(text(state)).toBe('<div>ab cd</div>');
  });
});
