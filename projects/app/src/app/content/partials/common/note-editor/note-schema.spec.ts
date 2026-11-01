import { inputRules } from 'prosemirror-inputrules';
import { Slice } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import {
  linkHref,
  markdownSlice,
  noteDoc,
  noteKeys,
  noteMarkdown,
  noteRules,
  setLink,
  sliceMarkdown,
} from './note-schema';

/** A note typed into a character at a time, as the input rules hear it;
    `\n` an Enter. */
function typed(text: string): string {
  const view = new EditorView(document.createElement('div'), {
    state: EditorState.create({
      doc: noteDoc(''),
      plugins: [inputRules({ rules: [...noteRules] })],
    }),
  });
  for (const char of text) {
    if (char === '\n') {
      noteKeys['Enter'](view.state, view.dispatch) ||
        view.dispatch(view.state.tr.split(view.state.selection.from));
      continue;
    }
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (handle) =>
      handle(view, from, to, char, () => view.state.tr.insertText(char, from, to)),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to));
  }
  const markdown = noteMarkdown(view.state.doc);
  view.destroy();
  return markdown;
}

/** Markdown read and written back. */
const roundTrip = (markdown: string) => noteMarkdown(noteDoc(markdown));

describe('note schema', () => {
  it('keeps a note’s Markdown through a round trip', () => {
    for (const markdown of [
      '**Bold** *it* ~~gone~~ `code` [call](https://meet.example/abc)',
      '- one\n- two\n  - nested',
      '- loose\n\n- list',
      '1. first\n2. second',
      '3. from three\n4. on',
      'Line\\\nbroken\n\nNext paragraph',
    ]) {
      expect(roundTrip(markdown)).toBe(markdown);
    }
  });

  it('writes no description for an empty note', () => {
    expect(noteMarkdown(noteDoc(''))).toBe('');
  });

  it('reads plain text (an invitation’s) as its lines, its addresses linked', () => {
    expect(roundTrip('Room 4\nBring snacks')).toBe('Room 4\\\nBring snacks');
    const doc = noteDoc('Join https://meet.example/x');
    expect(doc.firstChild!.lastChild!.marks[0].attrs['href']).toBe('https://meet.example/x');
  });

  it('reads Markdown it cannot hold as what it can — never HTML, never a script link', () => {
    expect(roundTrip('# Agenda\n\n> quoted\n\n---\n\nend')).toBe('Agenda\n\nquoted\n\nend');
    expect(roundTrip('![map](https://x.test/map.png)')).toBe('[map](https://x.test/map.png)');
    // Tags read as words — and stay words, written back.
    expect(noteDoc('<b>hi</b>').firstChild!.firstChild!.marks).toHaveLength(0);
    expect(roundTrip('<b>hi</b>')).toBe('<b>hi</b>');
    // A script's address is no link: the words stay, as typed.
    const script = noteDoc('[x](javascript:alert(1))');
    expect(script.rangeHasMark(0, script.content.size, script.type.schema.marks['link'])).toBe(
      false,
    );
  });

  it('turns `- ` and `1. ` into lists as they are typed, Enter the next item', () => {
    expect(typed('- milk\neggs')).toBe('- milk\n- eggs');
    expect(typed('1. one\ntwo')).toBe('1. one\n2. two');
  });

  it('marks words by their syntax as it is typed', () => {
    expect(typed('a **b** c')).toBe('a **b** c');
    expect(typed('a *b* _c_ `d`')).toBe('a *b* *c* `d`');
    expect(typed('~~a~~ ~b~')).toBe('~~a~~ ~~b~~');
  });

  it('leaves snake_case and lone stars alone', () => {
    expect(typed('snake_case_name')).toBe('snake_case_name');
    expect(typed('2 * 3 * 4')).toBe('2 \\* 3 \\* 4');
  });

  it('links [words](address), and an address typed then a space', () => {
    expect(typed('[call](meet.example/x)')).toBe('[call](https://meet.example/x)');
    expect(typed('see https://x.test/a now')).toBe('see <https://x.test/a> now');
    expect(typed('[bad](javascript:x)')).toBe('\\[bad\\](javascript:x)');
  });

  it('copies as Markdown and pastes Markdown as what it says', () => {
    const doc = noteDoc('* **milk**\n* eggs');
    // Any bullet read; `-` written.
    expect(sliceMarkdown(doc.slice(0, doc.content.size))).toBe('- **milk**\n- eggs');
    expect(sliceMarkdown(new Slice(noteDoc('**milk** today').firstChild!.content, 0, 0))).toBe(
      '**milk** today',
    );
    const pasted = markdownSlice('- a\n- *b*');
    expect(pasted.content.firstChild!.type.name).toBe('bullet_list');
  });

  it('keeps only the web’s, mail’s and phone’s addresses', () => {
    expect(linkHref(' www.example.com ')).toBe('https://www.example.com');
    expect(linkHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(linkHref('javascript:alert(1)')).toBe('');
  });

  it('links the words an address is pasted over — never a bare caret', () => {
    let state = EditorState.create({ doc: noteDoc('call') });
    expect(setLink('https://x.test')(state)).toBe(false);
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 5)));
    setLink('https://x.test')(state, (tr) => (state = state.apply(tr)));
    expect(noteMarkdown(state.doc)).toBe('[call](https://x.test)');
  });
});
