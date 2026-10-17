import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { PlaceholderOptions, createPlaceholder } from './placeholder';

describe('placeholder', () => {
  let host: HTMLElement;
  let editor: Editor;

  const mount = (
    content: string,
    options: PlaceholderOptions = { text: 'Type / for commands' },
  ) => {
    editor = createEditor({
      parent: host,
      extensions: [...emailExtensions, createPlaceholder(options)],
      content,
    });
  };

  /** The lines showing words, as `[tag, words]`. */
  const shown = () =>
    [...editor.view.dom.querySelectorAll<HTMLElement>('.aee-placeholder')].map((line) => [
      line.tagName.toLowerCase(),
      line.dataset['placeholder'],
    ]);

  /** Puts the caret at the start of the `index`th top-level block and focuses. */
  const caretInto = (index: number) => {
    let pos = 0;
    for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize;
    editor.view.focus();
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + 1)),
    );
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('shows on an empty body, focused or not, and names the field for assistive tech', () => {
    mount('');
    expect(shown()).toEqual([['div', 'Type / for commands']]);
    expect(editor.view.dom.querySelector('.aee-placeholder-doc')).not.toBeNull();
    expect(editor.view.dom.getAttribute('aria-placeholder')).toBe('Type / for commands');
  });

  it('goes as soon as a character is typed', () => {
    mount('');
    editor.view.dispatch(editor.state.tr.insertText('H', 1));
    expect(shown()).toEqual([]);
    expect(editor.view.dom.hasAttribute('aria-placeholder')).toBe(false);
  });

  it('shows on the empty line under the caret only, while focused (Notion)', () => {
    mount('<div>Hello</div><div></div><div></div>');
    expect(shown()).toEqual([]);

    caretInto(1);
    expect(shown()).toEqual([['div', 'Type / for commands']]);
    expect(editor.view.dom.children[1].classList).toContain('aee-placeholder');

    caretInto(0);
    expect(shown()).toEqual([]);

    caretInto(2);
    expect(editor.view.dom.children[2].classList).toContain('aee-placeholder');
    expect(editor.view.dom.querySelectorAll('.aee-placeholder')).toHaveLength(1);
  });

  it('hides when focus leaves', () => {
    mount('<div>Hello</div><div></div>');
    caretInto(1);
    expect(shown()).toHaveLength(1);
    (editor.view.dom as HTMLElement).blur();
    expect(shown()).toEqual([]);
  });

  it("show: 'all' marks every empty line, focused or not", () => {
    mount('<div></div><div>Hello</div><div></div>', { text: 'Write…', show: 'all' });
    expect(shown()).toEqual([
      ['div', 'Write…'],
      ['div', 'Write…'],
    ]);
  });

  it('words each line with a function, and leaves a line bare on null', () => {
    mount('<h2></h2><div></div><div>x</div>', {
      show: 'all',
      text: ({ node }) => (node.type.name === 'heading' ? `Heading ${node.attrs['level']}` : null),
    });
    expect(shown()).toEqual([['h2', 'Heading 2']]);
  });

  it('setPlaceholder swaps the words at once, outside the undo history', () => {
    mount('');
    expect(editor.commands['setPlaceholder']('Befehle mit /')).toBe(true);
    expect(shown()).toEqual([['div', 'Befehle mit /']]);
    expect(editor.commands['setPlaceholder']('')).toBe(true);
    expect(shown()).toEqual([]);
    expect(editor.commands['undo']?.()).toBeFalsy();
  });

  it('stays out of the document', () => {
    mount('<div></div>');
    expect(editor.getHTML()).not.toContain('placeholder');
  });

  it('never marks a read-only editor', () => {
    mount('');
    editor.view.setProps({ editable: () => false });
    expect(shown()).toEqual([]);
  });

  it('shows nothing until it is given words', () => {
    mount('', {});
    expect(shown()).toEqual([]);
  });
});
