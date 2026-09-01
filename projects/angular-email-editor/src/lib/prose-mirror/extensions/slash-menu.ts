import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { ExtensionContext, FunctionalExtension, SlashItem, defineExtension } from '../extension';
import { positionMenuAt } from './menu-position';

export interface SlashMenuState {
  open: boolean;
  /** Text typed after the `/`. */
  query: string;
  /** Items matching the query: static matches ranked title-first (kit order
      within a tier), then whatever the {@link SlashMenuOptions.getItems}
      source contributed for this query. */
  items: SlashItem[];
  /** Index of the keyboard-highlighted item. */
  activeIndex: number;
  /** True while an async {@link SlashMenuOptions.getItems} result for the
      current query is still in flight — render a "Searching…" row from it.
      The menu counts as open while loading, even with zero items yet. */
  loading: boolean;
  /** Applies an item: removes the `/query` text, then runs its command. */
  select: (item: SlashItem) => void;
}

export interface SlashMenuOptions {
  /**
   * The element to float under the `/` — its contents (the item list) are
   * rendered by the host app from the {@link SlashMenuState} it receives
   * through `onChange`. Must live inside a `position: relative` ancestor.
   */
  element: HTMLElement;
  /** Gap between the line and the menu, in px. */
  offset?: number;
  /** Extra items appended after the ones collected from the extensions. */
  items?: SlashItem[];
  /**
   * Dynamic item source, asked once per query change — the ground for
   * host-side search that grows over time (a template gallery, a snippet
   * backend, an Angular `resource()` keyed on the query…).
   *
   * A returned array merges immediately; a promise merges when it resolves,
   * with stale responses discarded (a newer query, a dismissed session, or a
   * destroyed editor all invalidate it — the host never has to race-guard).
   * Results are appended after the static matches and are **not** re-filtered:
   * the source owns its own matching. Each item is an ordinary
   * {@link SlashItem}, so keyboard navigation, Enter, and `select()` treat
   * them exactly like kit items.
   */
  getItems?: (query: string) => SlashItem[] | Promise<SlashItem[]>;
  /** Notified when the menu opens, closes, filters, or moves its highlight. */
  onChange?: (state: SlashMenuState) => void;
}

interface Session {
  /** Position of the `/` character. */
  from: number;
  /** Cursor position (end of the query). */
  to: number;
  query: string;
}

/**
 * An active session is derived from the document, not from keystrokes: a
 * cursor sitting right after `/query` (with the `/` at the block start or
 * after whitespace) is a session. This survives any way the text got there.
 */
function findSession(state: EditorState): Session | null {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
  // Query may contain spaces ("/heading 2") but must not start with one —
  // typing "/ " dismisses — and a later "/" starts a new session instead.
  const match = /(?:^|\s)\/((?:[^\s/][^/]{0,49})?)$/.exec(textBefore);
  if (!match) return null;
  const slashOffset = match.index + match[0].length - match[1].length - 1;
  return { from: $from.start() + slashOffset, to: $from.pos, query: match[1] };
}

function filterItems(items: SlashItem[], query: string): SlashItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((item) => {
    const haystack = [item.title, ...(item.keywords ?? [])].map((s) => s.toLowerCase());
    return words.every((word) => haystack.some((entry) => entry.includes(word)));
  });
}

/** Matches, best first: a query naming an item's *title* must beat a
    keyword-only match — typing "/columns" should highlight Columns, not the
    table (whose keywords include "columns"). Stable within a tier, so kit
    order remains the tiebreak. */
function rankItems(matches: SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return matches;
  const tier = (item: SlashItem): number => {
    const title = item.title.toLowerCase();
    if (title === q) return 0;
    if (title.startsWith(q)) return 1;
    if (title.includes(q)) return 2;
    return 3; // matched via keywords only
  };
  return matches
    .map((item, index) => ({ item, index, tier: tier(item) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((entry) => entry.item);
}

/**
 * Notion-style `/` command menu. Items come from the extensions themselves
 * (each can declare `slashItems`) plus `options.items`; the host app renders
 * them into `element` and the plugin handles detection, filtering, keyboard
 * navigation, positioning, and applying.
 */
export const createSlashMenu = (options: SlashMenuOptions): FunctionalExtension =>
  defineExtension({
    name: 'slashMenu',
    plugins: (ctx) => [createSlashMenuPlugin(ctx, options)],
  });

function createSlashMenuPlugin(ctx: ExtensionContext, options: SlashMenuOptions): Plugin {
  const { element, offset = 4 } = options;
  const allItems = [
    ...ctx.extensions.flatMap((extension) => extension.slashItems?.(ctx) ?? []),
    ...(options.items ?? []),
  ];

  let view: EditorView | undefined;
  let session: Session | null = null;
  /** Static matches + the source's contribution — what navigation runs over. */
  let filtered: SlashItem[] = [];
  let staticMatches: SlashItem[] = [];
  let dynamicItems: SlashItem[] = [];
  let loading = false;
  /** Monotonic ticket: only the newest getItems call may land its result. */
  let sourceRequest = 0;
  let activeIndex = 0;
  /** `from` of the session closed with Escape; suppressed until it changes. */
  let dismissedAt: number | null = null;

  const invalidateSource = () => {
    sourceRequest++;
    dynamicItems = [];
    loading = false;
  };

  const mergeItems = () => {
    filtered = [...staticMatches, ...dynamicItems];
    if (activeIndex >= filtered.length) activeIndex = Math.max(0, filtered.length - 1);
  };

  const querySource = (query: string) => {
    if (!options.getItems) return;
    const ticket = ++sourceRequest;
    const result = options.getItems(query);
    if (Array.isArray(result)) {
      dynamicItems = result;
      return;
    }
    loading = true;
    result
      .then((items) => {
        if (ticket !== sourceRequest || !view) return; // superseded or closed
        dynamicItems = items;
        loading = false;
        mergeItems();
        render();
        emit();
      })
      .catch(() => {
        if (ticket !== sourceRequest || !view) return;
        loading = false;
        render();
        emit();
      });
  };

  const hide = () => {
    element.style.visibility = 'hidden';
  };

  const select = (item: SlashItem) => {
    if (!view || !session) return;
    view.dispatch(view.state.tr.delete(session.from, session.to));
    item.command(view.state, view.dispatch, view);
    view.focus();
  };

  const emit = () =>
    options.onChange?.({
      open: session !== null && (filtered.length > 0 || loading),
      query: session?.query ?? '',
      items: filtered,
      activeIndex,
      loading,
      select,
    });

  /** Shows or hides the floating element to match the current state — shared
      by the synchronous refresh and the async source landing later. */
  const render = () => {
    if (!session || (!filtered.length && !loading)) {
      hide();
      return;
    }
    // Show first so the element is measurable for the flip check.
    element.style.visibility = 'visible';
    position();
  };

  const position = () => {
    if (!view || !session) return;
    positionMenuAt(view, element, session.from, offset);
  };

  const refresh = () => {
    if (!view) return;
    const next = findSession(view.state);

    if (dismissedAt !== null && next?.from !== dismissedAt) dismissedAt = null;
    const previous = session;
    session = next && next.from !== dismissedAt ? next : null;

    if (!session) {
      if (previous) {
        filtered = [];
        staticMatches = [];
        invalidateSource();
        hide();
        emit();
      }
      return;
    }

    if (session.query !== previous?.query || session.from !== previous.from) {
      staticMatches = rankItems(filterItems(allItems, session.query), session.query);
      activeIndex = 0;
      invalidateSource();
      querySource(session.query);
      mergeItems();
    }

    render();
    emit();
  };

  const onKeyDown = (event: KeyboardEvent): boolean => {
    // While an async source is still loading the menu is open (a spinner row),
    // so Escape must dismiss it — but item keys need actual items.
    if (!session || (!filtered.length && !loading)) return false;
    switch (event.key) {
      case 'ArrowDown':
        if (!filtered.length) return false;
        activeIndex = (activeIndex + 1) % filtered.length;
        emit();
        return true;
      case 'ArrowUp':
        if (!filtered.length) return false;
        activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
        emit();
        return true;
      case 'Enter':
      case 'Tab':
        if (!filtered.length) return false;
        select(filtered[activeIndex]);
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
    filtered = [];
    staticMatches = [];
    invalidateSource();
    hide();
    emit();
  };

  // Keep clicks on menu items from blurring the editor.
  const onMenuMousedown = (event: Event) => event.preventDefault();

  // Any press that is not on the menu dismisses — first click, focus or not.
  // That includes clicks inside the editable: blank space maps to the nearest
  // text position, which can be exactly where the cursor already sits (right
  // after the query), so no selection change would ever close the session.
  // If the cursor lands after the same slash again, dismissedAt keeps it shut.
  const onWindowMousedown = (event: MouseEvent) => {
    if (element.contains(event.target as Node | null)) return;
    dismiss();
  };

  // Fallback for focus leaving without a mousedown (e.g. Tab). Deferred a
  // frame to ride out transient blurs (same pattern as the bubble menu).
  const onBlur = (event: FocusEvent) => {
    if (element.contains(event.relatedTarget as Node | null)) return;
    requestAnimationFrame(() => {
      if (!view) return;
      if (view.hasFocus() || element.contains(element.ownerDocument.activeElement)) return;
      dismiss();
    });
  };

  return new Plugin({
    key: new PluginKey('slashMenu'),
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
          view = undefined;
          hide();
        },
      };
    },
  });
}
