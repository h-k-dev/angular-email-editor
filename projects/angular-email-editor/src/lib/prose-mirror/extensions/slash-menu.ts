import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { ExtensionContext, FunctionalExtension, SlashItem, defineExtension } from '../extension';

export interface SlashMenuState {
  open: boolean;
  /** Text typed after the `/`. */
  query: string;
  /** Items matching the query, in kit order. */
  items: SlashItem[];
  /** Index of the keyboard-highlighted item. */
  activeIndex: number;
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
  let filtered: SlashItem[] = [];
  let activeIndex = 0;
  /** `from` of the session closed with Escape; suppressed until it changes. */
  let dismissedAt: number | null = null;

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
      open: session !== null && filtered.length > 0,
      query: session?.query ?? '',
      items: filtered,
      activeIndex,
      select,
    });

  const position = () => {
    if (!view || !session) return;
    const container = element.offsetParent ?? element.parentElement;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const coords = view.coordsAtPos(session.from);

    const left = Math.min(
      Math.max(coords.left - containerRect.left + container.scrollLeft, 0),
      Math.max(container.scrollWidth - element.offsetWidth, 0),
    );

    // Below the line containing the slash; flip above when it would overflow
    // the visible part of the scroll container.
    let top = coords.bottom - containerRect.top + container.scrollTop + offset;
    const visibleBottom = container.scrollTop + container.clientHeight;
    if (top + element.offsetHeight > visibleBottom) {
      const above = coords.top - containerRect.top + container.scrollTop;
      if (above - element.offsetHeight - offset >= container.scrollTop) {
        top = above - element.offsetHeight - offset;
      }
    }

    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
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
        hide();
        emit();
      }
      return;
    }

    if (session.query !== previous?.query || session.from !== previous.from) {
      filtered = filterItems(allItems, session.query);
      activeIndex = 0;
    }

    if (!filtered.length) {
      hide();
    } else {
      // Show first so the element is measurable for the flip check.
      element.style.visibility = 'visible';
      position();
    }
    emit();
  };

  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (!session || !filtered.length) return false;
    switch (event.key) {
      case 'ArrowDown':
        activeIndex = (activeIndex + 1) % filtered.length;
        emit();
        return true;
      case 'ArrowUp':
        activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
        emit();
        return true;
      case 'Enter':
      case 'Tab':
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
