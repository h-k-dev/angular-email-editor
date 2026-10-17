import { EditorState, TextSelection, Transaction } from 'prosemirror-state';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import {
  PlaceholderOptions,
  PlaceholderWords,
  createPlaceholder,
  placeholderKey,
} from './placeholder';

/** Notion's set, as a host words it. */
const NOTION: PlaceholderWords = {
  line: 'Type / for commands',
  heading: ['Heading 1', 'Heading 2', 'Heading 3'],
  quote: 'Empty quote',
  bulletList: 'List',
  orderedList: 'Numbered',
  tableCell: '',
  image: 'Add an image',
};

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

  describe('words by kind (Notion)', () => {
    /** The textblock positions, in document order. */
    const lines = () => {
      const found: number[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock) found.push(pos);
        return !node.isTextblock;
      });
      return found;
    };

    const caretAt = (pos: number) => {
      editor.view.focus();
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + 1)),
      );
    };

    it('an empty block of a kind says what it is, focused or not; a plain line only under the caret', () => {
      mount('<div>x</div><h1></h1><h3></h3><div></div><blockquote><div></div></blockquote>', {
        text: NOTION,
      });
      expect(shown()).toEqual([
        ['h1', 'Heading 1'],
        ['h3', 'Heading 3'],
        ['div', 'Empty quote'],
      ]);
      caretAt(lines()[3]);
      expect(shown()).toEqual([
        ['h1', 'Heading 1'],
        ['h3', 'Heading 3'],
        ['div', 'Type / for commands'],
        ['div', 'Empty quote'],
      ]);
    });

    it('a heading past the words per level takes the last; one string words every level', () => {
      mount('<div>x</div><h5></h5>', { text: NOTION });
      expect(shown()).toEqual([['h5', 'Heading 3']]);
      editor.commands['setPlaceholder']({ heading: 'Heading' });
      expect(shown()).toEqual([['h5', 'Heading']]);
    });

    it("a list item's own line says List; its later lines are plain", () => {
      mount('<ul><li><div></div><div></div></li></ul><ol><li><div></div></li></ol>', {
        text: NOTION,
      });
      expect(shown()).toEqual([
        ['div', 'List'],
        ['div', 'Numbered'],
      ]);
    });

    it("a kind left out takes the line's hint under the caret; '' leaves it bare", () => {
      mount('<div>x</div><h2></h2><table><tr><td></td></tr></table>', {
        text: { line: 'Type / for commands', tableCell: '' },
      });
      expect(shown()).toEqual([]);
      caretAt(lines()[1]);
      expect(shown()).toEqual([['h2', 'Type / for commands']]);
      caretAt(lines()[2]);
      expect(shown()).toEqual([]);
    });

    it('an empty body says empty, else the line', () => {
      mount('', { text: { ...NOTION, empty: 'Write your email' } });
      expect(shown()).toEqual([['div', 'Write your email']]);
      expect(editor.view.dom.getAttribute('aria-placeholder')).toBe('Write your email');
      editor.commands['setPlaceholder'](NOTION);
      expect(shown()).toEqual([['div', 'Type / for commands']]);
    });

    it('a function is told the kind', () => {
      mount('<div>x</div><blockquote><div></div></blockquote>', { text: ({ kind }) => kind });
      expect(shown()).toEqual([['div', 'quote']]);
    });

    it('follows the edits: typing, emptying, re-kinding a line, a list turned numbered', () => {
      mount('<div>x</div><ul><li><div></div></li></ul><div>y</div>', { text: NOTION });
      expect(shown()).toEqual([['div', 'List']]);
      const item = lines()[1];
      editor.view.dispatch(editor.state.tr.insertText('a', item + 1));
      expect(shown()).toEqual([]);
      editor.view.dispatch(editor.state.tr.delete(item + 1, item + 2));
      expect(shown()).toEqual([['div', 'List']]);

      const list = editor.state.doc.resolve(item).before(1);
      editor.view.dispatch(editor.state.tr.setNodeMarkup(list, editor.schema.nodes['orderedList']));
      expect(shown()).toEqual([['div', 'Numbered']]);

      const last = lines()[2];
      editor.view.dispatch(editor.state.tr.delete(last + 1, last + 2));
      editor.view.dispatch(
        editor.state.tr.setBlockType(last, last + 2, editor.schema.nodes['heading'], { level: 2 }),
      );
      expect(shown()).toContainEqual(['h2', 'Heading 2']);
    });

    it("an image waiting for its file wears the words; without them, the frame's own", () => {
      mount('<div><img width="320"></div>', { text: NOTION });
      const frame = () => editor.view.dom.querySelector('.aee-image__placeholder')?.textContent;
      expect(frame()).toBe('Add an image');
      editor.commands['setPlaceholder']({ ...NOTION, image: 'Bild hinzufügen' });
      expect(frame()).toBe('Bild hinzufügen');
      editor.view.setProps({ editable: () => false });
      expect(frame()).toBe('Bild hinzufügen');
      editor.view.setProps({ editable: () => true });
      editor.commands['setPlaceholder']('Type / for commands');
      expect(frame()).toBe('Choose an image');
    });

    it('the kept decorations always equal a fresh scan, across random edits', () => {
      // mulberry32: the same edits on every run.
      let seed = 0x9e3779b9;
      const random = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
      mount(
        '<div>a</div><h1></h1><ul><li><div></div><div>b</div></li><li><div>c</div></li></ul>' +
          '<blockquote><div></div><h2>d</h2></blockquote><ol><li><div></div></li></ol>' +
          '<table><tr><td></td><td>e</td></tr></table><div><img width="320"></div><div></div>',
        { text: NOTION },
      );
      const { schema } = editor;
      const edits: ((state: EditorState, pos: number) => Transaction)[] = [
        (state, pos) => state.tr.insertText('z', pos + 1),
        (state, pos) => state.tr.delete(pos + 1, pos + 1 + state.doc.nodeAt(pos)!.content.size),
        (state, pos) =>
          state.tr.setBlockType(pos, pos + 1, schema.nodes['heading'], { level: pick([1, 2, 4]) }),
        (state, pos) => state.tr.setBlockType(pos, pos + 1, schema.nodes['paragraph']),
        (state, pos) => state.tr.split(pos + 1),
        // A line in front: a list item's own line becomes its second.
        (state, pos) => state.tr.insert(pos, schema.nodes['paragraph'].create()),
        (state, pos) => state.tr.join(pos),
        (state, pos) => {
          const $pos = state.doc.resolve(pos);
          if ($pos.depth < 2) throw new Error('not in a list');
          const list = $pos.node($pos.depth - 1);
          const swap = { bulletList: 'orderedList', orderedList: 'bulletList' }[list.type.name];
          if (!swap) throw new Error('not in a list');
          return state.tr.setNodeMarkup($pos.before($pos.depth - 1), schema.nodes[swap]);
        },
      ];
      const keyed = (state: EditorState) =>
        placeholderKey
          .getState(state)!
          .set.find()
          .map((d) => `${d.from}-${d.to}:${d.spec['line'] ?? d.spec['placeholder']}`)
          .sort();
      let applied = 0;
      for (let step = 0; step < 300; step++) {
        const state = editor.state;
        let tr: Transaction;
        try {
          tr = pick(edits)(state, pick(lines()));
        } catch {
          continue;
        }
        if (!tr.docChanged) continue;
        editor.view.dispatch(tr);
        applied++;
        const fresh = EditorState.create({ doc: editor.state.doc, plugins: editor.state.plugins });
        expect(keyed(editor.state)).toEqual(keyed(fresh));
      }
      expect(applied).toBeGreaterThan(100);
    });
  });
});
