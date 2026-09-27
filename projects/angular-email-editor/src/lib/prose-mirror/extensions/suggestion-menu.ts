import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import {
  ExtensionContext,
  FunctionalExtension,
  SuggestionCommandItem,
  SuggestionGroup,
  SuggestionItem,
  SuggestionPage,
  SuggestionRequest,
  SuggestionSource,
  defineExtension,
} from '../extension';

export interface SuggestionMenuState {
  open: boolean;
  /** The trigger this state answers to — `/`, `{{`, `@`. A menu of several
      triggers reports the one that is open. */
  trigger: string;
  /** What that trigger's list is called ({@link SuggestionTrigger.label}) —
      the listbox's accessible name on level 1. Null when it was given none. */
  label: string | null;
  /** 1 on the menu's own items; 2 inside a {@link SuggestionGroup} —
      `<trigger><word> <query>`. */
  level: 1 | 2;
  /** The group whose children are listed, at level 2; null at level 1. */
  parent: SuggestionGroup | null;
  /** The search string of the current level: everything after the trigger
      at level 1, everything after `<word> ` at level 2. */
  query: string;
  /** Items matching the query: static matches ranked title-first (given
      order within a tier), then what a source answered for this query — the
      menu's {@link SuggestionMenuOptions.source} at level 1, the group's
      children source at level 2. Titles and keywords are already translated. */
  items: SuggestionItem[];
  /** Index of the keyboard-highlighted item. */
  activeIndex: number;
  /** A source's first page for the current query is in flight (or waiting
      out {@link SuggestionMenuOptions.debounce}) — render a "Searching…"
      row. The menu counts as open while loading, even with no items yet. */
  loading: boolean;
  /** The source's items on screen answer the *previous* query: they stay
      until the new page lands, so the list is diffed rather than torn down
      and rebuilt on every keystroke. Enter and Tab pass over a stale row. */
  stale: boolean;
  /** Where the session sits in the document: the trigger's first character
      to the caret. Null while closed. */
  range: { from: number; to: number } | null;
  /** The trigger's box in viewport coordinates, measured when called — for
      the renderer to place the menu after it has rendered its rows. Null
      while closed. */
  clientRect: () => SuggestionRect | null;
  /** A further page is in flight — render a loading row at the list's end. */
  loadingMore: boolean;
  /** The source has more pages: the renderer's scroll should call
      {@link loadMore} near the end (ArrowDown on the last row already does). */
  hasMore: boolean;
  /** Why the source's last answer failed; null while it has not. Cleared by
      the next query. The menu stays open to say so. */
  error: unknown;
  /** The id the listbox element must carry: the editor points at it
      (`aria-controls`) while the menu is open. */
  listboxId: string;
  /** The id the option at `index` must carry (with `role="option"`): the
      editor points at the highlighted one (`aria-activedescendant`), and the
      pointer's highlight finds its row by it. */
  optionId: (index: number) => string;
  /** The heading for a section id (an item's `section`): the trigger's
      `sections` wording, else the library's own ({@link
      suggestionSectionTitles}), else the id itself. Asked as headings are
      rendered, so a function given as `sections` is heard afresh. */
  sectionTitle: (id: string) => string;
  /** Applies an item. A command item removes the trigger and query text,
      then runs its command; a group rewrites the query to `<word> `,
      opening level 2. */
  select: (item: SuggestionItem) => void;
  /** Level 2 back to level 1 with an empty query — the pointer's way; the
      keyboard's is Backspace over the space. A no-op at level 1. */
  back: () => void;
  /** Fetches the next page and appends it. A no-op while anything is loading,
      when no page is left, or when the menu is closed — safe from any scroll
      handler without guards. */
  loadMore: () => void;
  /** Closes the menu as Escape does — for a renderer's own close control. It
      stays shut for this trigger until the caret has been somewhere else. A
      no-op while closed. */
  dismiss: () => void;
}

/** A box in viewport coordinates. */
export interface SuggestionRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A translation for one item, keyed by its id in
    {@link SuggestionMenuOptions.i18n}. */
export interface SuggestionItemLabel {
  /** Replaces the item's title — shown, ranked first, and (for a group)
      the word written into the query. The original title stays searchable. */
  title?: string;
  /** Extra search strings, added to the item's own — never replacing them,
      so the original words keep working in every locale. */
  keywords?: string[];
  /** Replaces a group's `placeholder`. */
  placeholder?: string;
}

/** What a trigger's {@link SuggestionTrigger.allow} is asked about: a session
    that would open. */
export interface SuggestionAllowProps {
  state: EditorState;
  /** The trigger's first character to the caret. */
  range: { from: number; to: number };
  /** The text after the trigger, leading whitespace dropped. */
  query: string;
}

/** One trigger of a suggestion menu: what opens it, what it lists, what its
    query may look like. Any string is a trigger — `'/'`, `'{{'`, `'@'`,
    `'||'`. */
export interface SuggestionTrigger {
  /** What opens the menu when typed: `'/'`, `'{{'`, `'@'`. */
  trigger: string;
  /** What this trigger's list is called — "Insert block", "Personalization
      tokens". Handed on as {@link SuggestionMenuState.label}: the listbox's
      accessible name. A function is asked afresh whenever the menu opens,
      like `i18n`: the words of the language in use. */
  label?: string | (() => string);
  /** Only at the start of a line or after whitespace — `/` in a URL stays
      text. In a script that writes no spaces (Japanese, Chinese) every
      character counts as one: `/` opens right after こんにちは. Default true. Either way a trigger right after its own first
      character never opens: not `//`, not Handlebars' `{{{`. */
  startOfWord?: boolean;
  /** What the text between the trigger and the caret may be. Default: not
      starting with whitespace (typing `/ ` dismisses), spaces inside allowed
      (`/heading 2`), and no trigger character (a later one starts a new
      session). A merge-tag menu narrows it to a path: `/^ ?[\w.]*$/`. The
      query handed on is that text with its leading whitespace dropped. */
  query?: RegExp;
  /** The longest query that still counts as one. Default 100. */
  maxLength?: number;
  /** The menu's own items — a list, or a function of the editor's extensions
      (`extensionSuggestions` for the kit's `/` commands). Filtered and
      ranked by the query; groups among them open a second level. */
  items?: readonly SuggestionItem[] | ((ctx: ExtensionContext) => readonly SuggestionItem[]);
  /**
   * The menu's dynamic items, asked per query and per page — a server
   * catalogue, a search backend. Its answers are appended after the static
   * matches, **not** re-filtered: the source owns its matching. Stale answers
   * are dropped and their requests aborted (a newer query, a dismissal, a
   * destroyed editor) — the host never race-guards. A group's children
   * source works the same way at level 2.
   */
  source?: SuggestionSource;
  /** Shown after the bare trigger, until a query is typed — "Type to
      filter…". It is handed to the session's decoration as
      `data-placeholder`; the host's stylesheet shows it (see
      {@link createSuggestionMenu}, "Marked in the text"). Inside a group the
      group's own takes its place: `/templates ` shows
      {@link SuggestionGroup.placeholder}. A function is asked afresh whenever
      the menu opens. */
  placeholder?: string | (() => string);
  /**
   * The host's veto: asked for every session the text would open, and the
   * menu stays shut — for this trigger; one further back may still open —
   * when it says no. For what the text alone cannot tell: a caret that is
   * not typing a query but standing in something already written. The `{{`
   * menu needs one — the braces before a caret *inside* `{{ firstName }}`
   * open that token, and picking a row there would write a second token into
   * the first:
   *
   *     allow: ({ state }) => !caretInsideMergeTag(state)
   *
   * Asked once per editor state, so it may look at the document.
   */
  allow?: (props: SuggestionAllowProps) => boolean;
  /** Milliseconds to sit on a keystroke before asking a source for a new
      query — a server should see the settled query, not every letter.
      Default 300; 0 asks at once (an in-memory source). Static matches never
      wait, and neither does a further page. */
  debounce?: number;
  /**
   * Translations by item id, at either level: a title, extra keywords, a
   * group's placeholder. A map — or a function of the id, which is asked
   * afresh every time the menu opens: hand it a translation service's lookup
   * and a language switch reaches the menu, its search included, with
   * nothing to re-create. Whatever it answers is *added* to the item's own
   * words, so the original language keeps matching beside the chosen one.
   */
  i18n?:
    | Readonly<Record<string, SuggestionItemLabel>>
    | ((id: string) => SuggestionItemLabel | undefined);
  /**
   * The headings of the items' sections (`SuggestionItem.section`), by id:
   * a map, or a function of the id, asked whenever a heading is rendered —
   * hand it a translation service's lookup and a language switch reaches
   * the headings too. What it leaves out is worded by the library
   * ({@link suggestionSectionTitles}), and an id neither knows shows as it
   * is.
   */
  sections?: Readonly<Record<string, string>> | ((id: string) => string | undefined);
  /** The listbox id ({@link SuggestionMenuState.listboxId}); unique by default. */
  id?: string;
}

/** The library's wording of the sections its own actions declare — and of
    the ones a host commonly adds: its palette's rows (`color`), its groups. */
export const suggestionSectionTitles: Readonly<Record<string, string>> = {
  ai: 'AI',
  blocks: 'Basic blocks',
  styling: 'Styling',
  color: 'Color',
  media: 'Media',
  layout: 'Layout',
  message: 'Message',
  templates: 'Templates',
  examples: 'Examples',
};

/**
 * A suggestion menu: the element it shows in, and the triggers that open it
 * — one, written inline, or several in `triggers`:
 *
 *     createSuggestionMenu({ element, onChange, trigger: '/', items: extensionSuggestions })
 *     createSuggestionMenu({ element, onChange, triggers: [
 *       { trigger: '/', label: 'Insert block', items: extensionSuggestions },
 *       { trigger: '{{', label: 'Tokens', startOfWord: false, source: fetchMergeTags },
 *       { trigger: '||', label: 'Snippets', source: fetchSnippets },
 *     ] })
 */
export interface SuggestionMenuOptions extends Partial<SuggestionTrigger> {
  /**
   * The menu's element, rendered by the host from the
   * {@link SuggestionMenuState} it receives through `onChange`. The plugin
   * never writes to it — placing and showing it is the renderer's, after its
   * rows are in (see `clientRect`) — it only listens: a press on it keeps the
   * editor's focus, a press anywhere else dismisses.
   */
  element: HTMLElement;
  /** Further triggers that open this same menu — after the inline one, when
      there is one. They never open together (the trigger nearest the caret
      wins), so one element and one `onChange` serve them all: the state says
      whose list it is (`trigger`, `label`, `listboxId`). */
  triggers?: readonly SuggestionTrigger[];
  /** Notified when the menu opens, closes, filters, loads, or moves — with
      the state of the trigger that is open, or of the one that just closed. */
  onChange?: (state: SuggestionMenuState) => void;
}

/** What the triggers of one menu share. */
interface SuggestionMenuHost {
  element: HTMLElement;
  onChange: (state: SuggestionMenuState) => void;
}

/** What the plugin keeps in the editor's state, so that it moves with the
    text and is there when the decoration is drawn. */
interface SessionState {
  /** The session this menu has for the state — none while dismissed, or
      while another menu's trigger sits nearer the caret. */
  session: Session | null;
  /** `from` of the session that was dismissed; held until the caret has been
      anywhere else. */
  dismissed: number | null;
}

interface SessionMeta {
  dismiss: true;
}

const sameSession = (a: Session | null, b: Session | null): boolean =>
  a === b || (!!a && !!b && a.from === b.from && a.to === b.to && a.text === b.text);

interface Session {
  /** Position of the trigger's first character. */
  from: number;
  /** Cursor position (end of the query). */
  to: number;
  /** Everything typed after the trigger, leading whitespace dropped. */
  text: string;
}

/** Where a session's text puts the menu: which level, and its search. */
interface Scope {
  parent: SuggestionGroup | null;
  query: string;
}

type Answer = SuggestionItem[] | SuggestionPage;

let nextListboxId = 0;

/** The menus of each editor, as the start of the session each would open
    for a state — so that only the one nearest the caret opens. */
const menusOf = new WeakMap<EditorView, Set<(state: EditorState) => number | null>>();

/** What may stand right before a trigger that wants the start of a word:
    whitespace — or a character of a script that writes no spaces between its
    words (kana, CJK ideographs and their punctuation, full-width forms), where
    every character is a place a word may start. */
const WORD_BREAK = /[\s\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The word a title becomes in the query: lowercased, spaces as hyphens. */
const commandWord = (text: string): string => text.trim().toLowerCase().split(/\s+/).join('-');

/** A group is entered by its (translated) title, its id, or any keyword —
    the original title among them once translated. */
const groupWords = (group: SuggestionGroup): string[] =>
  [group.id, group.title, ...(group.keywords ?? [])].map(commandWord);

function localize<T extends SuggestionItem>(item: T, i18n: SuggestionTrigger['i18n']): T {
  const label = typeof i18n === 'function' ? i18n(item.id) : i18n?.[item.id];
  if (!label) return item;
  const keywords = [...(item.keywords ?? []), ...(label.keywords ?? [])];
  if (label.title && label.title !== item.title) keywords.push(item.title);
  return {
    ...item,
    title: label.title ?? item.title,
    keywords,
    ...(item.children && label.placeholder ? { placeholder: label.placeholder } : {}),
  };
}

function filterItems<T extends SuggestionItem>(items: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...items];
  return items.filter((item) => {
    const haystack = [item.title, ...(item.keywords ?? [])].map((s) => s.toLowerCase());
    return words.every((word) => haystack.some((entry) => entry.includes(word)));
  });
}

/** Matches, best first: a query naming an item's *title* must beat a
    keyword-only match — typing "/columns" should highlight Columns, not the
    table (whose keywords include "columns"). Stable within a tier, so the
    given order remains the tiebreak. */
function rankItems<T extends SuggestionItem>(matches: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return matches;
  const tier = (item: SuggestionItem): number => {
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
 * A suggestion menu: typing `trigger` opens a list under the caret, the text
 * after it searches the list, and picking an item replaces trigger and query
 * with what the item does. One factory for every such menu — the `/` command
 * menu and the `{{` merge-tag picker are two triggers with different
 * options, in one menu (one element, one state) or in a menu each:
 *
 *     createSuggestionMenu({ element, onChange, triggers: [
 *       { trigger: '/', items: extensionSuggestions },
 *       { trigger: '{{', startOfWord: false, query: /^ ?[\w.]*$/, source: fetchMergeTags },
 *     ] })
 *
 * The host renders the list from the state (the library's
 * `email-suggestion-menu` pair does it); this plugin does the rest —
 * detection, filtering, the paged and debounced source, keyboard navigation,
 * applying. It never writes to the menu element: showing and placing it are
 * the renderer's, after its rows are in (`clientRect` says where).
 *
 * **Read from the text.** A session is a caret right after
 * `<trigger><query>`, however the text got there, and nothing else is held:
 * undo, paste, and moving the caret back into a query all land right.
 *
 * **Two levels.** A {@link SuggestionGroup} ("Templates") picked on level 1
 * rewrites the query to `templates `; from then on the words after that
 * space search the group's children. Backspace over the space is level 1
 * again.
 *
 * **One at a time.** Several menus on one editor never open together: when
 * two sessions overlap (`/templates {{`), the trigger nearest the caret wins
 * and the other stays shut until it is gone.
 *
 * **Marked in the text.** While a session lasts, its trigger and query are
 * wrapped in a decoration — `<span class="aee-suggestion" data-trigger="/">`,
 * with `data-level`, and with `aee-suggestion-empty` and a
 * `data-placeholder` while the level's query is empty (the trigger's after
 * `/`, the group's after `/templates `) — for the host's stylesheet: the
 * library paints nothing.
 * Nothing of it is in the document or the HTML. The session, and the place
 * where Escape dismissed one, live in the plugin's state and move with the
 * text: what a sync writes before a dismissed trigger does not reopen it.
 *
 * **One highlight.** The arrows move it and so does the pointer, over the
 * rows that carry the state's option ids — hover is not a second one.
 *
 * **The editor is the combobox.** Focus never leaves it: while the menu is
 * open the editable carries `aria-controls` (the listbox) and
 * `aria-activedescendant` (the highlighted option), whose ids the state
 * hands the renderer.
 */
export const createSuggestionMenu = (options: SuggestionMenuOptions): FunctionalExtension => {
  const { element, onChange, triggers: further = [], ...inline } = options;
  const triggers = [
    ...(inline.trigger !== undefined ? [inline as SuggestionTrigger] : []),
    ...further,
  ];
  if (!triggers.length || triggers.some(({ trigger }) => !trigger)) {
    throw new Error('createSuggestionMenu: trigger must not be empty');
  }
  if (new Set(triggers.map(({ trigger }) => trigger)).size !== triggers.length) {
    throw new Error('createSuggestionMenu: every trigger of a menu must be different');
  }

  return defineExtension({
    name: 'suggestionMenu',
    plugins: (ctx) => {
      // One stream of states for the one element. The triggers never open
      // together, but they all report: what reaches the host is the open
      // one's state, and its closing — never the "still closed" of another
      // while it shows.
      let showing: string | null = null;
      const host: SuggestionMenuHost = {
        element,
        onChange: (state) => {
          if (state.open) showing = state.trigger;
          else if (showing !== null && showing !== state.trigger) return;
          else showing = null;
          onChange?.(state);
        },
      };
      return triggers.map((trigger) => createSuggestionMenuPlugin(ctx, trigger, host));
    },
  });
};

function createSuggestionMenuPlugin(
  ctx: ExtensionContext,
  options: SuggestionTrigger,
  host: SuggestionMenuHost,
): Plugin {
  const { element } = host;
  const { trigger, i18n, startOfWord = true, maxLength = 100, debounce = 300 } = options;
  const key = new PluginKey<SessionState>('suggestionMenu');

  const first = escapeRegExp(trigger[0]);
  const queryPattern = options.query ?? new RegExp(`^(?:[^\\s${first}][^${first}]*)?$`);

  const given = typeof options.items === 'function' ? options.items(ctx) : (options.items ?? []);
  /** The menu's items in the words of the moment — relabelled whenever a
      session starts, so an `i18n` function is heard after a language switch. */
  let allItems: SuggestionItem[] = [];
  let groups: SuggestionGroup[] = [];
  let label: string | null = null;
  let placeholder: string | undefined;
  const words = (given: string | (() => string) | undefined) =>
    typeof given === 'function' ? given() : given;
  const relabel = () => {
    label = words(options.label) ?? null;
    placeholder = words(options.placeholder);
    allItems = given.map((item) => localize(item, i18n));
    groups = allItems.filter((item): item is SuggestionGroup => !!item.children);
  };
  relabel();

  const listboxId = options.id ?? `email-suggestion-menu-${nextListboxId++}`;
  const optionId = (index: number) => `${listboxId}-option-${index}`;
  const sectionTitle = (id: string): string => {
    const { sections } = options;
    const words = typeof sections === 'function' ? sections(id) : sections?.[id];
    return words ?? suggestionSectionTitles[id] ?? id;
  };

  /**
   * An active session is derived from the document, not from keystrokes: a
   * cursor sitting right after `<trigger><query>` is a session.
   */
  const findSession = (state: EditorState): Session | null => {
    const { $from, empty } = state.selection;
    // A selection is no session — except an input method's: while it
    // composes, what is being composed may stand selected, and the query
    // must not close and reopen under every candidate.
    if ((!empty && !view?.composing) || !$from.parent.isTextblock) return null;
    // Only as far back as a session can reach — the trigger, the longest
    // query, and the character before them — so a keystroke at the end of a
    // long paragraph does not serialize all of it. A trigger further back
    // would be turned down for its length anyway, and so is one at the
    // window's very start (its query is one too long): `prefix` is only
    // ever null at the start of the block. Inline leaves count one
    // character, as they do one position.
    const windowStart = Math.max(0, $from.parentOffset - (maxLength + trigger.length + 1));
    const textBefore = $from.parent.textBetween(windowStart, $from.parentOffset, undefined, '￼');
    const at = textBefore.lastIndexOf(trigger);
    if (at < 0) return null;
    const raw = textBefore.slice(at + trigger.length);
    if (raw.length > maxLength || !queryPattern.test(raw)) return null;
    const prefix = at > 0 ? textBefore[at - 1] : null;
    if (prefix === trigger[0]) return null;
    if (startOfWord && prefix !== null && !WORD_BREAK.test(prefix)) return null;
    const match = { from: $from.start() + windowStart + at, to: $from.pos, text: raw.trimStart() };
    const range = { from: match.from, to: match.to };
    if (options.allow && !options.allow({ state, range, query: match.text })) return null;
    return match;
  };

  /** `findSession`, once per state: a transaction asks every menu of the
      editor about every other (see `ownSession`), and each answers from here. */
  let found: { state: EditorState; session: Session | null } | undefined;
  const sessionOf = (state: EditorState): Session | null => {
    if (found?.state !== state) found = { state, session: findSession(state) };
    return found.session;
  };

  let view: EditorView | undefined;
  let session: Session | null = null;
  let scope: Scope = { parent: null, query: '' };
  /** Static matches + the source's contribution — what navigation runs over. */
  let filtered: SuggestionItem[] = [];
  let staticMatches: SuggestionItem[] = [];
  let dynamicItems: SuggestionItem[] = [];
  let loading = false;
  let loadingMore = false;
  /** `dynamicItems` answer the previous query; the new one is on its way. */
  let stale = false;
  let error: unknown = null;
  /** The cursor of the source's next page; null when there is none. */
  let nextCursor: string | null = null;
  /** ArrowDown on the last row asked for the page: step onto its first row
      when it lands. */
  let advanceOnLoad = false;
  /** Aborted by a new query or a dismissal: every request still out for the
      old one, first pages and further pages alike, is cancelled and its
      answer dropped. */
  let requests = new AbortController();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let activeIndex = 0;

  /** Level 2 when the text is `<word> <rest>` and the word names a group. */
  const scopeOf = (text: string): Scope => {
    // Any space: an input method for Japanese types a full-width one.
    const space = text.search(/\s/);
    if (space > 0) {
      const word = commandWord(text.slice(0, space));
      const parent = groups.find((group) => groupWords(group).includes(word));
      if (parent) return { parent, query: text.slice(space + 1) };
    }
    return { parent: null, query: text };
  };

  const isOpen = () =>
    session !== null && (filtered.length > 0 || loading || error !== null || scope.parent !== null);

  /** Cancels whatever is out. `keep` holds the source's items on screen as
      stale — a new query in the same place — instead of emptying the list. */
  const invalidateSource = (keep = false) => {
    requests.abort();
    requests = new AbortController();
    clearTimeout(debounceTimer);
    stale = keep && dynamicItems.length > 0;
    if (!stale) dynamicItems = [];
    loading = false;
    loadingMore = false;
    error = null;
    nextCursor = null;
    advanceOnLoad = false;
  };

  const mergeItems = () => {
    filtered = [...staticMatches, ...dynamicItems];
    if (activeIndex >= filtered.length) activeIndex = Math.max(0, filtered.length - 1);
  };

  /** An action that *says* it cannot run right now is not offered: "Clear
      formatting" needs a selection a caret's menu never has. Only an explicit
      `isEnabled` counts — a plain command is never asked, since a host's may
      not keep to the dry-run convention and would act on every keystroke. */
  const offered = <T extends SuggestionItem>(items: readonly T[]): readonly T[] => {
    const state = view?.state;
    if (!state) return items;
    return items.filter((item) => item.children || (item.isEnabled?.(state) ?? true));
  };

  /** Level 1 matches the menu's items; level 2 a group's list. */
  const matchStatic = (): SuggestionItem[] => {
    const { parent, query } = scope;
    if (!parent) return rankItems(filterItems(offered(allItems), query), query);
    if (typeof parent.children === 'function') return [];
    const children = parent.children.map((child) => localize(child, i18n));
    return rankItems(filterItems(offered(children), query), query);
  };

  /** The current level's source: the menu's own, or the group's. */
  const source = (): SuggestionSource | undefined => {
    const { parent } = scope;
    if (!parent) return options.source;
    return typeof parent.children === 'function'
      ? (parent.children as SuggestionSource)
      : undefined;
  };

  const pageOf = (answer: Answer) =>
    Array.isArray(answer)
      ? { items: answer, nextCursor: null }
      : { items: answer.items, nextCursor: answer.nextCursor ?? null };

  const localized = (items: SuggestionItem[]) => items.map((item) => localize(item, i18n));

  /** Asks the source for `cursor`'s page. A synchronous answer lands at
      once; a promise lands (and is emitted) when it resolves, unless its
      request was aborted meanwhile. True while the answer is pending. */
  const ask = (
    cursor: string | null,
    land: (page: { items: SuggestionItem[]; nextCursor: string | null }) => void,
    fail: (reason: unknown) => void,
  ): boolean => {
    const from = source();
    if (!from) return false;
    const { signal } = requests;
    let result: ReturnType<SuggestionSource>;
    try {
      result = from({ query: scope.query, cursor, signal } satisfies SuggestionRequest);
    } catch (reason) {
      fail(reason);
      return false;
    }
    if (typeof (result as PromiseLike<Answer>).then !== 'function') {
      land(pageOf(result as Answer));
      return false;
    }
    Promise.resolve(result).then(
      (answer) => {
        if (signal.aborted || !view) return; // superseded or closed
        land(pageOf(answer));
        emit();
      },
      (reason) => {
        if (signal.aborted || !view) return;
        fail(reason);
        emit();
      },
    );
    return true;
  };

  const landFirst = (page: { items: SuggestionItem[]; nextCursor: string | null }) => {
    dynamicItems = localized(page.items);
    nextCursor = page.nextCursor;
    loading = false;
    stale = false;
    mergeItems();
  };

  const failFirst = (reason: unknown) => {
    loading = false;
    stale = false;
    dynamicItems = [];
    error = reason ?? new Error('Suggestion source failed');
    mergeItems();
  };

  /** A new query: whatever is out is aborted, then the source is asked — at
      once, or after the debounce, `loading` meanwhile. `keep` holds the
      items on screen until the answer replaces them. */
  const querySource = (keep: boolean) => {
    invalidateSource(keep);
    if (!source()) {
      stale = false;
      dynamicItems = [];
      return;
    }
    if (!debounce) {
      loading = ask(null, landFirst, failFirst);
      return;
    }
    loading = true;
    debounceTimer = setTimeout(() => {
      loading = ask(null, landFirst, failFirst);
      // A synchronous answer after the wait has landed but not been emitted.
      if (!loading) emit();
    }, debounce);
  };

  const loadMore = () => {
    if (!view || !session || loading || loadingMore || nextCursor === null) return;
    const before = filtered.length;
    loadingMore = ask(
      nextCursor,
      (page) => {
        dynamicItems = [...dynamicItems, ...localized(page.items)];
        nextCursor = page.nextCursor;
        loadingMore = false;
        mergeItems();
        if (advanceOnLoad && filtered.length > before) activeIndex = before;
        advanceOnLoad = false;
      },
      (reason) => {
        loadingMore = false;
        advanceOnLoad = false;
        error = reason ?? new Error('Suggestion source failed');
      },
    );
    emit();
  };

  /** Rewrites the session's text after the trigger — the focus stays put. */
  const rewrite = (text: string) => {
    if (!view || !session) return;
    view.dispatch(view.state.tr.insertText(text, session.from + trigger.length, session.to));
    view.focus();
  };

  const select = (item: SuggestionItem) => {
    if (!view || !session) return;
    if (item.children) {
      rewrite(`${commandWord(item.title)} `);
      return;
    }
    view.dispatch(view.state.tr.delete(session.from, session.to));
    (item as SuggestionCommandItem).command(view.state, view.dispatch, view);
    view.focus();
  };

  const back = () => {
    if (scope.parent) rewrite('');
  };

  const clientRect = (): SuggestionRect | null => {
    if (!view || !session) return null;
    const { left, right, top, bottom } = view.coordsAtPos(session.from);
    return { left, right, top, bottom };
  };

  /** Sets an attribute on the editor only when its value differs: every
      write is a mutation record ProseMirror's observer has to look at. */
  const setAttr = (dom: HTMLElement, name: string, value: string | null) => {
    if (dom.getAttribute(name) === value) return;
    if (value === null) dom.removeAttribute(name);
    else dom.setAttribute(name, value);
  };

  /** The editor as the combobox: which listbox it controls, and which option
      is the active one. Written on the element directly — ProseMirror only
      manages the attributes it was given — and only ever cleared by the menu
      that set them, so a closing menu never wipes an open one's. */
  const describe = () => {
    const dom = view?.dom;
    if (!dom) return;
    if (isOpen()) {
      setAttr(dom, 'aria-controls', listboxId);
      setAttr(dom, 'aria-autocomplete', 'list');
      setAttr(dom, 'aria-activedescendant', filtered.length ? optionId(activeIndex) : null);
    } else if (dom.getAttribute('aria-controls') === listboxId) {
      setAttr(dom, 'aria-controls', null);
      setAttr(dom, 'aria-autocomplete', null);
      setAttr(dom, 'aria-activedescendant', null);
    }
  };

  /** The press that dismisses is only listened for while there is something
      to dismiss: a closed menu costs the page's clicks nothing. */
  let watchingOutside = false;
  const watchOutside = (watch: boolean) => {
    if (watch === watchingOutside) return;
    watchingOutside = watch;
    if (watch) window.addEventListener('mousedown', onWindowMousedown);
    else window.removeEventListener('mousedown', onWindowMousedown);
  };

  const emit = () => {
    describe();
    watchOutside(isOpen());
    host.onChange({
      open: isOpen(),
      trigger,
      label,
      level: scope.parent ? 2 : 1,
      parent: scope.parent,
      query: scope.query,
      items: filtered,
      activeIndex,
      loading,
      stale,
      loadingMore,
      hasMore: nextCursor !== null,
      error,
      range: session && { from: session.from, to: session.to },
      clientRect,
      listboxId,
      optionId,
      sectionTitle,
      select,
      back,
      loadMore,
      dismiss,
    });
  };

  const close = () => {
    session = null;
    scope = { parent: null, query: '' };
    filtered = [];
    staticMatches = [];
    invalidateSource();
    emit();
  };

  /** This menu's session for a state — unless another menu's trigger sits
      nearer the caret, in which case that one is the menu that opens. */
  const candidate = (state: EditorState): number | null => sessionOf(state)?.from ?? null;

  const ownSession = (state: EditorState): Session | null => {
    const mine = sessionOf(state);
    if (!mine || !view) return mine;
    for (const other of menusOf.get(view) ?? []) {
      if (other === candidate) continue;
      const theirs = other(state);
      if (theirs !== null && theirs > mine.from) return null;
    }
    return mine;
  };

  const refresh = () => {
    if (!view) return;
    const previous = session;
    session = key.getState(view.state)?.session ?? null;

    if (!session) {
      if (previous) close();
      return;
    }

    // A transaction that leaves the session as it was (a mark elsewhere, a
    // sync) changes nothing on screen: no emit, no render.
    if (previous && session.text === previous.text && session.from === previous.from) return;

    const previousParent = scope.parent;
    scope = scopeOf(session.text);
    // A new level starts at the top; within a level, a new query too.
    activeIndex = 0;
    staticMatches = matchStatic();
    // The same session on the same level keeps its rows until the new answer
    // replaces them; a new session or a new level starts empty.
    querySource(
      previous !== null && session.from === previous.from && scope.parent === previousParent,
    );
    mergeItems();
    emit();
  };

  /** Moves the highlight one row, stopping at the first and last — no wrap.
      At an end nothing changes, so nothing is emitted: a held arrow key
      against the bottom costs no renders. The one exception is the bottom
      of a list with more pages: there the arrow *is* the scroll — the next
      page is fetched (once, however long the key is held) and the highlight
      steps onto its first row when it lands. */
  const move = (step: 1 | -1) => {
    const next = Math.min(Math.max(activeIndex + step, 0), filtered.length - 1);
    if (step === 1 && next === activeIndex && nextCursor !== null && !loadingMore) {
      advanceOnLoad = true;
      loadMore();
      return;
    }
    if (next === activeIndex) return;
    activeIndex = next;
    emit();
  };

  const onKeyDown = (event: KeyboardEvent): boolean => {
    // While a source is still loading the menu is open (a "Searching…" row),
    // so Escape must dismiss it — but item keys need actual items.
    if (!isOpen()) return false;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        if (!filtered.length) return scope.parent !== null;
        move(event.key === 'ArrowDown' ? 1 : -1);
        // Taken even at an end: the caret must not leave the query line.
        return true;
      case 'Enter':
      case 'Tab':
        // Inside a group the keys belong to the picker, even with nothing
        // (yet) to pick — no stray line break under a "Searching…" row.
        if (!filtered.length) return scope.parent !== null;
        // A stale row answers the last query, not this one: typing "comp"
        // and pressing Enter must not insert what "co" found. The key waits
        // (taken, nothing applied) until the new page is in.
        if (stale && activeIndex >= staticMatches.length) return true;
        select(filtered[activeIndex]);
        return true;
      case 'Escape':
        dismiss();
        return true;
      default:
        return false;
    }
  };

  /** Dismissal is a transaction: the plugin's state takes note of where, the
      decoration goes with it, and the view's update closes the menu. */
  const dismiss = () => {
    if (!view || !session) return;
    view.dispatch(view.state.tr.setMeta(key, { dismiss: true } satisfies SessionMeta));
  };

  // Keep clicks on menu items (and its scrollbar) from blurring the editor.
  const onMenuMousedown = (event: Event) => event.preventDefault();

  // One highlight, whoever moves it: the pointer over a row takes the
  // keyboard's highlight there, so hover and highlight are never two rows.
  // The row is known by the id this plugin handed out. Only a pointer that
  // really moved counts — a list scrolling (or opening) under a resting one
  // sends moves too, from the same spot. Listened to natively and emitted
  // only when the row changes: crossing the menu renders nothing else.
  let pointer: { x: number; y: number } | undefined;
  const optionPrefix = `${listboxId}-option-`;
  const onMenuMousemove = (event: MouseEvent) => {
    const moved = pointer && (pointer.x !== event.clientX || pointer.y !== event.clientY);
    pointer = { x: event.clientX, y: event.clientY };
    if (!moved || !isOpen()) return;
    const option = (event.target as Element | null)?.closest?.('[role="option"]');
    if (!option?.id.startsWith(optionPrefix)) return;
    const index = Number(option.id.slice(optionPrefix.length));
    if (!Number.isInteger(index) || index >= filtered.length || index === activeIndex) return;
    activeIndex = index;
    emit();
  };

  // Any press that is not on the menu dismisses — first click, focus or not.
  // That includes clicks inside the editable: blank space maps to the nearest
  // text position, which can be exactly where the cursor already sits (right
  // after the query), so no selection change would ever close the session.
  // If the cursor lands after the same trigger again, the dismissal keeps it shut.
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

  return new Plugin<SessionState>({
    key,
    state: {
      init: (_config, state) => ({ session: ownSession(state), dismissed: null }),
      apply: (tr, previous, _oldState, state) => {
        const dismiss = (tr.getMeta(key) as SessionMeta | undefined)?.dismiss === true;
        // A session is read from the text before the caret: a transaction
        // that moved neither (another plugin's meta) has no news.
        if (!dismiss && !tr.docChanged && !tr.selectionSet) return previous;

        const next = ownSession(state);
        // A dismissal stays with its trigger as the text moves — what is
        // typed or synced in before it does not make it a new one — and
        // lasts until the caret has been anywhere else.
        const place = dismiss && previous.session ? previous.session.from : previous.dismissed;
        let dismissed = place === null ? null : tr.mapping.map(place, 1);
        if (dismissed !== null && next?.from !== dismissed) dismissed = null;
        const session = next && next.from !== dismissed ? next : null;
        // Before anything reads the labels: the level a text is on (and with
        // it the decoration) depends on what the groups are called now.
        // A new session is one that starts somewhere else — also straight
        // after one that found nothing and so never showed.
        if (session && session.from !== previous.session?.from) relabel();

        return sameSession(session, previous.session) && dismissed === previous.dismissed
          ? previous
          : { session, dismissed };
      },
    },
    props: {
      handleKeyDown: (_view, event) => onKeyDown(event),
      // The session, marked in the text — from the state being rendered, so
      // it is never a transaction behind.
      decorations: (state) => {
        const current = key.getState(state)?.session;
        if (!current) return null;
        // Empty is the *level's* query: after the bare trigger, and again
        // after a group's word and its space — each with its own words.
        const level = scopeOf(current.text);
        const empty = level.query === '';
        const hint = level.parent ? level.parent.placeholder : placeholder;
        return DecorationSet.create(state.doc, [
          Decoration.inline(current.from, current.to, {
            nodeName: 'span',
            class: empty ? 'aee-suggestion aee-suggestion-empty' : 'aee-suggestion',
            'data-trigger': trigger,
            'data-level': level.parent ? '2' : '1',
            ...(empty && hint ? { 'data-placeholder': hint } : {}),
          }),
        ]);
      },
    },
    view: (editorView) => {
      view = editorView;
      const menus = menusOf.get(editorView) ?? new Set();
      menus.add(candidate);
      menusOf.set(editorView, menus);
      element.addEventListener('mousedown', onMenuMousedown);
      element.addEventListener('mousemove', onMenuMousemove);
      editorView.dom.addEventListener('blur', onBlur);
      refresh();
      return {
        // The plugin's state keeps its identity while the session does.
        update: (updated, previous) => {
          if (key.getState(previous) === key.getState(updated.state)) return;
          refresh();
        },
        destroy: () => {
          editorView.dom.removeEventListener('blur', onBlur);
          watchOutside(false);
          element.removeEventListener('mousemove', onMenuMousemove);
          element.removeEventListener('mousedown', onMenuMousedown);
          menus.delete(candidate);
          invalidateSource();
          session = null;
          describe();
          view = undefined;
        },
      };
    },
  });
}
