import { TextSelection } from 'prosemirror-state';
import { undo } from 'prosemirror-history';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import {
  MergeTagResolutionReport,
  createMergeTagResolution,
  mergeTagResolutionPending,
} from './merge-tag-resolution';

/** A host evaluator the test answers by hand: each request waits until
    `answer` (or `fail`) is called. */
function deferredHost() {
  const asked: string[][] = [];
  let answer!: (values: (string | null)[]) => void;
  let fail!: (error: unknown) => void;
  const resolve = (expressions: string[]) => {
    asked.push(expressions);
    return new Promise<(string | null)[]>((done, reject) => {
      answer = done;
      fail = reject;
    });
  };
  return {
    asked,
    resolve,
    answer: async (values: (string | null)[]) => {
      answer(values);
      await Promise.resolve();
      await Promise.resolve();
    },
    fail: async (error: unknown) => {
      fail(error);
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('merge tag resolution', () => {
  let host: HTMLElement;
  let editor: Editor;
  let evaluator: ReturnType<typeof deferredHost>;
  let reports: MergeTagResolutionReport[];
  let errors: unknown[];
  let pending: boolean[];

  const mount = (content: string) => {
    editor?.destroy();
    editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        createMergeTagResolution({
          resolve: evaluator.resolve,
          onResolved: (report) => reports.push(report),
          onError: (error) => errors.push(error),
          onPendingChange: (value) => pending.push(value),
        }),
      ],
      content,
    });
  };
  const action = () => editor.actions.find((a) => a.id === 'resolve-placeholders')!;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    evaluator = deferredHost();
    reports = [];
    errors = [];
    pending = [];
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('asks for each distinct expression once, raw — no entity in sight', () => {
    mount(
      '<div>{{ cf_3 &gt; 0 &amp;&amp; cf_4 ? \'Kosten\' : \'\' }} {{customer_lastName}}</div>' +
        '<div>{{ customer_lastName }} {{ cf_12 | formatDateDE }}</div>',
    );
    expect(editor.commands['resolveMergeTags']()).toBe(true);
    expect(evaluator.asked).toEqual([
      ["cf_3 > 0 && cf_4 ? 'Kosten' : ''", 'customer_lastName', 'cf_12 | formatDateDE'],
    ]);
  });

  it('puts each value in as text, in the token’s place and with its formatting', async () => {
    mount('<div>Sehr geehrte <strong>{{ customer_lastName }}</strong>, Ihr Zeichen {{ case_reference }}.</div>');
    editor.commands['resolveMergeTags']();
    await evaluator.answer(['<b>Müller</b> & Co', 'AZ-7']);
    expect(editor.getHTML()).toBe(
      '<div>Sehr geehrte <strong>&lt;b&gt;Müller&lt;/b&gt; &amp; Co</strong>, Ihr Zeichen AZ-7.</div>',
    );
    expect(reports).toEqual([{ scope: 'document', filled: 2, empty: [], kept: [] }]);
  });

  it('is one step back: a single undo brings every token back', async () => {
    const html = '<div>{{ a }} und {{ b }}</div>';
    mount(html);
    const before = editor.getHTML();
    editor.commands['resolveMergeTags']();
    await evaluator.answer(['A', 'B']);
    expect(editor.getText()).toBe('A und B');
    editor.exec(undo);
    expect(editor.getHTML()).toBe(before);
  });

  it('an empty value removes its token, null keeps it — and the report says which', async () => {
    mount('<div>[{{ a }}] [{{ b }}] [{{ c }}]</div>');
    editor.commands['resolveMergeTags']();
    await evaluator.answer(['A', '', null]);
    expect(editor.getText()).toBe('[A] [] [{{ c }}]');
    expect(reports).toEqual([{ scope: 'document', filled: 2, empty: ['b'], kept: ['c'] }]);
  });

  it('a line break in a value becomes a hard break', async () => {
    mount('<div>{{ customer_address }}</div>');
    editor.commands['resolveMergeTags']();
    await evaluator.answer(['Hauptstr. 1\n10115 Berlin']);
    expect(editor.getHTML()).toBe('<div>Hauptstr. 1<br>10115 Berlin</div>');
  });

  it('fills tokens in attributes too: a link’s href, an image’s src, a button', async () => {
    mount(
      '<div><a href="https://portal.example.com/akte/{{ case_id }}">Akte</a> <a href="{{portal.link}}">Portal</a></div>' +
        '<div><img src="{{ logo_url }}" alt="Logo {{ company }}"></div>',
    );
    const button = editor.schema.nodes['button'].create({ href: '{{portal.link}}', label: 'Hallo {{ customer_lastName }}' });
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, button));

    editor.commands['resolveMergeTags']();
    expect(evaluator.asked[0]).toEqual(['case_id', 'portal.link', 'logo_url', 'company', 'customer_lastName']);
    await evaluator.answer(['4711', 'https://p.example.com/x', 'https://cdn.example.com/logo.png', 'Kanzlei', 'Müller']);

    const html = editor.getHTML();
    expect(html).toContain('href="https://portal.example.com/akte/4711"');
    expect(html).toContain('href="https://p.example.com/x"');
    expect(html).toContain('src="https://cdn.example.com/logo.png"');
    expect(html).toContain('alt="Logo Kanzlei"');
    expect(html).toContain('Hallo Müller');
    expect(html).not.toContain('{{');
    expect(reports[0].filled).toBe(6);
  });

  it('with a selection holding tokens, fills only those', async () => {
    mount('<div>{{ a }}</div><div>{{ b }}</div>');
    const second = editor.state.doc.child(0).nodeSize;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, second + 1, editor.state.doc.content.size - 1)),
    );
    editor.commands['resolveMergeTags']();
    expect(evaluator.asked).toEqual([['b']]);
    await evaluator.answer(['B']);
    expect(editor.getText()).toBe('{{ a }}\nB');
    expect(reports[0].scope).toBe('selection');
  });

  it('a selection without tokens falls back to the whole document', () => {
    mount('<div>Hallo</div><div>{{ a }}</div>');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
    editor.commands['resolveMergeTags']();
    expect(evaluator.asked).toEqual([['a']]);
  });

  it('follows what is written while the host answers; a token edited meanwhile stays', async () => {
    mount('<div>{{ a }} {{ b }} {{ c }}</div>');
    editor.commands['resolveMergeTags']();
    // Typing in front moves every token past where the scope first ended;
    // editing one changes its expression.
    editor.view.dispatch(editor.state.tr.insertText('Eine lange Einleitung, die alles verschiebt: ', 1));
    const c = editor.getText().indexOf('c }}');
    editor.view.dispatch(editor.state.tr.insertText('x', 1 + c + 1));
    await evaluator.answer(['A', 'B', 'C']);
    expect(editor.getText()).toBe('Eine lange Einleitung, die alles verschiebt: A B {{ cx }}');
  });

  it('one request at a time: refused and disabled while one is out, then free again', async () => {
    mount('<div>{{ a }}</div>');
    expect(action().isEnabled!(editor.state)).toBe(true);
    editor.commands['resolveMergeTags']();
    expect(mergeTagResolutionPending(editor.state)).toBe(true);
    expect(action().isEnabled!(editor.state)).toBe(false);
    expect(editor.commands['resolveMergeTags']()).toBe(false);
    expect(evaluator.asked).toHaveLength(1);
    expect(pending).toEqual([true]);

    await evaluator.answer([null]);
    expect(mergeTagResolutionPending(editor.state)).toBe(false);
    expect(action().isEnabled!(editor.state)).toBe(true);
    expect(pending).toEqual([true, false]);
  });

  it('a failed request leaves the document as it was and says so', async () => {
    mount('<div>{{ a }}</div>');
    const before = editor.getHTML();
    editor.commands['resolveMergeTags']();
    await evaluator.fail(new Error('503'));
    expect(editor.getHTML()).toBe(before);
    expect(errors).toEqual([new Error('503')]);
    expect(reports).toEqual([]);
    expect(mergeTagResolutionPending(editor.state)).toBe(false);
  });

  it('a dry run only answers, and a document without tokens offers nothing', () => {
    mount('<div>{{ a }}</div>');
    expect(editor.exec((state, _dispatch, view) => action().command(state, undefined, view))).toBe(true);
    expect(evaluator.asked).toEqual([]);

    mount('<div>Kein Platzhalter</div>');
    expect(action().isEnabled!(editor.state)).toBe(false);
    expect(editor.commands['resolveMergeTags']()).toBe(false);
  });

  it('Mod-Shift-Enter asks', () => {
    mount('<div>{{ a }}</div>');
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(evaluator.asked).toEqual([['a']]);
  });

  it('a value that is itself a token stays a token — the host may answer in steps', async () => {
    mount('<div>{{ salutation }}</div>');
    editor.commands['resolveMergeTags']();
    await evaluator.answer(['Hallo {{ customer_firstName }}']);
    expect(editor.getText()).toBe('Hallo {{ customer_firstName }}');
    expect(action().isEnabled!(editor.state)).toBe(true);
  });

  it('a destroyed editor ignores a late answer', async () => {
    mount('<div>{{ a }}</div>');
    editor.commands['resolveMergeTags']();
    editor.destroy();
    await evaluator.answer(['A']);
    expect(reports).toEqual([]);
    expect(pending).toEqual([true]);
    mount('<div></div>');
  });
});
