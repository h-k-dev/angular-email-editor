import {
  Fragment,
  Node as ProseMirrorNode,
  DOMParser as ProseMirrorDOMParser,
  Slice,
} from 'prosemirror-model';
import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { FunctionalExtension, defineExtension } from '../extension';

/** Where a stream is writing: what it has written so far. */
export interface ContentStreamRange {
  from: number;
  to: number;
}

/** What the extension reports: whether something is streaming in, and where. */
export interface ContentStreamState {
  streaming: boolean;
  range: ContentStreamRange | null;
}

/** How a stream shows what has come in — see {@link ContentStreamOptions.reveal}. */
export type ContentStreamReveal = 'block' | 'character' | 'instant';

export interface ContentStreamOptions {
  /** A caret after the last thing written — a widget, `span.aee-stream-caret`,
      for the host's stylesheet; the library paints nothing. Default true. */
  caret?: boolean;
  /**
   * How what has come in is *revealed*. A model's tokens come in bursts — a
   * word, a pause, three words — and written as they come they read like a
   * slide show.
   *
   * - `'block'` (the default): a block — a paragraph, a list item, a line of
   *   plain text — shows *whole*, once all of it is in: when the next one
   *   starts, or the stream ends. Nothing types; blocks that land together
   *   follow each other a beat apart. The caret waits after the last one.
   * - `'character'`: a steady pace, a character or a few a frame, never
   *   splitting one: faster when it falls behind, slower as it catches up.
   * - `'instant'`: each piece the moment it comes.
   *
   * The stream ends — and `done` settles — once all of it shows.
   */
  reveal?: ContentStreamReveal;
  /**
   * How long, in ms, what was just revealed is *fresh*: it carries
   * `aee-stream-fresh` — with `--email-stream-fade-in` set to this duration
   * — for the host's stylesheet to fade it in; the library paints nothing.
   * A block revealed whole carries it *itself* (the `p`, the `li`), so it
   * can be wiped or moved as well as faded; text that joins a line already
   * there, and everything under `'character'`, is wrapped in a `span`.
   * Default 600; 0 marks nothing.
   */
  fadeIn?: number;
  /** Escape stops the stream mid-way. Default true. */
  stopOnEscape?: boolean;
  /** Told when a stream starts, writes, and ends. */
  onChange?: (state: ContentStreamState) => void;
}

/** What {@link streamContent}'s callback writes with. */
export interface ContentStreamWriter {
  /** Appends a piece of the content — a token, a word, a chunk of a
      response body. A no-op once the stream has been stopped. */
  write(partial: string): void;
  /** A `WritableStream` that writes what is piped into it — text, or bytes
      decoded as UTF-8: `response.body.pipeTo(writer.getWritableStream())`. */
  getWritableStream(): WritableStream<string | Uint8Array>;
  /** Aborts when the stream is stopped — Escape, `stop()`, the editor going
      away. Hand it to `fetch` or to the model's client. */
  readonly signal: AbortSignal;
}

export interface StreamContentOptions {
  /**
   * What the pieces are. `'text'` (the default) is appended as it comes.
   * `'html'` is *re-read as a whole* on every write: the pieces collect in a
   * buffer, the buffer is parsed through the schema, and what has been
   * written so far is replaced by the result — so a list or a bold word
   * takes shape as it streams, and a tag split over two pieces never shows
   * as text.
   */
  format?: 'text' | 'html';
  /** Rewrites the buffer before it is parsed (`'html'`) — strip a code
      fence, turn Markdown into HTML. Given everything received so far. */
  transform?: (buffer: string) => string;
}

/** A stream in progress. */
export interface ContentStreamRun {
  /** Stops it where it is: what shows stays, what has come in but not shown
      yet does not. */
  stop(): void;
  /** True once the callback has finished and all of it shows; false when it
      was stopped first. Rejects with what the callback threw, if it was not
      an abort. */
  readonly done: Promise<boolean>;
}

interface StreamPluginState {
  range: ContentStreamRange | null;
  /** The text still fading in — it outlives the stream by a moment. */
  fresh: DecorationSet;
}

/** What a stream's own transaction says: where it is now (`null`: it has
    ended), and what is fresh. */
interface StreamMeta {
  range?: ContentStreamRange | null;
  fresh?: DecorationSet;
}

/** Freshly revealed, at `at` (`performance.now()`). */
interface FreshSpec {
  at: number;
}

const key = new PluginKey<StreamPluginState>('contentStream');

/** What the running stream of each editor is aborted with. */
const running = new WeakMap<EditorView, AbortController>();

/** How each editor's extension was set up — for `streamContent` to read. */
const settings = new WeakMap<EditorView, { reveal: ContentStreamReveal; fadeIn: number }>();

/** How far behind the reveal may fall before it hurries: it closes the gap
    with this time constant, in ms — a burst glides in rather than landing. */
const CATCH_UP = 180;

/** The slowest it reveals, in characters a second — so a tail finishes. */
const MIN_RATE = 45;

/** `'block'`: how long after one block the next may show, in ms — blocks
    that come in together cascade rather than land as one. */
const STAGGER = 110;

/** Where a character — or a leaf, a merge tag — would stand in for itself. */
const LEAF = '￼';

/** Whether content is streaming into the editor — for an action that starts
    one to say it cannot run again yet. */
export const isStreaming = (state: EditorState): boolean => !!key.getState(state)?.range;

/** Where content is streaming in, if it is. */
export const streamingRange = (state: EditorState): ContentStreamRange | null =>
  key.getState(state)?.range ?? null;

/** An HTML fragment as an *open* slice: its first line joins the line it is
    written into, the way typed text would. A tag cut off at the buffer's
    end — `<stro` — is left out until the rest of it arrives. */
function parseFragment(html: string, state: EditorState): Slice {
  const dom = new window.DOMParser().parseFromString(html.replace(/<[^>]*$/, ''), 'text/html');
  return ProseMirrorDOMParser.fromSchema(state.schema).parseSlice(dom.body);
}

/** What a reveal counts through: each character of text, each inline leaf
    (a merge tag, a line break) as one. */
function unitsOf(fragment: Fragment): string {
  let units = '';
  fragment.descendants((node) => {
    if (node.isText) units += node.text;
    else if (node.isInline && node.isLeaf) units += LEAF;
  });
  return units;
}

/** Where, counted in units, each block of `fragment` that has any ends. */
function blockEnds(fragment: Fragment): number[] {
  const ends: number[] = [];
  let count = 0;
  fragment.descendants((node) => {
    if (node.isTextblock) {
      const size = unitsOf(node.content).length;
      if (size) ends.push((count += size));
      return false;
    }
    if (node.isText) count += node.text!.length;
    else if (node.isInline && node.isLeaf) count += 1;
    return true;
  });
  // Inline content outside any block is one of its own.
  if (count && ends.at(-1) !== count) ends.push(count);
  return ends;
}

/** The same for plain text: a block is a line. */
function lineEnds(text: string): number[] {
  const ends: number[] = [];
  for (const match of text.matchAll(/\n+/g)) {
    if (match.index > 0) ends.push(match.index + match[0].length);
  }
  if (text.length && ends.at(-1) !== text.length) ends.push(text.length);
  return ends;
}

/**
 * What marks `start`–`end` fresh. With `blocks`, a text block that is fresh
 * through and through is marked *itself* — or what it opens, a list item,
 * if the stream wrote that too — so a stylesheet can wipe or move it;
 * anything less is an inline stretch. Which of the two never changes while
 * a block is fresh: a fade that started is not started again.
 */
function freshDecorations(
  doc: ProseMirrorNode,
  from: number,
  start: number,
  end: number,
  blocks: boolean,
  spec: FreshSpec,
  fadeIn: number,
): Decoration[] {
  const attrs = { class: 'aee-stream-fresh', style: `--email-stream-fade-in: ${fadeIn}ms` };
  if (!blocks) return end > start ? [Decoration.inline(start, end, attrs, spec)] : [];
  const decorations: Decoration[] = [];
  doc.nodesBetween(start, end, (node, pos, _parent, index) => {
    if (!node.isTextblock) return true;
    const inner = pos + 1;
    const innerEnd = pos + node.nodeSize - 1;
    if (start <= inner && end >= innerEnd) {
      const $pos = doc.resolve(pos);
      const opens = index === 0 && $pos.depth > 0 && $pos.before() >= from;
      if (opens) decorations.push(Decoration.node($pos.before(), $pos.after(), attrs, spec));
      else decorations.push(Decoration.node(pos, pos + node.nodeSize, attrs, spec));
    } else if (Math.min(end, innerEnd) > Math.max(start, inner)) {
      decorations.push(
        Decoration.inline(Math.max(start, inner), Math.min(end, innerEnd), attrs, spec),
      );
    }
    return false;
  });
  return decorations;
}

/** The position right after the first `count` units between `from` and
    `to` — so a block only shows once its first character does. */
function positionAfter(doc: ProseMirrorNode, from: number, to: number, count: number): number {
  let seen = 0;
  let at = from;
  doc.nodesBetween(from, to, (node, pos) => {
    if (seen >= count) return false;
    if (node.isText) {
      const start = Math.max(from, pos);
      const take = Math.min(Math.min(to, pos + node.nodeSize) - start, count - seen);
      seen += take;
      at = start + take;
    } else if (node.isInline && node.isLeaf && pos >= from && pos + node.nodeSize <= to) {
      seen += 1;
      at = pos + node.nodeSize;
    }
    return true;
  });
  return at;
}

/** Where the next character ends, from `index` on — so a reveal never
    shows half an emoji or a letter without its accent. */
const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

function graphemeEnd(units: string, from: number, index: number): number {
  if (index <= from || index >= units.length) return Math.min(index, units.length);
  if (!segmenter) {
    const code = units.charCodeAt(index - 1);
    return code >= 0xd800 && code <= 0xdbff ? index + 1 : index;
  }
  for (const { index: start, segment } of segmenter.segment(units.slice(from))) {
    const end = from + start + segment.length;
    if (end >= index) return end;
  }
  return units.length;
}

const now = () => performance.now();

/** Each frame, if the page shows — otherwise on the next task, since a
    hidden tab never paints. */
const nextFrame = (callback: () => void) =>
  typeof requestAnimationFrame === 'function' && !document.hidden
    ? requestAnimationFrame(() => callback())
    : setTimeout(callback, 16);

/**
 * Lets content **stream into the document** — a model's answer, a slow
 * import — and owns everything around that: where the next piece goes while
 * the writer keeps typing, how it shows — block by block — a caret, the fade
 * on what is new, `aria-busy` on the editor, Escape to stop, the abort signal,
 * the end. Install it, then call {@link streamContent}:
 *
 *     createEditor({ extensions: [...kit, createContentStream()] })
 *
 *     streamContent(editor.view, editor.state.selection.from, async ({ write, signal }) => {
 *       for await (const token of model.stream(prompt, { signal })) write(token);
 *     });
 *
 * One stream at a time per editor. What it writes is ordinary content in
 * ordinary transactions: it is in the document, in the HTML, and in the undo
 * history — pieces that follow each other closely undo as one.
 */
export const createContentStream = (options: ContentStreamOptions = {}): FunctionalExtension => {
  const { caret = true, reveal = 'block', fadeIn = 600, stopOnEscape = true } = options;

  return defineExtension({
    name: 'contentStream',
    plugins: () => [
      new Plugin<StreamPluginState>({
        key,
        state: {
          init: () => ({ range: null, fresh: DecorationSet.empty }),
          apply: (tr, previous) => {
            const meta = tr.getMeta(key) as StreamMeta | undefined;
            let { range, fresh } = previous;
            if (tr.docChanged) {
              fresh = fresh.map(tr.mapping, tr.doc);
              // Someone else's edit: what is typed right at either edge is
              // theirs, not the stream's — the range closes in, never out,
              // so a re-read (`'html'`) cannot write over it.
              if (range) {
                const from = tr.mapping.map(range.from, 1);
                range = { from, to: Math.max(from, tr.mapping.map(range.to, -1)) };
              }
            }
            if (meta?.range !== undefined) range = meta.range;
            if (meta?.fresh) fresh = meta.fresh;
            return range === previous.range && fresh === previous.fresh
              ? previous
              : { range, fresh };
          },
        },
        props: {
          decorations: (state) => {
            const { range, fresh } = key.getState(state)!;
            if (!range || !caret) return fresh;
            const widget = () => {
              const element = document.createElement('span');
              element.className = 'aee-stream-caret';
              element.setAttribute('aria-hidden', 'true');
              return element;
            };
            return fresh.add(state.doc, [
              Decoration.widget(range.to, widget, { side: 1, key: 'stream-caret' }),
            ]);
          },
          // The editor says it is busy while content comes in.
          attributes: (state): Record<string, string> =>
            isStreaming(state) ? { 'aria-busy': 'true' } : {},
          handleKeyDown: (view, event) => {
            if (!stopOnEscape || event.key !== 'Escape' || !isStreaming(view.state)) return false;
            running.get(view)?.abort();
            return true;
          },
        },
        view: (editorView) => {
          settings.set(editorView, { reveal, fadeIn });
          /** A frame is asked for to let fresh text go stale. */
          let waiting = false;
          const expire = () => {
            waiting = false;
            if (editorView.isDestroyed) return;
            const { fresh } = key.getState(editorView.state)!;
            const time = now();
            const stale = fresh.find(
              undefined,
              undefined,
              (spec: FreshSpec) => time - spec.at >= fadeIn,
            );
            if (stale.length) {
              const meta: StreamMeta = { fresh: fresh.remove(stale) };
              editorView.dispatch(editorView.state.tr.setMeta(key, meta));
            } else if (fresh !== DecorationSet.empty) {
              schedule(fresh);
            }
          };
          const schedule = (fresh: DecorationSet) => {
            if (waiting || fresh === DecorationSet.empty || !fresh.find().length) return;
            waiting = true;
            nextFrame(expire);
          };
          return {
            update: (view, previous) => {
              const state = key.getState(view.state)!;
              schedule(state.fresh);
              const before = key.getState(previous)!;
              if (state.range === before.range) return;
              options.onChange?.({ streaming: state.range !== null, range: state.range });
            },
            // The editor going away stops what was writing into it.
            destroy: () => running.get(editorView)?.abort(),
          };
        },
      }),
    ],
  });
};

/**
 * Streams content into the document at `target` — a position, or a range
 * that the first piece replaces ("rewrite this selection"). `callback` does
 * the writing; the stream ends when it returns and all it wrote shows.
 *
 * Needs {@link createContentStream} among the editor's extensions, and no
 * other stream running (ask {@link isStreaming}).
 */
export function streamContent(
  view: EditorView,
  target: number | ContentStreamRange,
  callback: (writer: ContentStreamWriter) => Promise<void> | void,
  options: StreamContentOptions = {},
): ContentStreamRun {
  if (key.get(view.state) === undefined) {
    throw new Error('streamContent: add createContentStream() to the editor’s extensions');
  }
  if (isStreaming(view.state)) throw new Error('streamContent: a stream is already running');

  const { format = 'text', transform } = options;
  const { reveal: mode, fadeIn } = settings.get(view) ?? { reveal: 'instant', fadeIn: 0 };
  const controller = new AbortController();
  const { signal } = controller;
  running.set(view, controller);

  const start = typeof target === 'number' ? { from: target, to: target } : target;
  // A new stream starts with nothing fresh: what an earlier one left fading
  // is simply done.
  const begin: StreamMeta = { range: start, fresh: DecorationSet.empty };
  view.dispatch(view.state.tr.setMeta(key, begin));

  let buffer = '';
  /** What there is to reveal: `buffer`'s text, or its HTML's read. */
  let units = '';
  /** `'block'`: where in `units` each block ends — the last is still open
      until the stream has finished. */
  let ends: number[] = [];
  /** `'html'`: the buffer as read, and whether the space it opens with is
      put back (a parser drops it). */
  let parsed: { slice: Slice; space: boolean } | null = null;
  /** How much shows — `progress` is where the pace has got to between two. */
  let shown = 0;
  let progress = 0;
  /** Stretches of what shows that are still fresh, as offsets into `units`. */
  let fresh: Array<{ from: number; to: number; at: number }> = [];
  let finished = false;
  let drained: () => void = () => undefined;
  const drainedAll = new Promise<void>((resolve) => (drained = resolve));

  /** Shows `units` up to `count` — and tells which of it is new. */
  const reveal = (count: number) => {
    const range = key.getState(view.state)?.range;
    if (!range || view.isDestroyed) return;
    const time = now();
    const tr = view.state.tr;
    let { from, to } = range;

    if (parsed) {
      tr.replaceRange(from, to, parsed.slice);
      if (parsed.space) tr.insertText(' ', from);
      from = tr.mapping.map(from, -1);
      to = tr.mapping.map(to, 1);
      // What has not been revealed yet is cut off again — a block is not
      // there before its first character is.
      if (count < units.length) {
        const mark = tr.steps.length;
        tr.delete(positionAfter(tr.doc, from, to, count), to);
        to = tr.mapping.slice(mark).map(to, 1);
      }
    } else if (count > shown) {
      // Text is appended — but its first piece takes the place of a range.
      if (shown === 0) tr.insertText(units.slice(0, count), from, to);
      else tr.insertText(units.slice(shown, count), to);
      from = tr.mapping.map(from, -1);
      to = tr.mapping.map(to, 1);
    }

    const meta: StreamMeta = { range: { from, to } };
    if (fadeIn > 0) {
      if (count > shown) fresh.push({ from: shown, to: count, at: time });
      fresh = fresh.filter((stretch) => time - stretch.at < fadeIn);
      meta.fresh = DecorationSet.create(
        tr.doc,
        fresh.flatMap((stretch) =>
          freshDecorations(
            tr.doc,
            from,
            positionAfter(tr.doc, from, to, stretch.from),
            positionAfter(tr.doc, from, to, stretch.to),
            mode === 'block',
            { at: stretch.at },
            fadeIn,
          ),
        ),
      );
    }
    shown = count;
    view.dispatch(tr.setMeta(key, meta));
  };

  /** Pacing: a frame's worth more of what has come in — or the next block. */
  let pacing = false;
  let last = 0;
  let lastBlock = -Infinity;
  const pace = () => {
    if (signal.aborted || view.isDestroyed) {
      pacing = false;
      return;
    }
    const time = now();
    if (mode === 'block') {
      // The last block is whole only once nothing more can come.
      const whole = finished ? units.length : (ends.at(-2) ?? 0);
      const next = ends.find((blockEnd) => blockEnd > shown && blockEnd <= whole);
      if (next !== undefined) {
        if (time - lastBlock >= STAGGER) {
          lastBlock = time;
          reveal(next);
        }
        nextFrame(pace);
        return;
      }
      pacing = false;
      if (finished) drained();
      return;
    }
    const elapsed = Math.max(0, time - last) / 1000;
    last = time;
    const behind = units.length - progress;
    const step = Math.max(
      behind * (1 - Math.exp(-elapsed / (CATCH_UP / 1000))),
      MIN_RATE * elapsed,
    );
    progress = Math.min(units.length, progress + step);
    const count = graphemeEnd(units, shown, Math.floor(progress));
    // (Fewer than show: a transform read the buffer anew — `**bo` became
    // bold — and what shows shrinks with it.)
    if (count !== shown) reveal(count);
    progress = Math.max(progress, shown);
    if (shown < units.length) {
      nextFrame(pace);
      return;
    }
    pacing = false;
    if (finished) drained();
  };

  const startPacing = () => {
    if (pacing) return;
    pacing = true;
    last = now();
    nextFrame(pace);
  };

  const write = (partial: string) => {
    if (signal.aborted || view.isDestroyed || !partial || !isStreaming(view.state)) return;
    buffer += partial;
    if (format === 'html') {
      const html = transform ? transform(buffer) : buffer;
      const range = key.getState(view.state)!.range!;
      const slice = parseFragment(html, view.state);
      // A parser drops the space an answer opens with — the one that keeps
      // it from running into the word it follows.
      const space = /^\s/.test(html) && view.state.doc.resolve(range.from).parent.isTextblock;
      parsed = { slice, space };
      units = (space ? ' ' : '') + unitsOf(slice.content);
      if (mode === 'block') ends = blockEnds(slice.content).map((at) => at + (space ? 1 : 0));
    } else {
      units = buffer;
      if (mode === 'block') ends = lineEnds(units);
    }
    // A hidden tab never paints: there is nothing to pace.
    if (mode === 'instant' || document.hidden) {
      progress = units.length;
      return reveal(units.length);
    }
    startPacing();
  };

  const getWritableStream = () => {
    const decoder = new TextDecoder();
    return new WritableStream<string | Uint8Array>({
      write: (chunk) =>
        write(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })),
    });
  };

  // A run ends once. It is asked to twice — by the abort, at once, and by
  // `done` settling, later — and by then another run may have started in
  // its place (a host that stops one answer to ask for the next): the
  // second ending must not close *that* one's range.
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    if (running.get(view) === controller) running.delete(view);
    if (!view.isDestroyed && isStreaming(view.state)) {
      view.dispatch(view.state.tr.setMeta(key, { range: null } satisfies StreamMeta));
    }
  };

  // Stopped from anywhere — Escape, `stop()` — the stream ends at once, not
  // when the callback next notices.
  signal.addEventListener('abort', end, { once: true });

  const work = (async () => callback({ write, getWritableStream, signal }))();
  // Settled by whichever comes first: a stop does not wait for a callback
  // that is slow to notice — or never does.
  const done = Promise.race([
    work.then(async () => {
      // All of it written, not all of it shown: the pace catches up first.
      // (And the last block, whole only now, is still to come.)
      finished = true;
      if (!signal.aborted && shown < units.length) {
        startPacing();
        await drainedAll;
      }
      return !signal.aborted;
    }),
    new Promise<boolean>((resolve) =>
      signal.addEventListener('abort', () => resolve(false), { once: true }),
    ),
  ])
    .catch((reason: unknown) => {
      if (signal.aborted || (reason as { name?: string })?.name === 'AbortError') return false;
      throw reason;
    })
    .finally(end);
  // What a stopped callback throws later is nobody's failure.
  work.catch(() => undefined);

  return { stop: () => controller.abort(), done };
}
