import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { GUIDES_PEEK_DELAY_MS, guidesPeekKey } from './layout-guides';
import { MergeTagHover, createMergeTagHover, mergeTagHoverOf } from './merge-tag-hover';
import { MERGE_TAG_PREVIEW_CLASS, createMergeTagPreview } from './merge-tag-preview';
import { MergeTagAnswer, createMergeTagResolution } from './merge-tag-resolution';

/** A host evaluator: what it was asked, answered from `values` at once. */
function evaluatorOf(values: Record<string, MergeTagAnswer>) {
  const asked: string[][] = [];
  return {
    asked,
    resolve: async (expressions: string[]) => {
      asked.push(expressions);
      return expressions.map((expr) => values[expr] ?? null);
    },
  };
}

const settled = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe('merge tag hover', () => {
  let host: HTMLElement;
  let editor: Editor;
  let evaluator: ReturnType<typeof evaluatorOf>;
  let hovers: (MergeTagHover | null)[];

  /** A message's kit (the fill), a template's (the preview), or neither. */
  const mount = (content: string, kit: 'message' | 'template' | 'bare') => {
    editor?.destroy();
    editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        ...(kit === 'message' ? [createMergeTagResolution({ resolve: evaluator.resolve })] : []),
        ...(kit === 'template' ? [createMergeTagPreview({ resolve: evaluator.resolve })] : []),
        createMergeTagHover({ onHover: (hover) => hovers.push(hover) }),
      ],
      content,
    });
  };

  const key = (type: 'keydown' | 'keyup') =>
    document.dispatchEvent(new KeyboardEvent(type, { key: guidesPeekKey(), bubbles: true }));
  const peek = () => {
    key('keydown');
    vi.advanceTimersByTime(GUIDES_PEEK_DELAY_MS + 1);
  };
  const pointTo = (element: Element) =>
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  const pills = () => [...editor.view.dom.querySelectorAll<HTMLElement>('.aee-merge-tag')];
  const pill = (index = 0) => pills()[index];
  const drawn = () => editor.view.dom.querySelector<HTMLElement>(`.${MERGE_TAG_PREVIEW_CLASS}`)!;
  const filled = () => editor.view.dom.querySelector<HTMLElement>('[data-aee-filled]')!;
  const text = () => editor.view.state.doc.textContent;
  const last = () => hovers.at(-1)!;
  const ways = (hover: MergeTagHover) =>
    (['parse', 'write', 'remove', 'unparse', 'edit', 'reset', 'restore'] as const).filter(
      (way) => hover[way],
    );

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    evaluator = evaluatorOf({ name: 'Müller', city: 'Berlin' });
    hovers = [];
  });

  afterEach(() => {
    key('keyup');
    editor.destroy();
    host.remove();
    vi.useRealTimers();
  });

  describe('the report', () => {
    it('tells of a token under the pointer only while the peek key is held', () => {
      mount('<div>Hallo {{ name }}</div>', 'message');
      pointTo(pill());
      expect(hovers).toEqual([]);
      peek();
      expect(hovers.map((h) => h && [h.state, h.expr])).toEqual([['token', 'name']]);
      expect(last().element).toBe(pill());
    });

    it('stays up with the key released while the pointer is on it, goes when it leaves', () => {
      mount('<div>Hallo {{ name }}</div>', 'message');
      peek();
      pointTo(pill());
      key('keyup');
      expect(hovers.map((h) => h && h.expr)).toEqual(['name']);
      pointTo(editor.view.dom.querySelector('div')!);
      expect(hovers.map((h) => h && h.expr)).toEqual(['name', null]);
    });

    it('lets go of a placeholder that left the page under it', async () => {
      mount('<div>Hallo {{ name }}</div>', 'message');
      peek();
      pointTo(pill());
      last().parse!();
      await settled();
      expect(text()).toBe('Hallo Müller');
      expect(last()).toBeNull();
    });
  });

  describe('a token in a message', () => {
    beforeEach(() => {
      mount('<div>{{ name }} aus {{ city }}, {{ name }}</div>', 'message');
      peek();
    });

    it('can be parsed, written by hand, or removed', () => {
      pointTo(pill());
      expect(ways(last())).toEqual(['parse', 'write', 'remove']);
    });

    it('parses this placeholder alone: one expression asked, this token filled', async () => {
      pointTo(pill(1));
      expect(last().parse!()).toBe(true);
      await settled();
      expect(evaluator.asked).toEqual([['city']]);
      expect(text()).toBe('{{ name }} aus Berlin, {{ name }}');
    });

    it('fills the one occurrence pointed at, not its twin', async () => {
      pointTo(pill(2));
      last().parse!();
      await settled();
      expect(text()).toBe('{{ name }} aus {{ city }}, Müller');
    });

    it('keeps a token the host has no value for', async () => {
      key('keyup');
      mount('<div>Zu {{ unknown }}</div>', 'message');
      peek();
      pointTo(pill());
      last().parse!();
      await settled();
      expect(text()).toBe('Zu {{ unknown }}');
    });

    it('writes a value in this token’s place, still the token’s', () => {
      pointTo(pill());
      expect(last().write!('Schmidt')).toBe(true);
      expect(text()).toBe('Schmidt aus {{ city }}, {{ name }}');
      expect(filled().getAttribute('data-aee-expr')).toBe('name');
      // An empty value is never written: Remove is the say for that.
      pointTo(pill());
      expect(last().write!('')).toBe(false);
    });

    it('removes this token alone, the text closed up behind it', () => {
      pointTo(pill(1));
      expect(last().remove!()).toBe(true);
      expect(text()).toBe('{{ name }} aus, {{ name }}');
    });
  });

  describe('a filled value', () => {
    const fillAll = async () => {
      mount('<div>Hallo {{ name }}</div>', 'message');
      editor.commands['resolveMergeTags']();
      await settled();
      peek();
      pointTo(filled());
    };

    it('says the token it was and its value, and can be edited or restored', async () => {
      await fillAll();
      expect(last()).toMatchObject({ state: 'filled', expr: 'name', value: 'Müller', text: 'Müller', edited: false });
      expect(ways(last())).toEqual(['edit', 'restore']);
    });

    it('offers Reset only while it is written over', async () => {
      await fillAll();
      last().edit!('Meier');
      expect(text()).toBe('Hallo Meier');
      expect(last()).toMatchObject({ edited: true, text: 'Meier', value: 'Müller' });
      expect(ways(last())).toEqual(['edit', 'reset', 'restore']);
      last().reset!();
      expect(text()).toBe('Hallo Müller');
    });

    it('restores the token', async () => {
      await fillAll();
      last().restore!();
      expect(text()).toBe('Hallo {{ name }}');
    });
  });

  describe('a token in a template', () => {
    beforeEach(() => {
      mount('<div>{{ name }} aus {{ city }}</div>', 'template');
      peek();
    });

    it('can be parsed or removed — never written over: a template keeps its placeholders', () => {
      pointTo(pill());
      expect(ways(last())).toEqual(['parse', 'remove']);
    });

    it('parses this placeholder alone: drawn as its value, the template untouched', async () => {
      pointTo(pill(1));
      last().parse!();
      await settled();
      expect(evaluator.asked).toEqual([['city']]);
      expect(drawn().textContent).toBe('Berlin');
      expect(text()).toBe('{{ name }} aus {{ city }}');
    });

    it('reports the drawn value as previewed, to show as written again or remove', async () => {
      pointTo(pill(1));
      last().parse!();
      await settled();
      pointTo(drawn());
      expect(last()).toMatchObject({ state: 'previewed', expr: 'city', value: 'Berlin' });
      expect(ways(last())).toEqual(['remove', 'unparse']);

      last().unparse!();
      expect(editor.view.dom.querySelector(`.${MERGE_TAG_PREVIEW_CLASS}`)).toBeNull();
    });

    it('removes a previewed placeholder from the template', async () => {
      editor.commands['previewMergeTags'](true);
      await settled();
      pointTo(drawn());
      expect(last().expr).toBe('name');
      last().remove!();
      expect(text()).toBe('aus {{ city }}');
    });

    it('takes one placeholder back out of a whole preview', async () => {
      editor.commands['previewMergeTags'](true);
      await settled();
      pointTo(drawn());
      last().unparse!();
      const values = [...editor.view.dom.querySelectorAll(`.${MERGE_TAG_PREVIEW_CLASS}`)].map(
        (el) => el.textContent,
      );
      expect(values).toEqual(['Berlin']);
    });
  });

  it('offers a bare editor’s token its removal only', () => {
    mount('<div>Hallo {{ name }}</div>', 'bare');
    peek();
    pointTo(pill());
    expect(ways(last())).toEqual(['remove']);
  });

  it('reads a placeholder off its element, for a card opened some other way', () => {
    mount('<div>Hallo {{ name }}</div>', 'message');
    expect(mergeTagHoverOf(editor.view, pill())).toMatchObject({ state: 'token', expr: 'name' });
    expect(mergeTagHoverOf(editor.view, editor.view.dom.querySelector('div')!)).toBeNull();
  });
});
