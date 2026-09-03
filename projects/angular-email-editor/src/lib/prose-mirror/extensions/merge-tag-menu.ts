import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { FunctionalExtension, defineExtension } from '../extension';
import { positionMenuAt } from './menu-position';

/** One personalization variable a source offers. */
export interface MergeTagItem {
  /** The dotted path the token serializes as — `firstName`, `user.company`. */
  path: string;
  /** Human name for the menu row; the path shows alongside it. */
  label?: string;
}

/** What {@link MergeTagMenuOptions.getTags} is asked for: the query typed
    after `{{`, and the page cursor — `null` for the first page, else the
    `nextCursor` a previous page returned. */
export interface MergeTagRequest {
  query: string;
  cursor: string | null;
}

/** One page of results. `nextCursor` present and non-null means more pages
    exist — the menu exposes {@link MergeTagMenuState.loadMore} to fetch them
    (the host's infinite-scroll hook). */
export interface MergeTagPage {
  items: MergeTagItem[];
  nextCursor?: string | null;
}

export interface MergeTagMenuState {
  open: boolean;
  /** Text typed after the `{{`. */
  query: string;
  /** Every item loaded so far — pages append. */
  items: MergeTagItem[];
  activeIndex: number;
  /** First page for the current query still in flight (render a searching row). */
  loading: boolean;
  /** A further page in flight (render a loading row at the list's end). */
  loadingMore: boolean;
  /** More pages exist — the host's scroll sentinel should call `loadMore`. */
  hasMore: boolean;
  /** Replaces the `{{query` text with a merge-tag pill. */
  select: (item: MergeTagItem) => void;
  /** Fetches the next page and appends it. No-op while loading, when no
      cursor is left, or when the menu is closed — safe to call from any
      scroll handler without guards. */
  loadMore: () => void;
}

export interface MergeTagMenuOptions {
  /** The floating element (host-rendered, like the slash menu's): must live
      inside a `position: relative` scroll container. */
  element: HTMLElement;
  /**
   * The variable source — a static registry or a server.
   *
   * Called once per query change with `cursor: null`, and again with the
   * last page's `nextCursor` on every `loadMore()`. A plain object answers
   * synchronously; a promise resolves whenever it resolves, with stale
   * responses discarded (a newer query, a dismissal, a destroyed editor).
   * The source owns its own matching — results are shown as returned.
   */
  getTags: (request: MergeTagRequest) => MergeTagPage | Promise<MergeTagPage>;
  /** Notified when the menu opens, closes, filters, loads, or moves. */
  onChange?: (state: MergeTagMenuState) => void;
  /** Gap between the line and the menu, in px. */
  offset?: number;
  /** Milliseconds to sit on a keystroke before asking the source — the
      debounce for a server-backed source. 0 (default) asks immediately,
      which is right for a static registry. */
  debounce?: number;
}

interface Session {
  /** Position of the first `{` character. */
  from: number;
  /** Cursor position (end of the query). */
  to: number;
  query: string;
}

/**
 * A session is derived from the document, not from keystrokes: a cursor
 * sitting right after `{{query` is a session, however the text got there.
 * `{{{` (Handlebars triple-stash) does not trigger, and a completed token
 * cannot — the input rule or a `select()` has already replaced its text.
 */
function findSession(state: EditorState): Session | null {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const match = /(?:^|[^{])(\{\{[ ]?([A-Za-z0-9_.]{0,50}))$/.exec(textBefore);
  if (!match) return null;
  return { from: $from.pos - match[1].length, to: $from.pos, query: match[2] };
}

/**
 * The `{{` autocomplete: the slash menu's sibling for personalization tokens,
 * with one extra wrinkle — the source is *paged* (`cursor`/`nextCursor`), so
 * a server-backed variable catalogue streams in as the host's listbox scrolls
 * (`loadMore`). Selection inserts the `{{path}}` text (the pill follows); typing the token out in
 * full still works through the node's own input rule.
 */
export const createMergeTagMenu = (options: MergeTagMenuOptions): FunctionalExtension =>
  defineExtension({
    name: 'mergeTagMenu',
    plugins: () => [createMergeTagMenuPlugin(options)],
  });

function createMergeTagMenuPlugin(options: MergeTagMenuOptions): Plugin {
  const { element, offset = 4 } = options;

  let view: EditorView | undefined;
  let session: Session | null = null;
  let items: MergeTagItem[] = [];
  let nextCursor: string | null = null;
  let loading = false;
  let loadingMore = false;
  let activeIndex = 0;
  /** Monotonic ticket: a query change or dismissal invalidates every
      response still in flight, first page and loadMore pages alike. */
  let ticket = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  /** `from` of the session closed with Escape; suppressed until it changes. */
  let dismissedAt: number | null = null;

  const invalidate = () => {
    ticket++;
    clearTimeout(debounceTimer);
    items = [];
    nextCursor = null;
    loading = false;
    loadingMore = false;
  };

  const startQuery = (query: string) => {
    invalidate();
    const mine = ticket;
    loading = true;
    const run = () => {
      Promise.resolve(options.getTags({ query, cursor: null }))
        .then((page) => {
          if (mine !== ticket || !view) return;
          items = page.items;
          nextCursor = page.nextCursor ?? null;
          loading = false;
          if (activeIndex >= items.length) activeIndex = Math.max(0, items.length - 1);
          render();
          emit();
        })
        .catch(() => {
          if (mine !== ticket || !view) return;
          loading = false;
          render();
          emit();
        });
    };
    if (options.debounce) debounceTimer = setTimeout(run, options.debounce);
    else run();
  };

  const loadMore = () => {
    if (!view || !session || loading || loadingMore || nextCursor === null) return;
    const mine = ticket;
    loadingMore = true;
    emit();
    Promise.resolve(options.getTags({ query: session.query, cursor: nextCursor }))
      .then((page) => {
        if (mine !== ticket || !view) return;
        items = [...items, ...page.items];
        nextCursor = page.nextCursor ?? null;
        loadingMore = false;
        render();
        emit();
      })
      .catch(() => {
        if (mine !== ticket || !view) return;
        loadingMore = false;
        emit();
      });
  };

  const hide = () => {
    element.style.visibility = 'hidden';
  };

  const select = (item: MergeTagItem) => {
    if (!view || !session) return;
    // The token is text; the mark follows from it (the merge-tag extension).
    const tr = view.state.tr.delete(session.from, session.to);
    tr.insertText(`{{ ${item.path} }}`);
    view.dispatch(tr.scrollIntoView());
    view.focus();
  };

  const isOpen = () => session !== null && (items.length > 0 || loading || loadingMore);

  const emit = () =>
    options.onChange?.({
      open: isOpen(),
      query: session?.query ?? '',
      items,
      activeIndex,
      loading,
      loadingMore,
      hasMore: nextCursor !== null,
      select,
      loadMore,
    });

  const render = () => {
    if (!isOpen()) {
      hide();
      return;
    }
    // Show first so the element is measurable for the flip check.
    element.style.visibility = 'visible';
    if (view && session) positionMenuAt(view, element, session.from, offset);
  };

  const refresh = () => {
    if (!view) return;
    const next = findSession(view.state);

    if (dismissedAt !== null && next?.from !== dismissedAt) dismissedAt = null;
    const previous = session;
    session = next && next.from !== dismissedAt ? next : null;

    if (!session) {
      if (previous) {
        invalidate();
        hide();
        emit();
      }
      return;
    }

    if (session.query !== previous?.query || session.from !== previous.from) {
      activeIndex = 0;
      startQuery(session.query);
    }

    render();
    emit();
  };

  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (!isOpen()) return false;
    switch (event.key) {
      case 'ArrowDown':
        if (!items.length) return false;
        // At the list's end with more pages out there, the arrow *is* the
        // scroll: fetch the next page and stay put instead of wrapping.
        if (activeIndex === items.length - 1 && nextCursor !== null) {
          loadMore();
          return true;
        }
        activeIndex = (activeIndex + 1) % items.length;
        emit();
        return true;
      case 'ArrowUp':
        if (!items.length) return false;
        activeIndex = (activeIndex - 1 + items.length) % items.length;
        emit();
        return true;
      case 'Enter':
      case 'Tab':
        if (!items.length) return false;
        select(items[activeIndex]);
        return true;
      case 'Escape':
        dismiss();
        return true;
      default:
        return false;
    }
  };

  const dismiss = () => {
    if (!session) return;
    dismissedAt = session.from;
    session = null;
    invalidate();
    hide();
    emit();
  };

  // Keep clicks on menu items (and its scrollbar) from blurring the editor.
  const onMenuMousedown = (event: Event) => event.preventDefault();

  const onWindowMousedown = (event: MouseEvent) => {
    if (element.contains(event.target as Node | null)) return;
    dismiss();
  };

  const onBlur = (event: FocusEvent) => {
    if (element.contains(event.relatedTarget as Node | null)) return;
    requestAnimationFrame(() => {
      if (!view) return;
      if (view.hasFocus() || element.contains(element.ownerDocument.activeElement)) return;
      dismiss();
    });
  };

  return new Plugin({
    key: new PluginKey('mergeTagMenu'),
    props: {
      handleKeyDown: (_view, event) => onKeyDown(event),
    },
    view: (editorView) => {
      view = editorView;
      element.style.position = 'absolute';
      hide();
      element.addEventListener('mousedown', onMenuMousedown);
      window.addEventListener('mousedown', onWindowMousedown);
      editorView.dom.addEventListener('blur', onBlur);
      refresh();
      return {
        update: () => refresh(),
        destroy: () => {
          editorView.dom.removeEventListener('blur', onBlur);
          window.removeEventListener('mousedown', onWindowMousedown);
          element.removeEventListener('mousedown', onMenuMousedown);
          clearTimeout(debounceTimer);
          view = undefined;
          hide();
        },
      };
    },
  });
}
