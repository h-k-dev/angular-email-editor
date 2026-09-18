import { TextSelection } from 'prosemirror-state';
import {
  Editor,
  createContentStream,
  createEditor,
  emailExtensions,
  isActionEnabled,
  isStreaming,
} from 'angular-email-editor';

import { Ai, AiOptions, AiRequest } from '../../../services/ai';
import { createAiWriter } from './ai-writer';

describe('createAiWriter', () => {
  let host: HTMLElement;
  let editor: Editor;
  let asked: AiRequest[];
  let aborted: boolean;

  /** The assistant's pieces, handed over one at a time by the spec. */
  let feed: (piece: string | null) => Promise<void>;

  const ai = {
    write: async function* (request: AiRequest, { signal }: AiOptions = {}) {
      asked.push(request);
      signal?.addEventListener('abort', () => (aborted = true));
      const waiting: Array<(piece: string | null) => void> = [];
      const ready: Array<string | null> = [];
      feed = async (piece) => {
        const next = waiting.shift();
        if (next) next(piece);
        else ready.push(piece);
        // Let the writer take it and dispatch.
        await new Promise((resolve) => setTimeout(resolve, 0));
      };
      while (true) {
        const piece = ready.length
          ? ready.shift()!
          : await new Promise<string | null>((resolve) => waiting.push(resolve));
        if (piece === null || signal?.aborted) return;
        yield piece;
      }
    },
  } as unknown as Ai;

  const action = () => editor.actions.find((candidate) => candidate.id === 'ai')!;
  const run = () => editor.exec(action().command);
  const text = () => editor.state.doc.textContent;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    asked = [];
    aborted = false;
    editor = createEditor({
      parent: host,
      extensions: [
        createAiWriter({ ai, language: () => 'de' }),
        ...emailExtensions,
        // Written the moment it comes, so the spec reads it at once.
        createContentStream({ reveal: 'instant' }),
      ],
      content: '<div>We met last week.</div>',
    });
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
  });

  afterEach(() => {
    vi.useRealTimers();
    editor.destroy();
    host.remove();
  });

  it('is one action of the kit — first in it, so first in a / menu — not a level of its own', () => {
    expect(editor.actions[0]).toMatchObject({ id: 'ai', icon: 'auto_awesome' });
    expect(editor.actions[0].isActive).toBeUndefined();
  });

  it('only answers when asked whether it can run: nobody is called, nothing streams', () => {
    expect(isActionEnabled(action(), editor.state)).toBe(true);
    expect(asked).toEqual([]);
    expect(isStreaming(editor.state)).toBe(false);
  });

  it('asks the assistant with the text before the caret and the language in use', () => {
    run();
    expect(asked).toEqual([{ before: 'We met last week.', language: 'de' }]);
  });

  it('streams the answer in through the library — HTML, so a bold phrase arrives bold', async () => {
    run();
    await feed(' Bitte');
    await feed(' <strong>lesen');
    expect(text()).toBe('We met last week. Bitte lesen');
    await feed(' Sie</strong> das.');
    expect(text()).toBe('We met last week. Bitte lesen Sie das.');
    expect(editor.getHTML()).toContain('<strong style="font-weight: bold;">lesen Sie</strong>');
    await feed(null);
    expect(isStreaming(editor.state)).toBe(false);
  });

  it('writes one thing at a time: the action cannot run again until it is done', async () => {
    run();
    await feed(' Bitte');
    expect(isActionEnabled(action(), editor.state)).toBe(false);
    expect(run()).toBe(false);
    expect(asked).toHaveLength(1);
    await feed(null);
    expect(isActionEnabled(action(), editor.state)).toBe(true);
  });

  it('keeps the empty lines of a whole email streamed in piece by piece', async () => {
    vi.useFakeTimers();
    for (const language of ['en', 'de', 'ja'] as const) {
      const real = new Ai();
      let email = '';
      const reading = (async () => {
        for await (const piece of real.write({ before: '', language })) email += piece;
      })();
      await vi.runAllTimersAsync();
      await reading;
      const streamed = createEditor({
        parent: host,
        extensions: [
          createAiWriter({ ai: real, language: () => language }),
          ...emailExtensions,
          createContentStream({ reveal: 'instant' }),
        ],
      });
      streamed.exec(streamed.actions.find((candidate) => candidate.id === 'ai')!.command);
      await vi.runAllTimersAsync();
      expect(isStreaming(streamed.state)).toBe(false);
      const whole = createEditor({ parent: host, extensions: emailExtensions, content: email });
      expect(streamed.getHTML()).toBe(whole.getHTML());
      const gaps = (html: string) => html.split('<div><br></div>').length - 1;
      expect(gaps(streamed.getHTML())).toBe(gaps(email));
      expect(gaps(email)).toBeGreaterThanOrEqual(5);
      streamed.destroy();
      whole.destroy();
    }
  });

  it('tells the assistant to stop when the writer presses Escape', async () => {
    run();
    await feed(' Bitte');
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(aborted).toBe(true);
    await feed(' lesen');
    expect(text()).toBe('We met last week. Bitte');
  });
});
