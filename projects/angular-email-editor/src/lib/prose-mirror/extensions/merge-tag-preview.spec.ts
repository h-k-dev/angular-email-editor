import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { MergeTagAnswer, REMOVE_MERGE_TAG } from './merge-tag-resolution';
import {
  MERGE_TAG_PREVIEWED_CLASS,
  MERGE_TAG_PREVIEW_CLASS,
  MergeTagPreview,
  createMergeTagPreview,
  mergeTagPreviewOn,
  mergeTagPreviewShows,
} from './merge-tag-preview';

/** A host evaluator the test answers by hand: each request waits until
    `answer` (or `fail`) is called. */
function deferredHost() {
  const asked: string[][] = [];
  let answer!: (values: MergeTagAnswer[]) => void;
  let fail!: (error: unknown) => void;
  const resolve = (expressions: string[]) => {
    asked.push(expressions);
    return new Promise<MergeTagAnswer[]>((done, reject) => {
      answer = done;
      fail = reject;
    });
  };
  const settled = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return {
    asked,
    resolve,
    answer: async (values: MergeTagAnswer[]) => {
      answer(values);
      await settled();
    },
    fail: async (error: unknown) => {
      fail(error);
      await settled();
    },
  };
}

describe('merge tag preview', () => {
  let host: HTMLElement;
  let editor: Editor;
  let evaluator: ReturnType<typeof deferredHost>;
  let changes: MergeTagPreview[];
  let errors: unknown[];

  const mount = (content: string) => {
    editor?.destroy();
    editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        createMergeTagPreview({
          resolve: evaluator.resolve,
          onChange: (preview) => changes.push(preview),
          onError: (error) => errors.push(error),
        }),
      ],
      content,
    });
  };
  const preview = (on?: boolean) => editor.commands['previewMergeTags'](on);
  const values = () =>
    [...editor.view.dom.querySelectorAll(`.${MERGE_TAG_PREVIEW_CLASS}`)].map(
      (el) => el.textContent,
    );
  const hidden = () =>
    [...editor.view.dom.querySelectorAll(`.${MERGE_TAG_PREVIEWED_CLASS}`)].map(
      (el) => el.textContent,
    );
  const type = (text: string) =>
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText(text, state.doc.content.size - 1));
      return true;
    });

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    evaluator = deferredHost();
    changes = [];
    errors = [];
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  const TEMPLATE =
    '<div>Sehr geehrte <strong>{{ customer_lastName }}</strong>, Ihr Zeichen {{ case_reference }}.</div>';

  it('asks for each distinct expression once, raw', () => {
    mount(
      "<div>{{ cf_3 &gt; 0 &amp;&amp; cf_4 ? 'Kosten' : '' }} {{customer_lastName}}</div>" +
        '<div>{{ customer_lastName }}</div>',
    );
    expect(preview()).toBe(true);
    expect(evaluator.asked).toEqual([["cf_3 > 0 && cf_4 ? 'Kosten' : ''", 'customer_lastName']]);
  });

  it('draws each value in its token’s place, in its formatting — and writes nothing', async () => {
    mount(TEMPLATE);
    const written = editor.getHTML();
    preview();
    await evaluator.answer(['Müller', 'AZ-7']);

    expect(values()).toEqual(['Müller', 'AZ-7']);
    expect(hidden().join('')).toBe('{{ customer_lastName }}{{ case_reference }}');
    expect(editor.view.dom.querySelector(`strong .${MERGE_TAG_PREVIEW_CLASS}`)?.textContent).toBe(
      'Müller',
    );
    // The document is the template still: what is saved knows no preview.
    expect(editor.getHTML()).toBe(written);
    expect(mergeTagPreviewOn(editor.state)).toBe(true);
  });

  it('is off again with the tokens as they were — back and forth, as often as wanted', async () => {
    mount(TEMPLATE);
    const written = editor.getHTML();
    preview();
    await evaluator.answer(['Müller', 'AZ-7']);
    preview();
    expect(values()).toEqual([]);
    expect(hidden()).toEqual([]);
    expect(mergeTagPreviewOn(editor.state)).toBe(false);

    preview();
    await evaluator.answer(['Schmidt', 'AZ-8']);
    expect(values()).toEqual(['Schmidt', 'AZ-8']);
    expect(editor.getHTML()).toBe(written);
    // Nothing of it is the history's: there is no step to undo.
    expect(editor.commands['undo']?.() ?? false).toBe(false);
  });

  it('asks afresh when turned on while on — another record’s values', async () => {
    mount(TEMPLATE);
    preview(true);
    await evaluator.answer(['Müller', 'AZ-7']);
    preview(true);
    expect(values()).toEqual([]);
    expect(evaluator.asked).toHaveLength(2);
    await evaluator.answer(['Schmidt', 'AZ-8']);
    expect(values()).toEqual(['Schmidt', 'AZ-8']);
  });

  it('drops the answer of a preview that was turned off meanwhile', async () => {
    mount(TEMPLATE);
    preview();
    preview(false);
    await evaluator.answer(['Müller', 'AZ-7']);
    expect(values()).toEqual([]);
    expect(mergeTagPreviewOn(editor.state)).toBe(false);
  });

  it('leaves a token without a value showing, and shows nothing for one the host takes out', async () => {
    mount('<div>{{ a }} {{ b }} {{ c }} {{ d }}</div>');
    preview();
    await evaluator.answer(['', null, REMOVE_MERGE_TAG, 'D']);
    expect(values()).toEqual(['D']);
    expect(hidden().join('')).toBe('{{ c }}{{ d }}');
  });

  it('draws a line break in a value as one', async () => {
    mount('<div>{{ address }}</div>');
    preview();
    await evaluator.answer(['Hauptstr. 1\n10115 Berlin']);
    const value = editor.view.dom.querySelector(`.${MERGE_TAG_PREVIEW_CLASS}`)!;
    expect(value.querySelectorAll('br')).toHaveLength(1);
    expect(value.textContent).toBe('Hauptstr. 110115 Berlin');
  });

  it('asks for a token written while it is on — only for that one', async () => {
    mount('<div>{{ a }}</div>');
    preview();
    await evaluator.answer(['A']);
    type(' {{ b }}');
    expect(evaluator.asked).toEqual([['a'], ['b']]);
    await evaluator.answer(['B']);
    expect(values()).toEqual(['A', 'B']);
    type(' {{ a }}');
    expect(evaluator.asked).toHaveLength(2);
    expect(values()).toEqual(['A', 'B', 'A']);
  });

  it('keeps the tokens showing when the host fails, and does not ask again', async () => {
    mount('<div>{{ a }}</div>');
    preview();
    await evaluator.fail(new Error('down'));
    expect(errors).toHaveLength(1);
    expect(values()).toEqual([]);
    expect(hidden()).toEqual([]);
    type(' x');
    expect(evaluator.asked).toHaveLength(1);
  });

  it('tells the host when it is on, and while a request is out', async () => {
    mount('<div>{{ a }}</div>');
    preview();
    await evaluator.answer(['A']);
    preview();
    expect(changes).toEqual([
      { on: true, pending: true },
      { on: true, pending: false },
      { on: false, pending: false },
    ]);
  });

  it('is the preview-placeholders action, pressed while on', () => {
    mount('<div>{{ a }}</div>');
    const action = editor.actions.find((a) => a.id === 'preview-placeholders')!;
    expect(action.isActive?.(editor.state)).toBe(false);
    preview();
    expect(action.isActive?.(editor.state)).toBe(true);
  });

  describe('one placeholder', () => {
    const one = (expr: string, shown?: boolean) => editor.commands['previewMergeTag'](expr, shown);

    it('shows one placeholder as its value while the rest stays as written', async () => {
      mount('<div>{{ a }} und {{ b }} und {{ a }}</div>');
      expect(one(' a ')).toBe(true);
      expect(evaluator.asked).toEqual([['a']]);
      await evaluator.answer(['A']);
      // Wherever the expression stands: the value is the expression's.
      expect(values()).toEqual(['A', 'A']);
      expect(hidden()).toEqual(['{{ a }}', '{{ a }}']);
      expect(mergeTagPreviewOn(editor.state)).toBe(false);
      expect(mergeTagPreviewShows(editor.state, 'a')).toBe(true);
      expect(mergeTagPreviewShows(editor.state, 'b')).toBe(false);
    });

    it('writes nothing: the document is the template still', async () => {
      mount('<div>{{ a }}</div>');
      const before = editor.state.doc;
      one('a');
      await evaluator.answer(['A']);
      expect(editor.state.doc.eq(before)).toBe(true);
    });

    it('takes one placeholder back out of a whole preview', async () => {
      mount('<div>{{ a }} und {{ b }}</div>');
      preview();
      await evaluator.answer(['A', 'B']);
      one('a', false);
      expect(values()).toEqual(['B']);
      // …and no argument is the other of the two.
      one('a');
      await evaluator.answer(['A2']);
      expect(values()).toEqual(['A2', 'B']);
    });

    it('asks for it afresh each time it is shown', async () => {
      mount('<div>{{ a }}</div>');
      one('a', true);
      await evaluator.answer([null]);
      expect(values()).toEqual([]);
      one('a', true);
      expect(evaluator.asked).toEqual([['a'], ['a']]);
      await evaluator.answer(['A']);
      expect(values()).toEqual(['A']);
    });

    it('ends with the whole preview turned on or off', async () => {
      mount('<div>{{ a }} und {{ b }}</div>');
      one('a');
      await evaluator.answer(['A']);
      preview(true);
      await evaluator.answer(['A', 'B']);
      preview(false);
      expect(values()).toEqual([]);
      expect(mergeTagPreviewShows(editor.state, 'a')).toBe(false);
    });

    it('is refused without an expression', () => {
      mount('<div>{{ a }}</div>');
      expect(one('  ')).toBe(false);
    });
  });
});
