import { MarkSpec, NodeSpec, Schema } from 'prosemirror-model';
import { Command, Plugin } from 'prosemirror-state';
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
  children?: never;
}

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
  /** Commands this extension offers a suggestion menu — what a `/` menu
      lists, gathered by {@link extensionSuggestions}. */
  suggestions?: (ctx: ExtensionContext) => SuggestionItem[];
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

/** Every suggestion the editor's extensions offer, in kit order — the usual
    items of a `/` menu: `createSuggestionMenu({ trigger: '/', items: extensionSuggestions })`. */
export const extensionSuggestions = (ctx: ExtensionContext): SuggestionItem[] =>
  ctx.extensions.flatMap((extension) => extension.suggestions?.(ctx) ?? []);
