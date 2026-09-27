import { TextSelection } from 'prosemirror-state';
import {
  Editor,
  createContentStream,
  createEditor,
  emailExtensions,
  isActionEnabled,
  isStreaming,
  streamContent,
} from 'angular-email-editor';

import { Ai } from '../../../services/ai';
import { AiAsk, createAiWriter } from './ai-writer';

describe('createAiWriter', () => {
  let host: HTMLElement;
  let editor: Editor;
  let asked: AiAsk[];

  const action = () => editor.actions.find((candidate) => candidate.id === 'ai')!;
  const run = () => editor.exec(action().command);

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    asked = [];
    editor = createEditor({
      parent: host,
      extensions: [createAiWriter({ onAsk: (ask) => asked.push(ask) }), ...emailExtensions],
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

  it('only answers when asked whether it can run: nobody is asked, nothing opens', () => {
    expect(isActionEnabled(action(), editor.state)).toBe(true);
    expect(asked).toEqual([]);
  });

  it('run, it asks the host for the assistant with the text before the caret — and writes nothing itself', () => {
    const html = editor.getHTML();
    expect(run()).toBe(true);
    expect(asked).toEqual([{ before: 'We met last week.' }]);
    // The document is the host's to change, on Accept: the action leaves
    // it as it was.
    expect(editor.getHTML()).toBe(html);
  });

  it('the assistant’s whole email streams through the library with its empty lines intact', async () => {
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
        extensions: [...emailExtensions, createContentStream({ reveal: 'instant' })],
      });
      const run = streamContent(
        streamed.view,
        1,
        async ({ write, signal }) => {
          for await (const piece of real.write({ before: '', language }, { signal })) write(piece);
        },
        { format: 'html' },
      );
      await vi.runAllTimersAsync();
      await run.done;
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

  it('asked to be short, the stand-in keeps the greeting, the first paragraph and the sign-off', async () => {
    vi.useFakeTimers();
    const real = new Ai();
    const read = async (instructions: string) => {
      let email = '';
      const reading = (async () => {
        for await (const piece of real.write({ before: '', language: 'en', instructions })) {
          email += piece;
        }
      })();
      await vi.runAllTimersAsync();
      await reading;
      return email;
    };
    const whole = await read('');
    const short = await read('make it short');
    expect(short.length).toBeLessThan(whole.length);
    expect(short).toContain('Dear {{ firstName }}');
    expect(short).toContain('Best regards');
    expect(short).not.toContain('<ul>');
  });
});
