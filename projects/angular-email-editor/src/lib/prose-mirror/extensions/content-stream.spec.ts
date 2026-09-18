import { TextSelection } from 'prosemirror-state';
import { Editor, createEditor } from '../editor';
import {
  ContentStreamState,
  ContentStreamWriter,
  createContentStream,
  isStreaming,
  streamContent,
  streamingRange,
} from './content-stream';
import { richTextExtensions } from './kits';

describe('createContentStream / streamContent', () => {
  let host: HTMLElement;
  let editor: Editor;
  let changes: ContentStreamState[];

  const text = () => editor.state.doc.textContent;
  const html = () => editor.getHTML();
  const caret = () => editor.view.dom.querySelector('.aee-stream-caret');
  const end = () => editor.state.doc.content.size - 1;

  const select = (from: number, to?: number) =>
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
    );

  /** A stream the spec drives by hand: `writer` to write, `finish` to end it. */
  const open = (
    target: Parameters<typeof streamContent>[1],
    options?: Parameters<typeof streamContent>[3],
  ) => {
    let writer!: ContentStreamWriter;
    let finish!: () => void;
    let fail!: (reason: unknown) => void;
    const run = streamContent(
      editor.view,
      target,
      (given) => {
        writer = given;
        return new Promise<void>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        });
      },
      options,
    );
    return { run, writer, finish: () => finish(), fail: (reason: unknown) => fail(reason) };
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    changes = [];
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        // Written the moment it comes: what these say is where it goes.
        createContentStream({ reveal: 'instant', onChange: (state) => changes.push(state) }),
      ],
      content: '<p>We met last week.</p>',
    });
    select(end());
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  describe('text', () => {
    it('appends each piece where the last one ended', async () => {
      const { run, writer, finish } = open(end());
      writer.write(' I');
      writer.write(' am');
      writer.write(' writing.');
      expect(text()).toBe('We met last week. I am writing.');
      finish();
      expect(await run.done).toBe(true);
      expect(isStreaming(editor.state)).toBe(false);
    });

    it('takes the caret along, as someone typing would', () => {
      const { writer, finish } = open(end());
      writer.write(' More.');
      expect(editor.state.selection.from).toBe(end());
      finish();
    });

    it('replaces a range with its first piece — "rewrite this selection"', async () => {
      const { run, writer, finish } = open({ from: 4, to: 7 });
      expect(text()).toBe('We met last week.');
      writer.write('spo');
      writer.write('ke');
      expect(text()).toBe('We spoke last week.');
      finish();
      await run.done;
    });

    it('never reads a tag: text is text', () => {
      const { writer, finish } = open(end());
      writer.write(' <b>not bold</b>');
      expect(text()).toContain('<b>not bold</b>');
      expect(html()).not.toContain('<strong');
      finish();
    });
  });

  describe('html', () => {
    it('lets a bold word take shape as it streams — a tag cut in two never shows', () => {
      const { writer, finish } = open(end(), { format: 'html' });
      writer.write(' Please <str');
      // (The space before the next word arrives with the next word.)
      expect(text()).toBe('We met last week. Please');
      writer.write('ong>read');
      expect(html()).toContain('<strong style="font-weight: bold;">read</strong>');
      writer.write(' this</strong> today.');
      expect(text()).toBe('We met last week. Please read this today.');
      expect(html()).toContain('<strong style="font-weight: bold;">read this</strong>');
      finish();
    });

    it('joins the line it is written into, then goes on in blocks — a list forms item by item', () => {
      const { writer, finish } = open(end(), { format: 'html' });
      writer.write(' Three things:<ul><li>One');
      expect(html()).toContain('We met last week. Three things:');
      expect(editor.view.dom.querySelectorAll('li')).toHaveLength(1);
      writer.write('</li><li>Two</li><li>Thr');
      expect(editor.view.dom.querySelectorAll('li')).toHaveLength(3);
      writer.write('ee</li></ul>');
      expect([...editor.view.dom.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
        'One',
        'Two',
        'Three',
      ]);
      finish();
    });

    it('rewrites the buffer before reading it, when given a transform', () => {
      const { writer, finish } = open(end(), {
        format: 'html',
        transform: (buffer) => buffer.replace(/^```html\n?/, '').replace(/```$/, ''),
      });
      writer.write('```html\n <em>fenced</em>');
      writer.write('```');
      expect(text()).toBe('We met last week. fenced');
      expect(html()).toContain('<em');
      finish();
    });
  });

  describe('while the writer keeps typing', () => {
    it('keeps its place when text arrives before it', () => {
      const { writer, finish } = open(end());
      writer.write(' I');
      editor.view.dispatch(editor.state.tr.insertText('Hello! ', 1));
      writer.write(' am.');
      expect(text()).toBe('Hello! We met last week. I am.');
      finish();
    });

    it('leaves alone what is typed right at its edges: a re-read never writes over it', () => {
      const { writer, finish } = open(end(), { format: 'html' });
      writer.write(' <em>soft</em>');
      const { from, to } = streamingRange(editor.state)!;
      // Typed right after what has streamed in so far…
      editor.view.dispatch(editor.state.tr.insertText('!', to));
      // …and right before it.
      editor.view.dispatch(editor.state.tr.insertText('(', from));
      writer.write(' <em>words</em>');
      expect(text()).toBe('We met last week.( soft words!');
      finish();
    });
  });

  describe('what it shows and says', () => {
    it('puts a caret after the last thing written, and says the editor is busy', () => {
      const { writer, finish } = open(end());
      writer.write(' Going');
      expect(caret()).not.toBeNull();
      expect(caret()!.getAttribute('aria-hidden')).toBe('true');
      expect(editor.view.dom.getAttribute('aria-busy')).toBe('true');
      finish();
    });

    it('takes both away when it ends', async () => {
      const { run, writer, finish } = open(end());
      writer.write(' Going');
      finish();
      await run.done;
      expect(caret()).toBeNull();
      expect(editor.view.dom.hasAttribute('aria-busy')).toBe(false);
    });

    it('tells the host when it starts, writes and ends', async () => {
      const { run, writer, finish } = open(end());
      writer.write(' A');
      finish();
      await run.done;
      expect(changes.map((change) => change.streaming)).toEqual([true, true, false]);
      expect(changes[1].range).toEqual({ from: 18, to: 20 });
      expect(changes[2].range).toBeNull();
    });

    it('shows no caret when asked not to', () => {
      editor.destroy();
      editor = createEditor({
        parent: host,
        extensions: [...richTextExtensions, createContentStream({ caret: false, reveal: 'instant' })],
        content: '<p>Text</p>',
      });
      const { writer, finish } = open(1);
      writer.write('x');
      expect(caret()).toBeNull();
      finish();
    });
  });

  describe('stopping', () => {
    it('stops on Escape: what is written stays, the rest is not, the signal aborts', async () => {
      const { run, writer } = open(end());
      writer.write(' Half');
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      editor.view.dom.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(writer.signal.aborted).toBe(true);
      expect(isStreaming(editor.state)).toBe(false);

      writer.write(' a sentence');
      expect(text()).toBe('We met last week. Half');
      expect(await run.done).toBe(false);
    });

    it('leaves Escape alone while nothing streams', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      editor.view.dom.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });

    it('stops when asked, and when the editor goes away', async () => {
      const first = open(end());
      first.run.stop();
      expect(await first.run.done).toBe(false);

      const second = open(end());
      editor.destroy();
      expect(second.writer.signal.aborted).toBe(true);
      expect(await second.run.done).toBe(false);
    });

    it('treats an abort thrown by the callback as a stop, anything else as a failure', async () => {
      const aborted = open(end());
      aborted.run.stop();
      aborted.fail(new DOMException('The request was aborted.', 'AbortError'));
      expect(await aborted.run.done).toBe(false);

      const broken = open(end());
      broken.fail(new Error('503'));
      await expect(broken.run.done).rejects.toThrow('503');
      expect(isStreaming(editor.state)).toBe(false);
    });
  });

  describe('one at a time, and only where it is installed', () => {
    it('refuses a second stream while one runs', () => {
      const { finish } = open(end());
      expect(() => open(end())).toThrow(/already running/);
      finish();
    });

    it('says what is missing when the extension is not in the kit', () => {
      const bare = createEditor({ parent: host, extensions: richTextExtensions });
      expect(() => streamContent(bare.view, 1, () => undefined)).toThrow(/createContentStream/);
      bare.destroy();
    });
  });

  it('writes what is piped into it — a response body, in text or in bytes', async () => {
    const run = streamContent(editor.view, end(), async ({ getWritableStream }) => {
      const stream = getWritableStream().getWriter();
      await stream.write(' Piped');
      await stream.write(new TextEncoder().encode(' bytes: é'));
      await stream.close();
    });
    expect(await run.done).toBe(true);
    expect(text()).toBe('We met last week. Piped bytes: é');
  });

  it('is one undo away when its pieces follow each other closely', async () => {
    const { run, writer, finish } = open(end());
    writer.write(' One');
    writer.write(' two');
    writer.write(' three.');
    finish();
    await run.done;
    editor.commands['undo']();
    expect(text()).toBe('We met last week.');
  });

  describe('character — a steady pace, the newest text fresh', () => {
    /** One frame, and what it let through. */
    const frame = () => vi.advanceTimersByTime(16);

    beforeEach(() => {
      vi.useFakeTimers();
      editor.destroy();
      editor = createEditor({
        parent: host,
        extensions: [...richTextExtensions, createContentStream({ reveal: 'character' })],
        content: '<p>We met last week.</p>',
      });
    });

    afterEach(() => vi.useRealTimers());

    it('reveals a burst over frames — not at once, and not lagging far behind', () => {
      const { writer, finish } = open(end());
      const burst = ' Thank you for taking the time to meet with us.';
      writer.write(burst);
      expect(text()).toBe('We met last week.');
      frame();
      const first = text().length;
      expect(first).toBeGreaterThan('We met last week.'.length);
      expect(first).toBeLessThan(('We met last week.' + burst).length);
      frame();
      expect(text().length).toBeGreaterThan(first);
      vi.advanceTimersByTime(1500);
      expect(text()).toBe('We met last week.' + burst);
      finish();
    });

    it('never shows half a character — an emoji with its skin tone, an accented letter', () => {
      const { writer, finish } = open(end());
      writer.write(' 👍🏽 é 👍🏽👍🏽 ok');
      const seen: string[] = [];
      for (let i = 0; i < 100; i++) {
        frame();
        seen.push(text());
      }
      expect(seen.at(-1)).toBe('We met last week. 👍🏽 é 👍🏽👍🏽 ok');
      for (const shown of seen) {
        expect(shown).not.toMatch(/[\uD800-\uDBFF]$/);
        expect(shown).not.toMatch(/👍$/u);
        expect(shown).not.toMatch(/e$/);
      }
      finish();
    });

    it('shows a block only once its first character does', () => {
      const { writer, finish } = open(end(), { format: 'html' });
      writer.write(' Items:<ul><li>One</li><li>Two</li></ul>');
      for (let i = 0; i < 100; i++) {
        frame();
        for (const item of editor.view.dom.querySelectorAll('li')) {
          expect(item.textContent).not.toBe('');
        }
      }
      expect([...editor.view.dom.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
        'One',
        'Two',
      ]);
      finish();
    });

    it('ends — and settles done — once all of it shows, not when the writing stops', async () => {
      const { run, writer, finish } = open(end());
      writer.write(' A sentence that takes a moment to show.');
      finish();
      await vi.advanceTimersByTimeAsync(16);
      expect(isStreaming(editor.state)).toBe(true);
      await vi.advanceTimersByTimeAsync(2000);
      expect(isStreaming(editor.state)).toBe(false);
      expect(await run.done).toBe(true);
      expect(text()).toBe('We met last week. A sentence that takes a moment to show.');
    });

    it('stops where it is: what shows stays, what has not shown yet does not', async () => {
      const { run, writer } = open(end());
      writer.write(' A sentence that takes a moment to show.');
      frame();
      run.stop();
      const shown = text();
      vi.advanceTimersByTime(2000);
      expect(text()).toBe(shown);
      expect(shown.length).toBeLessThan(
        'We met last week. A sentence that takes a moment to show.'.length,
      );
      expect(await run.done).toBe(false);
    });

    it('marks what it reveals fresh — for the host to fade in — and lets it go stale', async () => {
      const { run, writer, finish } = open(end());
      writer.write(' Hello there');
      frame();
      const fresh = () => [...editor.view.dom.querySelectorAll<HTMLElement>('.aee-stream-fresh')];
      expect(fresh().length).toBeGreaterThan(0);
      expect(fresh()[0].style.getPropertyValue('--email-stream-fade-in')).toBe('600ms');
      // Only what is new is fresh: the text it was written after is not.
      expect(
        fresh()
          .map((element) => element.textContent)
          .join(''),
      ).toBe(text().slice('We met last week.'.length));
      finish();
      await vi.advanceTimersByTimeAsync(3000);
      expect(await run.done).toBe(true);
      expect(fresh()).toEqual([]);
      expect(editor.getHTML()).not.toContain('aee-stream-fresh');
    });

    it('marks nothing with fadeIn: 0', () => {
      editor.destroy();
      editor = createEditor({
        parent: host,
        extensions: [...richTextExtensions, createContentStream({ reveal: 'character', fadeIn: 0 })],
        content: '<p>We met last week.</p>',
      });
      const { writer, finish } = open(end());
      writer.write(' Hello');
      vi.advanceTimersByTime(500);
      expect(text()).toBe('We met last week. Hello');
      expect(editor.view.dom.querySelector('.aee-stream-fresh')).toBeNull();
      finish();
    });
  });

  describe('block — the default: a block shows whole, once all of it is in', () => {
    const frame = () => vi.advanceTimersByTime(16);
    const paragraphs = () =>
      [...editor.view.dom.querySelectorAll('p')].map((paragraph) => paragraph.textContent);

    beforeEach(() => {
      vi.useFakeTimers();
      editor.destroy();
      editor = createEditor({
        parent: host,
        extensions: [...richTextExtensions, createContentStream()],
        content: '<p>We met last week.</p><p></p>',
      });
    });

    afterEach(() => vi.useRealTimers());

    /** Inside the empty paragraph the content ends with. */
    const emptyLine = () => editor.state.doc.content.size - 1;

    it('holds a block back until the next one starts — nothing types', () => {
      const { writer, finish } = open(emptyLine(), { format: 'html' });
      writer.write('<p>Thank you for');
      vi.advanceTimersByTime(500);
      expect(paragraphs()).toEqual(['We met last week.', '']);
      writer.write(' your time.</p><p>Best');
      vi.advanceTimersByTime(500);
      expect(paragraphs()).toEqual(['We met last week.', 'Thank you for your time.']);
      finish();
    });

    it('shows the last block once the stream has finished, then settles done', async () => {
      const { run, writer, finish } = open(emptyLine(), { format: 'html' });
      writer.write('<p>Thank you.</p><p>Best regards</p>');
      finish();
      await vi.advanceTimersByTimeAsync(1000);
      expect(paragraphs()).toEqual(['We met last week.', 'Thank you.', 'Best regards']);
      expect(await run.done).toBe(true);
      expect(isStreaming(editor.state)).toBe(false);
    });

    it('lets blocks that land together follow each other a beat apart', async () => {
      const { writer, finish } = open(emptyLine(), { format: 'html' });
      writer.write('<p>One.</p><p>Two.</p><p>Three.</p><p>Four');
      frame();
      expect(paragraphs()).toEqual(['We met last week.', 'One.']);
      frame();
      expect(paragraphs()).toEqual(['We met last week.', 'One.']);
      vi.advanceTimersByTime(1000);
      expect(paragraphs()).toEqual(['We met last week.', 'One.', 'Two.', 'Three.']);
      finish();
    });

    it('marks the block itself fresh — a list item, where the stream wrote one', async () => {
      const { run, writer, finish } = open(emptyLine(), { format: 'html' });
      writer.write('<p>Items:</p><ul><li>One</li><li>Two</li></ul>');
      finish();
      await vi.advanceTimersByTimeAsync(300);
      const fresh = [...editor.view.dom.querySelectorAll<HTMLElement>('.aee-stream-fresh')];
      expect(fresh.map((element) => element.tagName)).toEqual(['P', 'LI', 'LI']);
      expect(fresh[0].style.getPropertyValue('--email-stream-fade-in')).toBe('600ms');
      await vi.advanceTimersByTimeAsync(3000);
      expect(await run.done).toBe(true);
      expect(editor.view.dom.querySelector('.aee-stream-fresh')).toBeNull();
      expect(editor.getHTML()).not.toContain('aee-stream-fresh');
    });

    it('marks text that joins a line already there as a stretch of it', async () => {
      const { writer, finish } = open('We met last week.'.length + 1, { format: 'html' });
      writer.write(' Thank you.');
      finish();
      await vi.advanceTimersByTimeAsync(100);
      const fresh = [...editor.view.dom.querySelectorAll<HTMLElement>('.aee-stream-fresh')];
      expect(fresh.map((element) => element.tagName)).toEqual(['SPAN']);
      expect(fresh[0].textContent).toBe(' Thank you.');
    });

    it('takes plain text a line at a time', () => {
      const { writer, finish } = open(end());
      writer.write(' One.\nTwo');
      vi.advanceTimersByTime(500);
      expect(text()).toContain('One.');
      expect(text()).not.toContain('Two');
      finish();
    });
  });
});
