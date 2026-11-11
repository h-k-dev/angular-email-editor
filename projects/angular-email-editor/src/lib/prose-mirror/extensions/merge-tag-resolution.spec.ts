import { TextSelection } from 'prosemirror-state';
import { closeHistory, undo } from 'prosemirror-history';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import {
  FILLED_EDITED_CLASS,
  FilledMergeTagHover,
  MergeTagAnswer,
  MergeTagResolutionReport,
  REMOVE_MERGE_TAG,
  createMergeTagResolution,
  filledMergeTagAt,
  distinctMergeTagExpressions,
  mergeTagResolutionPending,
  revealMergeTag,
} from './merge-tag-resolution';
import { GUIDES_PEEK_DELAY_MS } from './layout-guides';
import { mergeTagRanges } from './nodes/merge-tag';

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
  return {
    asked,
    resolve,
    answer: async (values: MergeTagAnswer[]) => {
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
  let hovers: (FilledMergeTagHover | null)[];

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
          onFilledHover: (hover) => hovers.push(hover),
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
    hovers = [];
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
    expect(reports).toEqual([{ scope: 'document', filled: 2, empty: [], kept: [], removed: [] }]);
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

  it('an empty value keeps its token, as null does — only the writer removes one; the report says which', async () => {
    mount('<div>[{{ a }}] [{{ b }}] [{{ c }}]</div>');
    editor.commands['resolveMergeTags']();
    await evaluator.answer(['A', '', null]);
    expect(editor.getText()).toBe('[A] [{{ b }}] [{{ c }}]');
    expect(reports).toEqual([{ scope: 'document', filled: 1, empty: ['b'], kept: ['c'], removed: [] }]);
  });

  describe('taken out on the host’s word', () => {
    it('removes the tokens it says, in the fill’s own step — one undo brings all back', async () => {
      const html = '<div>Sehr geehrte {{ title }} {{ name }}{{ suffix }}, Ihr {{ gap }}.</div>';
      mount(html);
      const before = editor.getHTML();
      editor.commands['resolveMergeTags']();
      await evaluator.answer([REMOVE_MERGE_TAG, 'Müller', REMOVE_MERGE_TAG, '']);
      expect(editor.getText()).toBe('Sehr geehrte Müller, Ihr {{ gap }}.');
      expect(reports).toEqual([
        { scope: 'document', filled: 1, empty: ['gap'], kept: [], removed: ['title', 'suffix'] },
      ]);
      editor.exec(undo);
      expect(editor.getHTML()).toBe(before);
    });

    it('with nothing to fill in, the removal is the step', async () => {
      mount('<div>Hallo {{ title }} Welt</div>');
      const before = editor.getHTML();
      editor.commands['resolveMergeTags']();
      await evaluator.answer([REMOVE_MERGE_TAG]);
      expect(editor.getText()).toBe('Hallo Welt');
      expect(reports[0]).toEqual(expect.objectContaining({ filled: 0, removed: ['title'] }));
      editor.exec(undo);
      expect(editor.getHTML()).toBe(before);
    });

    it('takes it out of an attribute too', async () => {
      mount('<div><a href="https://example.com/{{ id }}">Akte</a></div>');
      editor.commands['resolveMergeTags']();
      await evaluator.answer([REMOVE_MERGE_TAG]);
      expect(editor.getHTML()).toContain('href="https://example.com/"');
    });
  });

  it('an empty value keeps an attribute’s token too', async () => {
    mount('<div><a href="https://example.com/{{ id }}">Akte</a></div>');
    editor.commands['resolveMergeTags']();
    await evaluator.answer(['']);
    expect(editor.getHTML()).toContain('href="https://example.com/{{ id }}"');
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

  describe('where a value came from', () => {
    /** Every fill in the document: its id, its expression, its text. */
    const fills = () => {
      const found: { id: string; expr: string; text: string }[] = [];
      editor.state.doc.descendants((node) => {
        const mark = node.marks.find((m) => m.type.name === 'filledMergeTag');
        if (!mark || !node.isText) return;
        const last = found.at(-1);
        if (last && last.id === mark.attrs['id']) last.text += node.text;
        else found.push({ id: mark.attrs['id'], expr: mark.attrs['expr'], text: node.text! });
      });
      return found;
    };
    const fill = async (html: string, values: (string | null)[]) => {
      mount(html);
      editor.commands['resolveMergeTags']();
      await evaluator.answer(values);
    };
    const posOf = (text: string) => {
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (at < 0 && node.isText && node.text!.includes(text)) at = pos + node.text!.indexOf(text);
      });
      return at;
    };

    it('marks each value with its token — one fill each, even for the same expression', async () => {
      await fill('<div>{{ a }} und {{ a }} und {{ b }}</div>', ['A', 'B']);
      const found = fills();
      expect(found.map(({ expr, text }) => [expr, text])).toEqual([
        ['a', 'A'],
        ['a', 'A'],
        ['b', 'B'],
      ]);
      expect(new Set(found.map((f) => f.id)).size).toBe(3);
    });

    it('leaves no trace in the email', async () => {
      await fill('<div>Hallo <strong>{{ name }}</strong></div>', ['Müller']);
      expect(editor.getHTML()).toBe('<div>Hallo <strong>Müller</strong></div>');
      expect(editor.view.dom.querySelector('[data-aee-filled]')?.getAttribute('data-aee-expr')).toBe('name');
    });

    it('a value over two lines is one value', async () => {
      await fill('<div>An {{ address }}!</div>', ['Hauptstr. 1\n10115 Berlin']);
      const range = filledMergeTagAt(editor.state.doc, posOf('10115'))!;
      expect(editor.state.doc.textBetween(range.from, range.to, '|', '|')).toBe('Hauptstr. 1|10115 Berlin');
    });

    it('restores the token, a pill again, with the value’s formatting — one undo away', async () => {
      await fill('<div>Hallo <strong>{{ name }}</strong>, {{ x }}</div>', ['Müller', 'X']);
      const filled = editor.getHTML();
      editor.view.dispatch(closeHistory(editor.state.tr));
      expect(editor.commands['restoreMergeTag'](posOf('Müller') + 2)).toBe(true);
      expect(editor.getHTML()).toBe('<div>Hallo <strong>{{ name }}</strong>, X</div>');
      expect(mergeTagRanges(editor.state.doc).map((tag) => tag.expr.trim())).toEqual(['name']);
      editor.exec(undo);
      expect(editor.getHTML()).toBe(filled);
    });

    it('restores one fill of an expression, not its twin', async () => {
      await fill('<div>{{ a }} und {{ a }}</div>', ['A']);
      editor.commands['restoreMergeTag'](editor.state.doc.content.size - 2);
      expect(editor.getText()).toBe('A und {{ a }}');
    });

    it('a value over two lines comes back as one token', async () => {
      await fill('<div>An {{ address }}!</div>', ['Hauptstr. 1\n10115 Berlin']);
      editor.commands['restoreMergeTag'](posOf('10115'));
      expect(editor.getHTML()).toBe('<div>An {{ address }}!</div>');
    });

    it('with the caret at a value’s end, the caret’s value', async () => {
      await fill('<div>{{ a }} und</div>', ['Anna']);
      const end = posOf('Anna') + 4;
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
      expect(editor.commands['restoreMergeTag']()).toBe(true);
      expect(editor.getText()).toBe('{{ a }} und');
    });

    it('nothing to restore where no value was filled in', async () => {
      await fill('<div>{{ a }} und</div>', ['Anna']);
      expect(editor.commands['restoreMergeTag'](posOf('und'))).toBe(false);
    });

    it('typing at a value’s edge is the writer’s own text', async () => {
      await fill('<div>[{{ a }}]</div>', ['Anna']);
      const end = posOf('Anna') + 4;
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
      editor.view.dispatch(editor.state.tr.insertText('s'));
      expect(fills().map((f) => f.text)).toEqual(['Anna']);
    });

    it('survives clearing the formatting — it is not formatting', async () => {
      await fill('<div><strong>{{ a }}</strong></div>', ['Anna']);
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, editor.state.doc.content.size - 1)),
      );
      editor.commands['clearFormatting']();
      expect(editor.getHTML()).toBe('<div>Anna</div>');
      expect(fills().map((f) => f.text)).toEqual(['Anna']);
    });

    it('a pasted value is a fill of its own', async () => {
      await fill('<div>{{ a }}</div>', ['Anna']);
      const [original] = fills();
      const html = editor.view.dom.innerHTML;
      const event = Object.assign(new Event('paste'), {
        clipboardData: { getData: (type: string) => (type === 'text/html' ? html : '') },
      }) as unknown as ClipboardEvent;
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1)));
      editor.view.pasteHTML(html, event);
      const after = fills();
      expect(after.map((f) => [f.expr, f.text])).toEqual([
        ['a', 'Anna'],
        ['a', 'Anna'],
      ]);
      expect(after[0].id).toBe(original.id);
      expect(after[1].id).not.toBe(original.id);
    });

    describe('under the Ctrl peek', () => {
      beforeEach(() => vi.useFakeTimers());
      afterEach(() => vi.useRealTimers());

      const key = (type: 'keydown' | 'keyup', name = 'Control') =>
        document.dispatchEvent(new KeyboardEvent(type, { key: name, bubbles: true }));
      const peek = () => {
        key('keydown');
        vi.advanceTimersByTime(GUIDES_PEEK_DELAY_MS + 1);
      };
      const pointTo = (element: Element) =>
        element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      const value = () => editor.view.dom.querySelector<HTMLElement>('[data-aee-filled]')!;

      it('reports the value under the pointer only while Ctrl is held', async () => {
        await fill('<div>Hallo {{ name }}</div>', ['Müller']);
        pointTo(value());
        expect(hovers).toEqual([]);
        peek();
        expect(hovers.map((h) => h && h.expr)).toEqual(['name']);
        expect(hovers[0]!.element).toBe(value());
      });

      it('stays up with Ctrl released while the pointer is on it, goes when it leaves', async () => {
        await fill('<div>Hallo {{ name }}</div>', ['Müller']);
        peek();
        pointTo(value());
        key('keyup');
        expect(hovers.map((h) => h && h.expr)).toEqual(['name']);
        pointTo(editor.view.dom.querySelector('div')!);
        expect(hovers.map((h) => h && h.expr)).toEqual(['name', null]);
      });

      it('a shortcut is no peek', async () => {
        await fill('<div>Hallo {{ name }}</div>', ['Müller']);
        pointTo(value());
        key('keydown');
        key('keydown', 'b');
        vi.advanceTimersByTime(GUIDES_PEEK_DELAY_MS + 1);
        expect(hovers).toEqual([]);
      });

      it('its restore puts the token back, and the card is told it is gone', async () => {
        await fill('<div>Hallo {{ name }}</div>', ['Müller']);
        peek();
        pointTo(value());
        expect(hovers[0]!.restore()).toBe(true);
        expect(editor.getText()).toBe('Hallo {{ name }}');
        expect(hovers.at(-1)).toBeNull();
        expect(hovers[0]!.restore()).toBe(false);
      });

      it('reports what the value is now, and edits it by hand', async () => {
        await fill('<div>Hallo {{ name }}</div>', ['Müller']);
        peek();
        pointTo(value());
        expect(hovers[0]).toEqual(
          expect.objectContaining({ expr: 'name', value: 'Müller', text: 'Müller', edited: false }),
        );
        expect(hovers[0]!.edit('Frau Müller')).toBe(true);
        expect(editor.getText()).toBe('Hallo Frau Müller');
        expect(fills().map((f) => [f.expr, f.text])).toEqual([['name', 'Frau Müller']]);
        pointTo(value());
        expect(hovers.at(-1)).toEqual(expect.objectContaining({ text: 'Frau Müller', edited: true }));
      });
    });

    describe('written over by hand', () => {
      const edited = () =>
        [...editor.view.dom.querySelectorAll(`.${FILLED_EDITED_CLASS}`)].map((e) => e.textContent).join('');

      it('keeps the value as filled in; untouched, it is not edited', async () => {
        await fill('<div>{{ address }}</div>', ['Hauptstr. 1\n10115 Berlin']);
        expect(filledMergeTagAt(editor.state.doc, 1)).toEqual(
          expect.objectContaining({ value: 'Hauptstr. 1\n10115 Berlin', text: 'Hauptstr. 1\n10115 Berlin', edited: false }),
        );
        expect(edited()).toBe('');
      });

      it('an edit stays the token’s — same fill, its formatting, one undo away', async () => {
        await fill('<div>Hallo <strong>{{ name }}</strong>!</div>', ['Müller']);
        const [before] = fills();
        editor.view.dispatch(closeHistory(editor.state.tr));
        expect(editor.commands['editFilledValue']('Frau\nMüller', posOf('Müller'))).toBe(true);
        // A value's line break is a bare `<br>`, as on fill.
        expect(editor.getHTML()).toBe('<div>Hallo <strong>Frau</strong><br><strong>Müller</strong>!</div>');
        const range = filledMergeTagAt(editor.state.doc, posOf('Frau'))!;
        expect(range).toEqual(
          expect.objectContaining({ id: before.id, expr: 'name', value: 'Müller', text: 'Frau\nMüller', edited: true }),
        );
        expect(edited()).toBe('FrauMüller');
        editor.exec(undo);
        expect(editor.getHTML()).toBe('<div>Hallo <strong>Müller</strong>!</div>');
        expect(edited()).toBe('');
      });

      it('typing inside a value makes it edited too — derived, never flagged', async () => {
        await fill('<div>{{ name }}</div>', ['Anna']);
        editor.view.dispatch(editor.state.tr.insertText('nn', posOf('Anna') + 2));
        expect(filledMergeTagAt(editor.state.doc, 1)).toEqual(
          expect.objectContaining({ text: 'Annnna', edited: true }),
        );
        expect(edited()).toBe('Annnna');
      });

      it('reset takes the filled value back; on an untouched value there is nothing to reset', async () => {
        await fill('<div>{{ name }} und {{ city }}</div>', ['Anna', 'Berlin']);
        editor.commands['editFilledValue']('Hanna', posOf('Anna'));
        expect(editor.commands['resetFilledValue'](posOf('Berlin'))).toBe(false);
        expect(editor.commands['resetFilledValue'](posOf('Hanna'))).toBe(true);
        expect(editor.getText()).toBe('Anna und Berlin');
        expect(edited()).toBe('');
        expect(fills().map((f) => f.expr)).toEqual(['name', 'city']);
      });

      it('an empty edit is refused — the value, and where it came from, would be gone', async () => {
        await fill('<div>{{ name }}</div>', ['Anna']);
        expect(editor.commands['editFilledValue']('', 1)).toBe(false);
        expect(editor.getText()).toBe('Anna');
      });

      it('restoring an edited value brings the token back all the same', async () => {
        await fill('<div>{{ name }}</div>', ['Anna']);
        editor.commands['editFilledValue']('Hanna', 1);
        editor.commands['restoreMergeTag'](1);
        expect(editor.getText()).toBe('{{ name }}');
      });
    });

    describe('a token without a value', () => {
      const selected = () =>
        editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);

      it('lists every expression once, in reading order — text and attributes', () => {
        mount(
          '<div>{{ b }} <a href="https://x.example/{{ a }}">x</a> {{ b }}</div><div>{{ c | upper }}</div>',
        );
        expect(distinctMergeTagExpressions(editor.state.doc)).toEqual(['b', 'c | upper', 'a']);
      });

      it('selects the first token holding an expression', () => {
        mount('<div>Hallo {{ name }} und {{ name }}</div>');
        expect(editor.commands['selectMergeTag']('name')).toBe(true);
        expect(selected()).toBe('{{ name }}');
        expect(editor.state.selection.from).toBe(posOf('{{ name }}'));
        expect(editor.commands['selectMergeTag']('missing')).toBe(false);
      });

      it('selects the linked text whose href holds it', () => {
        mount('<div>Zur <a href="https://x.example/{{ id }}">Akte</a></div>');
        editor.commands['selectMergeTag']('id');
        expect(selected()).toBe('Akte');
      });

      it('reveals it: focused, selected, and the pill to open a card by', () => {
        mount('<div>Hallo {{ name }}</div>');
        const element = revealMergeTag(editor.view, 'name');
        expect(element?.classList.contains('aee-merge-tag')).toBe(true);
        expect(element?.textContent).toBe('{{ name }}');
        expect(selected()).toBe('{{ name }}');
        expect(revealMergeTag(editor.view, 'missing')).toBeNull();
      });

      it('scrolls to it even from outside the editor — a Send button has the focus', () => {
        mount('<div>Hallo {{ name }}</div>');
        const button = document.createElement('button');
        document.body.append(button);
        button.focus();
        // ProseMirror scrolls to a selection by measuring it — and only while
        // the DOM's selection is in the editor; the measure is the tell.
        const measured: number[] = [];
        editor.view.coordsAtPos = (pos: number) => {
          measured.push(pos);
          return { left: 0, right: 0, top: 0, bottom: 0 };
        };
        try {
          revealMergeTag(editor.view, 'name');
          expect(document.activeElement).toBe(editor.view.dom);
          expect(measured).toContain(editor.state.selection.head);
        } finally {
          button.remove();
        }
      });

      it('a value written by hand takes every token’s place, still the token’s — edited from the start', () => {
        mount('<div>Hallo <strong>{{ name }}</strong>, {{ name }}!</div>');
        expect(editor.commands['writeMergeTag']('name', 'Frau Müller')).toBe(true);
        expect(editor.getHTML()).toBe('<div>Hallo <strong>Frau Müller</strong>, Frau Müller!</div>');
        expect(fills().map((f) => [f.expr, f.text])).toEqual([
          ['name', 'Frau Müller'],
          ['name', 'Frau Müller'],
        ]);
        expect(filledMergeTagAt(editor.state.doc, posOf('Frau'))).toEqual(
          expect.objectContaining({ value: '', edited: true }),
        );
        // The caret was nowhere near: it stays a caret.
        expect(editor.state.selection.empty).toBe(true);
        // Nothing was filled in, so there is nothing to reset to.
        expect(editor.commands['resetFilledValue'](posOf('Frau'))).toBe(false);
        editor.exec(undo);
        expect(editor.getText()).toBe('Hallo {{ name }}, {{ name }}!');
      });

      it('written over the selected token, the caret goes after the value — no range left selected', () => {
        mount('<div>Hallo {{ name }}!</div>');
        editor.commands['selectMergeTag']('name');
        editor.commands['writeMergeTag']('name', 'Anna');
        expect(editor.state.selection.empty).toBe(true);
        expect(editor.state.selection.from).toBe(posOf('Anna') + 4);
      });

      it('writes into an attribute as text', () => {
        mount('<div><a href="https://x.example/{{ id }}">Akte</a></div>');
        editor.commands['writeMergeTag']('id', '4711');
        expect(editor.getHTML()).toContain('href="https://x.example/4711"');
      });

      it('remove is the explicit empty value: every token holding it goes', () => {
        mount('<div>[{{ title }}] Müller <a href="https://x.example/{{ title }}">x</a></div>');
        expect(editor.commands['removeMergeTag']('title')).toBe(true);
        expect(editor.getText()).toBe('[] Müller x');
        expect(editor.getHTML()).toContain('href="https://x.example/"');
        expect(fills()).toEqual([]);
        expect(editor.commands['removeMergeTag']('title')).toBe(false);
      });

      describe('removed, the text closed up', () => {
        /** The lines once `expressions` are removed. */
        const removed = (html: string, ...expressions: string[]) => {
          mount(html);
          expect(editor.commands['removeMergeTags'](expressions)).toBe(true);
          return editor.getText();
        };

        it('one space goes with a token between two', () => {
          expect(removed('<div>i invite {{ a }} to case 1</div>', 'a')).toBe('i invite to case 1');
        });

        it('at a line’s start or end, the space on its other side', () => {
          expect(removed('<div>{{ a }} invites you</div><div>see {{ a }}</div>', 'a')).toBe('invites you\nsee');
        });

        it('closes up before punctuation, and leaves the tokens it was not asked for', () => {
          expect(removed('<div>Dear {{ a }}, from {{ b }}.</div>', 'a')).toBe('Dear, from {{ b }}.');
          expect(removed('<div>Dear {{ a }}, from {{ b }}.</div>', 'b')).toBe('Dear {{ a }}, from.');
        });

        it('tokens side by side, or a space apart, go as one — every occurrence', () => {
          expect(removed('<div>a {{ x }}{{ x }} b {{ x }} c</div>', 'x')).toBe('a b c');
          expect(removed('<div>a {{ x }} {{ y }} b</div>', 'x', 'y')).toBe('a b');
          expect(removed('<div>a {{ x }} {{ y }}.</div>', 'x', 'y')).toBe('a.');
        });

        it('a line of nothing else is left empty, the next one untouched', () => {
          expect(removed('<div>{{ x }} {{ y }}</div><div>{{ z }} bleibt</div>', 'x', 'y')).toBe(
            '\n{{ z }} bleibt',
          );
        });

        it('a token between two removed ones keeps its place', () => {
          expect(removed('<div>{{ x }} {{ keep }} {{ y }}</div>', 'x', 'y')).toBe('{{ keep }}');
        });

        it('a line break is a line’s end', () => {
          mount('<div>a {{ x }}<br>{{ x }} b</div>');
          editor.commands['removeMergeTags'](['x']);
          expect(editor.getHTML()).toBe('<div>a<br>b</div>');
        });

        it('several expressions are one step, and the caret stays where it was', () => {
          mount('<div>Hallo {{ x }} und {{ y }} Welt</div>');
          const before = editor.getHTML();
          const caret = posOf('Welt') + 2;
          editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, caret)));
          editor.commands['removeMergeTags'](['x', ' y ']);
          expect(editor.getText()).toBe('Hallo und Welt');
          expect(editor.state.selection.from).toBe(posOf('Welt') + 2);
          editor.exec(undo);
          expect(editor.getHTML()).toBe(before);
        });

        it('says no where no token holds any of them', () => {
          mount('<div>Hallo {{ x }}</div>');
          expect(editor.commands['removeMergeTags'](['y', 'z'])).toBe(false);
          expect(editor.commands['removeMergeTags']([])).toBe(false);
        });
      });
    });
  });
});
