import { MarkSpec, NodeSpec, Schema } from 'prosemirror-model';
import { Command, EditorState, Plugin } from 'prosemirror-state';
import { InputRule } from 'prosemirror-inputrules';

/** Passed to every extension factory once the schema has been built. */
export interface ExtensionContext {
  schema: Schema;
  /** All extensions of the editor, so aggregators (e.g. a suggestion menu) can introspect them. */
  extensions: readonly Extension[];
}

/**
 * A command factory: called with user arguments (e.g. a heading level),
 * returns a ProseMirror {@link Command} ready to run against the editor.
 */
export type CommandFactory = (...args: any[]) => Command;

interface SuggestionItemBase {
  /** Stable and locale-neutral (`'heading-2'`, `'table'`): what a menu's
      `i18n` labels are keyed by, and what a renderer tracks rows by. Unique
      within its level. */
  id: string;
  /** Shown, and matched first — the menu's `i18n` may translate it. */
  title: string;
  /** Extra strings the query is matched against besides the title. */
  keywords?: string[];
  /** A secondary line for the row — a merge tag's path, a shortcut. */
  detail?: string;
  /** An icon name, for renderers that show one (the demo: Material). */
  icon?: string;
}

/** A suggestion that acts: picking it deletes the trigger and query text,
    then runs `command` at that spot. The only kind a {@link SuggestionGroup}
    may hold. */
export interface SuggestionCommandItem extends SuggestionItemBase {
  /** Runs after the trigger and query text have been deleted. */
  command: Command;
  /** Whether it can run right now, when the item wants to say. A menu does
      not offer a row that says no; a button for it shows disabled. Absent,
      a menu always offers the row — it never asks a plain command, which a
      host may not have written to the dry-run convention — and a button
      asks the command itself (see {@link isActionEnabled}). */
  isEnabled?: (state: EditorState) => boolean;
  children?: never;
}

/**
 * Something an extension can do, declared once and shown wherever a host
 * wants it: a row of a `/` menu, a toolbar button, a bubble menu, a menu
 * item. It is a {@link SuggestionCommandItem} — the same id, words, icon and
 * command — that also knows its state, so a button can show it.
 *
 * An action is permanent and named; a *suggestion* in the narrower sense (a
 * merge tag for `{{fi`, a template, a correction) is an answer to a moment
 * and comes from a {@link SuggestionSource}. Both end in the same row.
 */
export interface EditorAction extends SuggestionCommandItem {
  /** Whether it is on at the selection — a toggle's pressed state. Absent
      for what has no "on": inserting a table, sending. */
  isActive?: (state: EditorState) => boolean;
}

/** Whether `action` can run on `state`: its own `isEnabled` when it has
    one, else the command is asked the ProseMirror way — run without a
    dispatch, it only says whether it would apply. An extension's commands
    keep to that; declare `isEnabled` where the answer is too costly to ask
    on every transaction. */
export const isActionEnabled = (action: EditorAction, state: EditorState): boolean =>
  action.isEnabled ? action.isEnabled(state) : action.command(state);

/** What a {@link SuggestionSource} is asked for. */
export interface SuggestionRequest {
  /** The search string of the level being asked for. */
  query: string;
  /** `null` for the first page, else the `nextCursor` the previous page
      returned. */
  cursor: string | null;
  /** Aborted once the answer is no longer wanted — a newer query, a
      dismissal, a destroyed editor. Hand it to `fetch` / `HttpClient`. */
  signal: AbortSignal;
}

/** One page of suggestions. A non-null `nextCursor` means more pages exist:
    the menu reports `hasMore` and fetches the next on `loadMore()`. */
export interface SuggestionPage<T extends SuggestionItem = SuggestionItem> {
  items: T[];
  nextCursor?: string | null;
}

/** A server-backed (or any computed) list of suggestions, asked per query
    and per page; it owns its own matching. A bare array is one page with
    nothing after it. A rejected promise is the menu's `error`. */
export type SuggestionSource<T extends SuggestionItem = SuggestionItem> = (
  request: SuggestionRequest,
) => T[] | SuggestionPage<T> | Promise<T[] | SuggestionPage<T>>;

/**
 * A suggestion that opens a second level: picking it rewrites the query to
 * `<word> ` (its title, lowercased, spaces as hyphens) after the trigger, and
 * whatever is typed after that space searches its children. Two levels, no
 * more — a group's children are command items.
 *
 * `children` is either a list, which the menu filters and ranks like the
 * first level, or a {@link SuggestionSource}.
 */
export interface SuggestionGroup extends SuggestionItemBase {
  /** Shown after `<trigger><word> `, until the group's own query is typed —
      "Search templates…". The second level's counterpart of a trigger's
      `placeholder`, handed to the session's decoration the same way; the
      menu's `i18n` may translate it. */
  placeholder?: string;
  children: readonly SuggestionCommandItem[] | SuggestionSource<SuggestionCommandItem>;
  command?: never;
}

/** An entry in a suggestion menu. */
export type SuggestionItem = SuggestionCommandItem | SuggestionGroup;

interface BaseExtension {
  name: string;
  /** Named commands exposed on the editor, e.g. `editor.commands.toggleBold()`. */
  commands?: (ctx: ExtensionContext) => Record<string, CommandFactory>;
  /** Key bindings. Earlier extensions in the array win over later ones. */
  keymap?: (ctx: ExtensionContext) => Record<string, Command>;
  /** Markdown-style input rules, e.g. `# ` becoming a heading. */
  inputRules?: (ctx: ExtensionContext) => InputRule[];
  /** Arbitrary ProseMirror plugins (decorations, paste handling, ...). */
  plugins?: (ctx: ExtensionContext) => Plugin[];
  /** What this extension can do, for every surface that shows it — a `/`
      menu's rows, a toolbar's buttons. Gathered by {@link extensionActions}. */
  actions?: (ctx: ExtensionContext) => EditorAction[];
}

export interface NodeExtension extends BaseExtension {
  type: 'node';
  /** Marks this node as the document root. Exactly one extension must set it. */
  topNode?: boolean;
  spec: NodeSpec;
}

export interface MarkExtension extends BaseExtension {
  type: 'mark';
  spec: MarkSpec;
}

/** Behaviour-only extension: history, base keymap, future `/`-command, ... */
export interface FunctionalExtension extends BaseExtension {
  type: 'extension';
}

export type Extension = NodeExtension | MarkExtension | FunctionalExtension;

export const defineNode = (extension: Omit<NodeExtension, 'type'>): NodeExtension => ({
  type: 'node',
  ...extension,
});

export const defineMark = (extension: Omit<MarkExtension, 'type'>): MarkExtension => ({
  type: 'mark',
  ...extension,
});

export const defineExtension = (
  extension: Omit<FunctionalExtension, 'type'>,
): FunctionalExtension => ({
  type: 'extension',
  ...extension,
});

/** Every action the editor's extensions declare, in kit order. */
export const extensionActions = (ctx: ExtensionContext): EditorAction[] =>
  ctx.extensions.flatMap((extension) => extension.actions?.(ctx) ?? []);

/** The extensions' actions as the rows of a `/` menu — the same list, seen as
    suggestions: `createSuggestionMenu({ trigger: '/', items: extensionSuggestions })`. */
export const extensionSuggestions = (ctx: ExtensionContext): SuggestionItem[] =>
  extensionActions(ctx);
