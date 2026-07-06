import { EditorState, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { FunctionalExtension, defineExtension } from '../extension';
import {
  CompletionContext,
  EMAIL_SAFE_TAGS,
  VOID_TAGS,
  completionContextAt,
  openTags,
} from '../html-source';
import { EMAIL_SAFE_STYLE_PROPERTIES, EMAIL_TAG_ATTRIBUTES } from '../client-support';
import { docText, textOffsetAt } from './html-language';

export interface AutocompleteItem {
  label: string;
}

export interface AutocompleteState {
  open: boolean;
  query: string;
  items: AutocompleteItem[];
  activeIndex: number;
  /** Applies an item: replaces the typed query with the completion. */
  select: (item: AutocompleteItem) => void;
}

export interface AutocompleteOptions {
  /** The floating listbox; contents rendered by the host app from the state
      received through `onChange`. Needs a `position: relative` ancestor. */
  element: HTMLElement;
  /** Gap between the line and the menu, in px. */
  offset?: number;
  /** Notified when the menu opens, closes, filters, or moves its highlight. */
  onChange?: (state: AutocompleteState) => void;
}

const TAG_SUGGESTIONS = [...EMAIL_SAFE_TAGS].sort();

interface Session {
  context: CompletionContext;
  items: AutocompleteItem[];
  /** Document range of the typed query (always within one line). */
  fromPm: number;
  toPm: number;
}

function itemsFor(context: CompletionContext, source: string, offset: number): AutocompleteItem[] {
  const query = context.query.toLowerCase();
  const labels = (() => {
    switch (context.kind) {
      case 'tag':
        return TAG_SUGGESTIONS;
      case 'closing':
        // Innermost open tag first — the one a closer most likely means.
        return [...new Set(openTags(source.slice(0, offset)).reverse())];
      case 'attribute': {
        const merged = new Set([
          ...(EMAIL_TAG_ATTRIBUTES[context.tag] ?? []),
          ...EMAIL_TAG_ATTRIBUTES['*'],
        ]);
        for (const present of context.existing) merged.delete(present);
        return [...merged].sort();
      }
      case 'style-property':
        return EMAIL_SAFE_STYLE_PROPERTIES;
    }
  })();
  return labels.filter((label) => label.startsWith(query)).map((label) => ({ label }));
}

function findSession(state: EditorState): Session | null {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.type.spec['code']) return null;

  const source = docText(state.doc);
  const offset = textOffsetAt(state.doc, $from.pos);
  const context = completionContextAt(source, offset);
  if (!context) return null;

  return {
    context,
    items: itemsFor(context, source, offset),
    fromPm: $from.pos - context.query.length,
    toPm: $from.pos,
  };
}

/** The completion text and where the cursor lands inside it. */
function completionFor(context: CompletionContext, label: string): { text: string; cursor: number } {
  switch (context.kind) {
    case 'tag':
      return VOID_TAGS.has(label)
        ? { text: `${label}>`, cursor: label.length + 1 }
        : { text: `${label}></${label}>`, cursor: label.length + 1 };
    case 'closing':
      return { text: `${label}>`, cursor: label.length + 1 };
    case 'attribute':
      return { text: `${label}=""`, cursor: label.length + 2 };
    case 'style-property':
      return { text: `${label}: `, cursor: label.length + 2 };
  }
}

/**
 * IDE-style completion for the HTML source editor, offering only the
 * email-safe vocabulary: tags after `<`, the currently open tags after `</`,
 * per-tag attributes inside a tag, and safe style properties inside
 * `style="…"`. Same interaction contract as the slash menu — the host app
 * renders the listbox from the emitted state.
 */
export const createHtmlAutocomplete = (options: AutocompleteOptions): FunctionalExtension =>
  defineExtension({
    name: 'htmlAutocomplete',
    plugins: () => [createAutocompletePlugin(options)],
  });

function createAutocompletePlugin(options: AutocompleteOptions): Plugin {
  const { element, offset = 4 } = options;

  let view: EditorView | undefined;
  let session: Session | null = null;
  let activeIndex = 0;
  /** `fromPm` of a session closed with Escape; suppressed until it moves. */
  let dismissedAt: number | null = null;

  const hide = () => {
    element.style.visibility = 'hidden';
  };

  const select = (item: AutocompleteItem) => {
    if (!view || !session) return;
    const { text, cursor } = completionFor(session.context, item.label);
    const tr = view.state.tr.insertText(text, session.fromPm, session.toPm);
    tr.setSelection(TextSelection.create(tr.doc, session.fromPm + cursor));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  };

  const emit = () =>
    options.onChange?.({
      open: session !== null && session.items.length > 0,
      query: session?.context.query ?? '',
      items: session?.items ?? [],
      activeIndex,
      select,
    });

  const position = () => {
    if (!view || !session) return;
    const container = element.offsetParent ?? element.parentElement;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const coords = view.coordsAtPos(session.fromPm);

    const left = Math.min(
      Math.max(coords.left - containerRect.left + container.scrollLeft, 0),
      Math.max(container.scrollWidth - element.offsetWidth, 0),
    );

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

    if (dismissedAt !== null && next?.fromPm !== dismissedAt) dismissedAt = null;
    const previous = session;
    session = next && next.fromPm !== dismissedAt ? next : null;

    if (!session) {
      if (previous) {
        hide();
        emit();
      }
      return;
    }

    const sameSpot =
      previous &&
      previous.fromPm === session.fromPm &&
      previous.context.kind === session.context.kind &&
      previous.context.query === session.context.query;
    if (!sameSpot) activeIndex = 0;

    if (!session.items.length) {
      hide();
    } else {
      element.style.visibility = 'visible';
      position();
    }
    emit();
  };

  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (!session || !session.items.length) return false;
    switch (event.key) {
      case 'ArrowDown':
        activeIndex = (activeIndex + 1) % session.items.length;
        emit();
        return true;
      case 'ArrowUp':
        activeIndex = (activeIndex - 1 + session.items.length) % session.items.length;
        emit();
        return true;
      case 'Enter':
      case 'Tab':
        select(session.items[activeIndex]);
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
    dismissedAt = session.fromPm;
    session = null;
    hide();
    emit();
  };

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
    key: new PluginKey('htmlAutocomplete'),
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
