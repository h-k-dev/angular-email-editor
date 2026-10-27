import { API_EXAMPLES } from './api-reference.examples';

/** One export, as the reference renders it. Prose marks code with `backticks`. */
export interface ApiEntry {
  /** The heading's id, and the URL's #fragment. */
  readonly id: string;
  readonly name: string;
  /** The entry point it is imported from, when it is not the main one. */
  readonly from?: string;
  readonly signature: string;
  /** What it is for, in a sentence or two. */
  readonly summary: string;
  /** What to know before using it, a point each. */
  readonly details?: readonly string[];
  /** How a host uses it — TypeScript, ready to copy. */
  readonly example?: string;
}

/** A section: what a host is doing when it meets these exports. */
export interface ApiSection {
  readonly id: string;
  readonly title: string;
  readonly intro: string;
  readonly entries: readonly ApiEntry[];
}

/** A page of the reference: one aside link, a few sections. A page of one
    section is that section: its intro is the page's lede, no heading
    repeats the title. */
export interface ApiPage {
  /** The route segment — its `API_PAGES` id. */
  readonly id: string;
  readonly title: string;
  readonly lede: string;
  readonly sections: readonly ApiSection[];
}

const LIB = '@h-k-dev/angular-email-editor';

/**
 * The library's public surface, in the order a host meets it: mount an
 * editor, pick a kit, add menus, move documents in and out, hand a send
 * payload to a transport. Mirrors `public-api.ts` and the secondary entry
 * points; the styling side lives on its own page.
 */
export const API_SECTIONS: readonly ApiSection[] = [
  {
    id: 'editor',
    title: 'Editor',
    intro:
      'The core is framework-free ProseMirror. An extension set defines the schema, plugins, keymaps and named commands; `createEditor` mounts them.',
    entries: [
      {
        id: 'create-editor',
        name: 'createEditor',
        signature: '(options: EditorOptions) => Editor',
        summary:
          'Builds the schema from the extension set and mounts a ProseMirror view into `options.parent`.',
        details: ['Collects every extension’s plugins, keymaps, input rules and named commands.'],
      },
      {
        id: 'editor-options',
        name: 'EditorOptions',
        signature: '{ parent, extensions, content?, quoted?, parseMode?, attributes?, onUpdate? }',
        summary: 'What `createEditor` takes.',
        details: [
          '`parent` — the element the editable mounts into.',
          '`content` — the initial HTML.',
          '`quoted` — the quoted history a reply or forward answers, kept beside the body.',
          '`attributes` — DOM attributes for the editable.',
          '`onUpdate` — called after every transaction that changes the document.',
        ],
      },
      {
        id: 'editor-type',
        name: 'Editor',
        signature:
          '{ view, schema, state, commands, exec(), isActive(), getHTML(), setContent(), getQuoted(), setQuoted(), getText(), setText(), focus(), destroy() }',
        summary: 'The mounted editor.',
        details: [
          "`commands` are the extensions’ named commands bound to the live view: `editor.commands['toggleBold']()` (the index form, which compiles under `noPropertyAccessFromIndexSignature`).",
          '`setContent` / `setText` apply a minimal diff as an external sync: selection, scroll and plugin state survive, nothing enters the undo history, and `onUpdate` does not fire — two editors mirroring each other cannot echo. `{ history: true }` makes the write a step the user can undo (a Revert).',
          '`getHTML` returns the body alone. `getQuoted` / `setQuoted` read and replace the quoted history, which `setContent` never touches.',
        ],
      },
      {
        id: 'create-schema',
        name: 'createSchema',
        signature: '(extensions: Extension[]) => Schema',
        summary:
          'The schema an extension set defines, without mounting anything — what `parseHTML` and `serializeToHTML` work against.',
      },
      {
        id: 'is-active',
        name: 'isMarkActive · isNodeActive',
        signature:
          '(state, type: MarkType) => boolean · (state, type: NodeType, attrs?) => boolean',
        summary: 'Whether a mark or node applies at the selection.',
        details: [
          '`isMarkActive` reads the stored marks when the selection is empty.',
          '`isNodeActive` walks the whole ancestor chain, so a blockquote or list reports active even though the caret’s direct parent is a paragraph.',
        ],
      },
    ],
  },
  {
    id: 'kits',
    title: 'Kits & authoring',
    intro:
      'A kit is just an `Extension[]` — three ship, all on the same contract. Compose your own from the individual extensions when none fits.',
    entries: [
      {
        id: 'email-extensions',
        name: 'emailExtensions',
        signature: 'Extension[]',
        summary: 'The kit the composer runs: email-safe output.',
        details: [
          'Lines are `div`s, not `p`s — mail clients render paragraph margins as double spacing.',
          'Empty lines are `div > br`.',
          'Includes the reply quote fold.',
        ],
      },
      {
        id: 'rich-text-extensions',
        name: 'richTextExtensions',
        signature: 'Extension[]',
        summary:
          'Semantic HTML (`p` paragraphs) for content rendered inside an app rather than mailed.',
      },
      {
        id: 'html-source-extensions',
        name: 'htmlSourceExtensions',
        signature: 'Extension[]',
        summary:
          'The source editor beside the composer: the document is HTML text, one `codeLine` per line, with highlighting, linting and formatting.',
        details: [
          'Mark shortcuts round-trip through the email schema, so toggling bold works identically on both sides.',
        ],
      },
      {
        id: 'define-extension',
        name: 'defineNode · defineMark · defineExtension',
        signature: '(extension) => NodeExtension | MarkExtension | FunctionalExtension',
        summary: 'The three ways to author an extension.',
        details: [
          'An extension contributes any of: a schema spec, plugins, keymaps, input rules, named commands and slash items.',
        ],
      },
    ],
  },
  {
    id: 'menus',
    title: 'Menus & handles',
    intro:
      'Floating UI as state plus a render callback: the library owns positioning and keyboard behaviour, the host owns the markup.',
    entries: [
      {
        id: 'create-bubble-menu',
        name: 'createBubbleMenu · createBlockMenu',
        signature: '(options) => FunctionalExtension',
        summary: 'The selection’s formatting menu, and the block handle.',
        details: [
          '`scroll` — what the menu does when the editor scrolls under it: `"close"` (default — the reported box is stale once the editor moves), `"follow"` (re-reported once per frame), `"keep"`, or a function of the event.',
          'Scroll is heard in the capture phase, so no `cdkScrollable` is needed; only a scroll that moves the editor counts.',
          'Bubble menu `anchor` — `"first"` (default) keeps an open menu where it opened while the selection changes; `"selection"` reports the current selection’s box.',
        ],
      },
      {
        id: 'create-block-marquee',
        name: 'createBlockMarquee · BlockSelection',
        signature: '(options?: { surface?, canvas?, threshold? }) => FunctionalExtension',
        summary:
          'Notion’s marquee: drag from the empty room around the text to select whole blocks.',
        details: [
          'The drag starts on the `surface` (the editor’s parent by default) or the editor’s own room between and below blocks. A press on text stays a text selection; a press released in place puts the caret at the nearest spot.',
          'Every top-level block the box touches becomes a `BlockSelection`, copied, cut, deleted and pasted over as blocks.',
          'Selected blocks wear `aee-block--selected` for the host to paint.',
          'Keys: ArrowUp/Down walk, Shift-ArrowUp/Down grow or shrink, ArrowLeft/Right, Enter and Escape return to the caret, Backspace/Delete remove, a second Mod-a selects every block. Typing does nothing.',
        ],
      },
      {
        id: 'table-cell-grip',
        name: 'createTableHandles: cell grip · clearCells',
        signature: "onOpen({ kind: 'cell', index, row, tablePos, boundingBox }) · Command",
        summary:
          'A grip on the caret cell’s edge that hands the host the cell to open a menu for — colour, alignment, clear contents. The caret stays put.',
        details: ['`clearCells` empties the caret’s cell, or every selected one.'],
      },
      {
        id: 'table-band-drag',
        name: 'createTableHandles: band drag · moveTableBand',
        signature:
          "(tablePos, 'row' | 'column', from, to) => Command · BAND_MOVING_CLASS · BAND_DROP_CLASS",
        summary: 'Notion’s drag-to-move for table rows and columns.',
        details: [
          'While a grip is dragged, its band’s cells wear `BAND_MOVING_CLASS` and the table holds still.',
          'The band under the pointer shows the drop line (`BAND_DROP_CLASS`) on its far edge — none over its own band or across a merged cell.',
          'Release moves the band as one undo step. A press that stays put still selects the band; Escape cancels.',
        ],
      },
    ],
  },
  {
    id: 'suggestions',
    title: 'Suggestion menus',
    intro:
      'Every trigger-at-the-caret menu — the `/` command menu, the `{{` merge-tag picker, an `@` mention list — comes from one factory, fed by sources that share one grammar.',
    entries: [
      {
        id: 'create-suggestion-menu',
        name: 'createSuggestionMenu',
        signature: '(options: SuggestionMenuOptions) => FunctionalExtension',
        summary: 'A trigger, its items, and what picking one does.',
        details: [
          'Items are a list, or a paged source asked on every keystroke and aborted when stale. A synchronous answer lands with the keystroke.',
          'One menu takes several triggers (`triggers: [{ trigger: "/" }, { trigger: "{{" }]`). They never open together — the trigger nearest the caret wins — so they share one element and one state.',
          'Groups open a second level. A trigger’s `i18n`, `label` and `placeholder` may be functions, asked whenever the menu opens, so a language switch reaches the menu; items are searched in both languages.',
        ],
      },
      {
        id: 'merge-tag-trigger',
        name: 'mergeTagTrigger',
        signature: '(options?: { query?, allow?, …SuggestionTrigger }) => SuggestionTrigger',
        summary: 'The `{{` trigger with its edge cases handled.',
        details: [
          'Opens right after any character (`Hi{{`).',
          'Its query is a path unless the host widens it.',
          'Stays shut with the caret inside a token already written; the host’s `allow` is asked only outside one.',
        ],
      },
      {
        id: 'email-suggestion-menu',
        name: 'email-suggestion-menu',
        from: `${LIB}/suggestion-menu`,
        signature: '[email-suggestion-menu] + [email-suggestion-menu-item]',
        summary: 'Renders any suggestion menu’s state as an accessible listbox.',
        details: [
          'The editor points at its options with `aria-activedescendant`.',
          'Loads the next page as it scrolls, and says searching, loading more, no results or failed.',
          '`extensionSuggestions(ctx)` gathers the kit’s `/` commands; `insertMergeTag(path)` is what a `{{` item runs.',
        ],
      },
      {
        id: 'suggestion-sections',
        name: 'SuggestionItem.section · sections',
        signature: 'section?: string · sections?: Record<string, string> | (id) => string',
        summary: 'Headings inside a menu.',
        details: [
          'Rows declare a section: blocks, styling, media, layout, message — a host adds its own (ai, color, templates…).',
          'The trigger words the headings; the library’s `suggestionSectionTitles` fill in the rest.',
          'Each listed item carries the heading it opens (`item.heading`, null inside a section), so the template renders `[email-suggestion-menu-section]` without calling anything.',
        ],
      },
      {
        id: 'paged-source',
        name: 'pagedSource',
        signature:
          '({ from: { find(filter, signal) }, with: (query, { skip, limit }) => filter, map: (row) => SuggestionItem | null, pageSize? = 20, debounce? = 300, cache? }) => SuggestionSource',
        summary: 'A source for a backend that pages by offset — the paging written once.',
        details: [
          '`with` turns a query and a page into the transport’s filter, `from` fetches it (the signal aborts a stale request), `map` turns each row into a suggestion keyed by the row’s own id; `null` drops a row.',
          'A short page ends the list. Each id is listed once, so a row that moved between requests is not repeated.',
          '`debounce`: the first query after a pause goes at once; later pages never wait.',
          '`cache` (default `{ ttl: 60_000, max: 50 }`) remembers pages by query and cursor; `cache: false` asks every time. The cache lives as long as the source — one per injector behind a `providedIn: "root"` token.',
        ],
      },
      {
        id: 'list-source',
        name: 'listSource · matchSuggestions',
        signature: '({ from, with?, map, cache? }) => SuggestionSource · (items, query) => items',
        summary:
          'The same grammar for a list loaded in one request and searched the way the menu searches its own items.',
        details: [
          'Every word of the query must appear in a title or keyword, best first: exact title, title prefix, title contains, keyword only.',
          'Once loaded, every keystroke answers at once. `cache: false` reloads for each session of the menu.',
          '`matchSuggestions` is that search on its own.',
        ],
      },
      {
        id: 'debounced-source',
        name: 'debouncedSource · cachedSource',
        signature:
          '(source, wait? = 300) => SuggestionSource · (source, { ttl?, max? }?) => SuggestionSource',
        summary: '`pagedSource`’s two behaviours, for a source written by hand.',
        details: [
          '`debouncedSource` holds a query asked within `wait` of the previous one.',
          '`cachedSource` remembers answers by query and cursor — never failures, one request per key at a time, and a request every caller gave up on is aborted and forgotten.',
        ],
      },
    ],
  },
  {
    id: 'writing',
    title: 'Writing aids',
    intro:
      'Placeholders on empty lines, and content streamed in — a model’s answer — while the writer keeps typing.',
    entries: [
      {
        id: 'create-placeholder',
        name: 'createPlaceholder · setPlaceholder',
        signature:
          '({ text?: string | PlaceholderWords | (line) => string | null, show?: "caret" | "all" }) => FunctionalExtension · (text) => Command',
        summary: 'Words on an empty line, Notion’s way.',
        details: [
          'A plain line under the caret hints what can be done there while the editor has focus (`show: "caret"`, default) — or every empty line (`"all"`).',
          'An empty block says what it is wherever the caret is. `PlaceholderWords` has `line`, `empty`, `heading` (one string or one per level), `quote`, `bulletList`, `orderedList`, `tableCell`, `image`; a kind left out takes the line’s hint, `""` leaves it bare.',
          'A decoration only (`aee-placeholder`, `data-placeholder`; `aee-placeholder-doc` on an empty body): nothing reaches the document, the host’s stylesheet paints it.',
          '`setPlaceholder` swaps the words at once, outside the undo history — how a language switch arrives.',
          'Never on a code line, a read-only editor, or a line mid-IME composition.',
        ],
      },
      {
        id: 'create-content-stream',
        name: 'createContentStream · streamContent · isStreaming',
        signature:
          '(options?) => FunctionalExtension · (view, target, async ({ write, getWritableStream, signal }) => …, { format?, transform? }) => { stop, done }',
        summary: 'Streams content into the document and owns everything around it.',
        details: [
          '`target` is a position, or a range the first piece replaces. The insertion point keeps up while the writer types elsewhere.',
          '`reveal`: `"block"` (default) shows a paragraph or list item whole once it is in; `"character"` types a grapheme or a few per frame; `"instant"`.',
          'Freshly revealed content wears `aee-stream-fresh` for the host to fade in (`--email-stream-fade-in`). A caret widget (`span.aee-stream-caret`), `aria-busy`, Escape to stop, and the abort signal come with it.',
          '`format: "html"` re-reads the whole buffer through the schema on every write, so a list or bold word forms as it streams and a half-written tag never shows. `transform` rewrites the buffer first — strip a code fence, Markdown to HTML.',
        ],
      },
    ],
  },
  {
    id: 'behaviour',
    title: 'Built-in behaviour',
    intro:
      'Ready-made singleton extensions. Each is exported on its own, so a custom kit takes only what it needs.',
    entries: [
      {
        id: 'layout-guides',
        name: 'LayoutGuides · QuotedHistory · PasteHygiene · ClearFormatting',
        signature: 'Extension',
        summary: 'Guides, the quoted history, paste sanitizing and formatting removal.',
        details: [
          '`LayoutGuides` — table and column guides that peek on hover.',
          '`QuotedHistory` — the quoted history kept beside the body, folded behind ⋯, removed by its trash or moved into the body by Edit (both undoable). `createQuotedHistory({ labels })` for other languages.',
        ],
      },
      {
        id: 'interaction-layer',
        name: 'ColumnResize · ColumnsResize · History · BaseKeymap · ClickBelow · Gapcursor · NoTextDrag · SplitKeepingMarks',
        signature: 'Extension',
        summary: 'The interaction layer.',
        details: [
          'Table and column-block resizing, undo/redo, the base keymap.',
          '`ClickBelow` — a click under the last block starts a fresh line, taken back if left empty. `clickBelow(view, clientY)` for a gesture that takes the press itself.',
          '`Gapcursor` — a caret where no text can go. `NoTextDrag` suppresses text dragging. `SplitKeepingMarks` keeps marks across Enter.',
        ],
      },
    ],
  },
  {
    id: 'documents',
    title: 'Documents & HTML',
    intro:
      'HTML is the canonical format on both sides of the composer: what the editor serializes is what the source pane lints and what the host sends. Everything here is pure.',
    entries: [
      {
        id: 'parse-html',
        name: 'parseHTML · serializeToHTML',
        signature:
          "(html, schema, options?: { mode?: 'repair' | 'email' | 'preserve' }) => Node · (doc, schema) => string",
        summary: 'The document in and out of the schema — the round trip both panes share.',
      },
      {
        id: 'inline-styles',
        name: 'inlineStyles · dropHidden · unwrapLayoutTables · inheritTextStyles',
        signature: '(doc: Document, viewportWidth?) => void · (root) => void',
        summary:
          'What `parseHTML` runs on a whole document before the schema sees it — so an MJML export arrives as clean sections and columns.',
        details: [
          '`inlineStyles` folds the `<style>` sheet into the elements it matches: document order, `!important` over inline, media queries answered for a 600px screen.',
          '`dropHidden` removes `display: none` elements.',
          '`unwrapLayoutTables` takes out builders’ presentation tables — one cell, or a column of one-cell rows — carrying a cell’s `align` onto its content and reversing a right-to-left cell.',
          '`inheritTextStyles` writes what a wrapper declares (colour, size, face, alignment) onto the blocks beneath it, as CSS would inherit it.',
        ],
      },
      {
        id: 'section',
        name: 'Section · insertSection · setSectionBackground · setSectionImage · removeSection',
        signature:
          'node · (background?) => Command · (color | null) => Command · (url | null) => Command · () => Command',
        summary: 'A full-width band: a fill edge to edge, the content centred in the 600px column.',
        details: [
          'Emitted as one presentation table with `bgcolor` and inline `background-color` (Outlook reads the attribute, Gmail the style) and an inline `max-width` div — no stylesheet, no conditional comment.',
          'A background image (http(s) only) goes on the cell as the `background` attribute and inline `background-image`, with a VML `v:rect` in `[if mso]` comments for Outlook and the fill beneath when images are held back.',
          'Parses a builder’s section (MJML’s, `background-url` included) the same way.',
        ],
      },
      {
        id: 'sanitize-pasted-html',
        name: 'sanitizePastedHTML',
        signature: '(html: string) => string',
        summary:
          'Strips what a paste from a word processor or web page drags along, before it reaches the schema.',
      },
      {
        id: 'email-plain-text',
        name: 'emailPlainText',
        signature: '(html: string) => string',
        summary:
          'The `text/plain` projection of the HTML — the other half of a `multipart/alternative` body.',
      },
      {
        id: 'email-document',
        name: 'emailDocument',
        signature:
          '(html: string, options?: { lang?, dir?, title?, previewText?, darkMode?: DarkModePalette | false }) => string',
        summary: 'The full document a transport sends.',
        details: [
          'The Outlook DPI fix, iOS text-size and Apple reformatting guards, an `article` wrapper with `lang`/`dir`, and hidden inbox preview text.',
          'Everything inline, except two optional enhancements in a `<style>` of their own: the phone rule for stacked columns, and dark mode (`color-scheme: light dark` plus the palette’s dark variants via `markDarkMode`).',
        ],
      },
      {
        id: 'render-for-client',
        name: 'renderForClient · RENDERING_CLIENTS',
        signature:
          "(html, client: 'apple-mail' | 'gmail' | 'outlook-desktop', { dark?, pane?, darkMode? }) => string",
        summary:
          'The email as a given client would draw it — a whole document for a sandboxed frame.',
        details: [
          'Lays the client’s surface under the HTML (a fragment, or a pasted document with its head kept).',
          'Removes what the client ignores: Gmail’s dropped comments, form controls and unmatched style rules; Outlook’s opened conditional comments, lost media queries and ignored declarations; stacks inline-block columns.',
          'Dark mode on request: Apple Mail’s surface under the email’s own `prefers-color-scheme` rules; Gmail’s and classic Outlook’s inversion.',
        ],
      },
    ],
  },
  {
    id: 'source',
    title: 'Source pane',
    intro:
      'The HTML editor’s language service, and the pure functions underneath it — usable on their own for linting or formatting HTML anywhere.',
    entries: [
      {
        id: 'create-html-language',
        name: 'createHtmlLanguage · createHtmlAutocomplete · createSourceMarks',
        signature: '(options) => FunctionalExtension',
        summary:
          'Highlighting with lint diagnostics, tag and attribute completion, and mark shortcuts.',
        details: [
          'Paced for the fastest typist: a keystroke only moves the highlighting along.',
          'The whole text is rescanned — and `onDiagnostics` called — once typing rests (`rescanDelay`, default `TYPING_REST` = 200 ms), and at once for a mirrored write or a large edit.',
        ],
      },
      {
        id: 'lint-html',
        name: 'scanHTML · lintHTML',
        signature: '(source) => HtmlScan · (source, scan?, options?) => HtmlDiagnostic[]',
        summary: 'Tokenizes the source, then reports what will not survive a mail client.',
        details: [
          'Tags outside `EMAIL_SAFE_TAGS`, unsupported CSS, fonts below `MIN_FONT_SIZE`, unbroken runs past `MAX_UNBROKEN_RUN`.',
        ],
      },
      {
        id: 'html-diagnostic',
        name: 'HtmlDiagnostic',
        signature: '{ severity: "error" | "warning", message, from, to }',
        summary:
          'One lint finding, positioned in the source — what the status strip counts and jumps to.',
      },
      {
        id: 'format-html',
        name: 'formatHTML',
        signature: '(html, indent?, width = FORMAT_WIDTH) => string',
        summary: 'Pretty-prints the source without changing what it means.',
      },
      {
        id: 'completion-context-at',
        name: 'completionContextAt · openTags',
        signature: '(source, offset) => CompletionContext | null · (source, scan?) => string[]',
        summary:
          'What the caret sits in (tag, attribute name, attribute value) and which elements are still open there — the autocomplete’s input.',
      },
      {
        id: 'email-safe-tags',
        name: 'EMAIL_SAFE_TAGS · VOID_TAGS · EMAIL_SAFE_STYLE_PROPERTIES · EMAIL_TAG_ATTRIBUTES',
        signature: 'Set<string> · string[] · Record<string, string[]>',
        summary:
          'The vocabulary lint and completion both read: the tags, attributes and style properties that survive mail clients.',
      },
    ],
  },
  {
    id: 'reply-forward-import',
    title: 'Reply, forward & import',
    intro:
      'Seeds are documents, not transports. Parse the inbound message with whatever MIME parser you already trust (postal-mime, mailparser); `toInboundMessage` is the whole bridge.',
    entries: [
      {
        id: 'inbound-message',
        name: 'InboundMessage',
        signature: '{ html?, text?, from?, date?, subject?, to?, cc?, replyTo? }',
        summary:
          'The inbound message as document content only — for the attribution line and forwarded header. The envelope stays the host’s.',
      },
      {
        id: 'to-inbound-message',
        name: 'toInboundMessage',
        signature: '(parsed: ParsedEmailLike, options?: { addressRules? }) => InboundMessage',
        summary:
          'Bridges a parser’s result into the seeds. Duck-typed, so the library depends on no parser.',
        details: [
          'A group comes in as its members.',
          'Addresses are written by the address rule in force (`options.addressRules`, ours by default).',
        ],
      },
      {
        id: 'reply-quote',
        name: 'replyQuote · forwardQuote',
        signature: '(inbound, options?: ComposeSeedOptions) => string',
        summary: 'The quoted history alone, for `createEditor({ quoted })` or `setQuoted`.',
        details: [
          'Reply: attribution line and blockquote. Forward: header block and message.',
          'Kept beside the body, where no template, import or source edit replaces it.',
        ],
      },
      {
        id: 'with-quoted-history',
        name: 'withQuotedHistory',
        signature: '(html, quoted: string | null) => string',
        summary:
          'A body with its quoted history under it — the message as it goes out, for a preview. A whole document keeps its head.',
      },
      {
        id: 'reply-document',
        name: 'replyDocument · forwardDocument',
        signature: '(inbound, options?: ComposeSeedOptions) => string',
        summary:
          'The seed as one document, the history in the body as ordinary text — for a host without the kept history.',
        details: [
          'An empty composing area above the attribution line (reply) or forwarded header block (forward).',
          '`options.locale` formats a `Date`; a string date is used verbatim.',
          '`options.labels` words it in the host’s language: `attribution({ from, date })`, and `forwarded` / `from` / `date` / `subject` / `to` for the header. Anything left out stays English.',
        ],
      },
      {
        id: 'reply-envelope',
        name: 'replyEnvelope',
        signature:
          "(inbound, kind: 'reply' | 'reply-all' | 'forward', options?: ReplyEnvelopeOptions) => { to, cc, subject }",
        summary: 'Who an answer goes to and what it is called.',
        details: [
          'Reply-To over From; reply-all copies everyone but `options.self`, each address once.',
          'The subject takes `labels.re` / `labels.fwd` once, replacing same-family prefixes in any language (`AW: Re: x` → `Re: x`).',
          'Same options as `replyDocument`, plus `addressRules`.',
        ],
      },
      {
        id: 'imported-document',
        name: 'importedDocument · importLoss',
        signature: '(inbound) => string · (inbound) => ImportLoss',
        summary:
          'The message itself as the document — what a dropped `.eml` becomes — and what that import drops.',
        details: [
          '`importLoss` returns `{ removedElements, removedTags, inlineImages }`, computed from the same HTML. Show it to the user: silent loss is the failure mode.',
        ],
      },
    ],
  },
  {
    id: 'addresses',
    title: 'Addresses',
    intro:
      'One rule decides what an address is, how a mailbox is read and written, and how typed text splits. Ours follows RFC 5322, 5321, 6531 and 2047 — or put your backend’s rule in force, and every address piece follows it.',
    entries: [
      {
        id: 'address-rules',
        name: 'AddressRules',
        from: `${LIB}/address`,
        signature:
          '{ split(raw), parse(raw), format(mailbox), isValid(address), identity(address) }',
        summary: 'The contract.',
        details: [
          '`split` — typed, pasted or header text as mailboxes in header form.',
          '`parse` / `format` — a mailbox as `{ name?, address }` and back, quoted where needed.',
          '`isValid` — whether a bare address is well-formed. `identity` — what makes two addresses one recipient.',
        ],
      },
      {
        id: 'default-address-rules',
        name: 'defaultAddressRules',
        from: `${LIB}/address`,
        signature: 'AddressRules',
        summary: 'Ours (rules.ts, its deviations listed in the file).',
        details: [
          'Handles quoted strings and escapes, comments, groups, obsolete routes, RFC 2047 names, quoted local parts, IPv4/IPv6 literals, octet lengths and IDN.',
          'Stricter where a typo hides: a domain needs a dot.',
          'Lenient where people type: `,` `;` and line breaks separate; `Ada Lovelace ada@x.io` is one mailbox.',
        ],
      },
      {
        id: 'provide-address-rules',
        name: 'provideAddressRules',
        from: `${LIB}/address`,
        signature: '(rules: Partial<AddressRules>) => Provider',
        summary:
          'Puts a host’s rule in force through the `ADDRESS_RULES` token, whole or in part — the parts left out stay ours.',
        details: [
          'The address input, address chip and `addressList` read it; `replyEnvelope` and `toInboundMessage` take it as `addressRules`.',
        ],
      },
      {
        id: 'is-mailbox',
        name: 'isMailbox · addressKey',
        from: `${LIB}/address`,
        signature: '(raw: string, rules?: AddressRules) => boolean | string',
        summary:
          'Whether an entry is a well-formed mailbox, and its identity for keeping each recipient once.',
      },
      {
        id: 'join-addresses',
        name: 'joinAddresses',
        from: `${LIB}/address`,
        signature: '(list: readonly string[], rules?: AddressRules) => string',
        summary:
          'The list as one header value — `"Müller, Hans" <h@x.de>, b@c.de` — for a backend that keeps To/Cc/Bcc as text.',
        details: [
          'The rule’s `split` reads it back entry for entry. What is not a mailbox — a typo, a `{{placeholder}}` — goes in as it is.',
        ],
      },
      {
        id: 'parse-mailbox',
        name: 'parseMailbox · formatMailbox · splitAddresses · isEmailAddress · addressIdentity',
        from: `${LIB}/address`,
        signature: 'the parts of defaultAddressRules',
        summary: 'Our rule’s functions, for composing your own rule from some of ours.',
      },
      {
        id: 'address-list',
        name: 'addressList',
        from: `${LIB}/address-input`,
        signature: '(path, { min?, max?, rules?, messages? }) => void',
        summary: 'The signal-forms rule for an address field.',
        details: [
          'At least `min`, at most `max`, every entry a mailbox by the rule in force where the form is made — or by `options.rules`.',
        ],
      },
    ],
  },
  {
    id: 'merge-tags',
    title: 'Merge tags & expressions',
    intro:
      'Personalization is a mark on the document, so the fields a body needs are a query over nodes rather than a scan of text.',
    entries: [
      {
        id: 'merge-tag-fields',
        name: 'mergeTagFields · mergeTagExpressions',
        signature: '(doc: Node) => string[]',
        summary:
          'Every field the body reads, in first-use order — what `SendIntent.requiredFields` carries.',
      },
      {
        id: 'create-angular-expressions',
        name: 'createAngularExpressions',
        signature: '(options?: AngularExpressionsOptions) => FunctionalExtension',
        summary: 'Opts the document into the AngularJS-expression dialect.',
        details: [
          'Expressions parse, unknown syntax is diagnosed live, and `angularRequiredFields` reports what the body reads.',
        ],
      },
      {
        id: 'expression-dialect',
        name: 'ExpressionDialect · analyzeAngularExpression · angularRequiredFields',
        signature: 'interface · (expr) => ExpressionIssue[] · (expressions) => string[]',
        summary:
          'The template dialect contract — parse, diagnose, report fields. `angularDialect` is the one that ships.',
      },
      {
        id: 'create-merge-tag-resolution',
        name: 'createMergeTagResolution · mergeTagResolutionPending',
        signature:
          '({ resolve: (expressions) => Promise<(string | null)[]>, onResolved?, onError?, onPendingChange? }) => FunctionalExtension · (state) => boolean',
        summary: 'Fills placeholders with the host’s values, in one undo step.',
        details: [
          'Each distinct expression is asked once, raw — read off the document, never the HTML, so `&&` never arrives as `&amp;&amp;`.',
          'Values go back as text in the token’s place, keeping its formatting — in text and attributes alike (a link’s `href`, a button’s label, an image’s `src`).',
          'A string replaces a token, `""` removes it, `null` keeps it; `onResolved` reports filled, empty and kept.',
          'With a selection holding tokens, only those. Run by Mod-Shift-Enter, the `/` row, or the `resolveMergeTags` command; one request at a time.',
        ],
      },
    ],
  },
  {
    id: 'send',
    title: 'Send',
    intro:
      'Send is an intent, not a transport: it produces a payload the host wires to its own mailer. Nothing network-shaped lives in this library.',
    entries: [
      {
        id: 'create-send-intent',
        name: 'createSendIntent',
        signature: '(options: { onSend: (intent: SendIntent) => void }) => FunctionalExtension',
        summary:
          'Three ways in, one payload: the `/send` slash item, Mod-Enter, and the `requestSend` command for a toolbar button.',
      },
      {
        id: 'send-intent',
        name: 'SendIntent',
        signature: '{ html, text, inlineImages: InlineImage[], requiredFields: string[] }',
        summary: 'What the host sends.',
        details: [
          '`html` — every data-URL image already promoted to a `cid:` reference.',
          '`text` — its plain-text projection.',
          '`inlineImages` — the parts that HTML references.',
          '`requiredFields` — every merge-tag field the body reads, straight off the nodes.',
        ],
      },
    ],
  },
  {
    id: 'inline-images',
    title: 'Inline images',
    intro:
      'The editor holds data URLs; the payload holds `cid:` references. Provide one registry per composer component — never in root, two composers must not share parts.',
    entries: [
      {
        id: 'inline-images-service',
        name: 'InlineImages',
        signature: 'class InlineImages extends InlineImageStore',
        summary: 'The registry as an Angular service.',
        details: [
          '`add(blob, cid?)`, `blob(id)`, `dataUrl(cid)`, `previewHtml(html)`.',
          'A `version` signal bumps on every change. Every URL is revoked with the composer.',
        ],
      },
      {
        id: 'create-inline-images',
        name: 'createInlineImages',
        signature: '(options: { registry: InlineImageRegistry }) => FunctionalExtension',
        summary:
          'Wires the registry into the editor, so a `cid:` image repaints the moment its part arrives.',
      },
      {
        id: 'promote-inline-images',
        name: 'promoteInlineImages',
        signature: '(doc: Node, registry?) => PromotedInlineImages',
        summary:
          'A copy of the document with every data-URL image pointing at its `cid:`, plus the parts it references — each once, in document order.',
        details: ['Pure: the editor keeps showing its data URLs.'],
      },
      {
        id: 'rewrite-inline-image-sources',
        name: 'rewriteInlineImageSources',
        signature: '(html: string, resolve: (cid) => string | undefined) => string',
        summary:
          'For a preview: every known `cid:` becomes a data URL, since a sandboxed frame cannot load the editor’s blob URLs. Unknown cids are left alone.',
      },
      {
        id: 'decode-data-url',
        name: 'decodeDataUrl',
        signature: '(src: string) => Blob | null',
        summary:
          'A `data:` URL as a typed Blob — base64 or percent-encoded. `null` for anything malformed, so a bad source is never sent as garbage.',
      },
    ],
  },
  {
    id: 'email-safety',
    title: 'Email safety',
    intro:
      'What mail clients will do to the document, answered before it is sent. Pure functions over the HTML, or over one CSS declaration.',
    entries: [
      {
        id: 'email-size-budget',
        name: 'emailSizeBudget',
        signature: '(html: string) => SizeBudget',
        summary: 'UTF-8 size against Gmail’s clipping limit (`GMAIL_CLIP_BYTES`, 102 kB).',
        details: [
          'Returns `{ bytes, limit, level }`: warning from 80% of the budget, error above it.',
        ],
      },
      {
        id: 'find-css-issues',
        name: 'findCssIssues · CSS_SUPPORT',
        signature: '(property, value, tag) => CssSupportIssue[]',
        summary: 'Which clients drop or mangle a declaration, and what to use instead.',
      },
      {
        id: 'client-list',
        name: 'clientList · CLIENT_LABELS',
        signature: '(clients: EmailClient[]) => string',
        summary: 'Those clients as prose, for a message a person reads.',
      },
      {
        id: 'passes-dual-contrast',
        name: 'passesDualContrast · passesDualBackground · contrastRatio',
        signature: '(hex: string) => boolean · (a, b) => number',
        summary: 'Whether a colour survives both a light and a dark client — many invert.',
        details: ['Checked against `DUAL_CONTRAST_MIN_RATIO` and `DUAL_BACKGROUND_MIN_RATIO`.'],
      },
      {
        id: 'email-text-palette',
        name: 'emailTextPalette · emailBackgroundPalette',
        signature: 'PaletteColor[]',
        summary: 'The colours that pass on both sides — the swatches the composer’s pickers offer.',
        details: [
          'AA on white, on every pale fill, and inverted.',
          'Each with its dark variant (`PaletteColor.dark`), AA on `DARK_MODE_SURFACES` and every dark fill. Black, the body’s text, is AAA in both.',
        ],
      },
      {
        id: 'mark-dark-mode',
        name: 'markDarkMode · darkModeEditorCss · emailDarkModePalette',
        signature:
          '(html, palette?) => { html, css } · (scope: string, palette?) => string · DarkModePalette',
        summary: 'Dark mode written into the email.',
        details: [
          'A palette fill goes dark (`aee-db-<hex>`) when nothing in it wears a colour outside the palette and every background around it goes dark too.',
          'A palette text colour lights up (`aee-dt-<hex>`) under no background that stays light; a table’s grid line darkens likewise (`aee-dl-<hex>`).',
          '`css` holds the `prefers-color-scheme` and `[data-ogsc]` / `[data-ogsb]` rules for exactly those classes.',
          '`darkModeEditorCss` is the same rendering as a stylesheet over the live editor under `scope` — the editor’s dark paper.',
        ],
      },
      {
        id: 'email-palette',
        name: 'EMAIL_PALETTE · providePalette · injectPalette · colorSuggestions',
        from: `${LIB}/palette`,
        signature:
          'InjectionToken<EmailPalette> · (config: Partial<EmailPalette> | (defaults) => Partial<EmailPalette>) => Provider · () => EmailPalette · (ctx, palette) => SuggestionCommandItem[]',
        summary: 'The palette in use: the library’s, unless the app provides its own.',
        details: [
          '`providePalette` replaces either side, or takes a function of the defaults to mix.',
          'Feeds the pickers and the `/` menu’s colour rows (“Red text”, “Red background”, each with its swatch).',
        ],
      },
    ],
  },
  {
    id: 'measurement',
    title: 'Measurement',
    intro:
      'Length is arithmetic over cached glyph widths, so a live counter costs no layout. Its own entry point — the only part of the library that needs `@chenglou/pretext` (^1.0.0, an optional peer).',
    entries: [
      {
        id: 'create-text-metrics',
        name: 'createTextMetrics',
        from: `${LIB}/metrics`,
        signature: '({ onMetrics, onError? }: TextMetricsOptions) => FunctionalExtension',
        summary:
          'Streams live `TextMetrics`: words, characters, lines, estimated height — never touching the DOM.',
        details: [
          'Where nothing can measure (a server render, jsdom), `onError` hears why and the editor carries on.',
        ],
      },
      {
        id: 'measure-doc',
        name: 'readTypography · measureDoc · createBlockMeasureCache',
        from: `${LIB}/metrics`,
        signature:
          '(dom) => EditorTypography · (doc, contentWidth, typography, cache) => TextMetrics',
        summary:
          'Read the editable’s typography once, then measure the whole document at a content width.',
        details: ['Pure arithmetic, no DOM access, results cached per node.'],
      },
    ],
  },
  {
    id: 'integration',
    title: 'Integration directives',
    intro:
      'Behaviour only — no template, no styles, no UI kit — so they go onto a host’s own elements (a Material button, an Aria toolbar, a CDK overlay) or into its components through `hostDirectives`. Each is an entry point of its own.',
    entries: [
      {
        id: 'email-editor',
        name: 'emailEditor',
        from: `${LIB}/editor`,
        signature:
          '[emailEditor]="kit" [(value)] · [emailEditorCodec] [emailEditorOptions] [emailEditorPaused] · exportAs emailEditor',
        summary:
          'Mounts an editor on the host’s own element and binds its value — the part of every composer that is the same everywhere and easy to get subtly wrong.',
        details: [
          'Import the directive as `EmailEditor`. The kit is an array, or a function called as the editor mounts (it may read the host’s view queries); another kit is another editor, a render later, and the old one takes nothing in meanwhile.',
          'A `FormValueControl<string>` (or `[(value)]`): every change goes out; a value from outside goes in as typing settles, never into an editor being typed in — it waits for the user to leave the text. `disabled` and `readonly` make it read-only; leaving it is `touch`.',
          '`baseline()` is the canonical form it published as it mounted, so “unsaved” is `value() !== baseline()`. `replace(value)` writes even into a focused editor, as one undo step (`{ history: false }` for none).',
          'A codec says how value and editor meet: HTML by default (`HTML_CODEC`, canonical out); a source pane reads and writes text (`canonical: false` — what it is shown stands as given).',
          'It provides itself as `EMAIL_EDITOR` (`injectEditor()` from inside it). A component wearing it through `hostDirectives` sets it up with `configure({ kit, codec, options })`.',
        ],
      },
      {
        id: 'editor-model',
        name: 'editorModel · atRest',
        from: `${LIB}/actions`,
        signature:
          '(editor, { read, write, initial, equal? }) => WritableSignal<T> · sectionPaddingModel · sectionBackgroundModel · columnSpacingModel · pageLayoutModel · atRest(source, { rest?, passes? })',
        summary:
          'Something the document says — a band’s padding, the page layout — as a writable signal: reading follows the editor, writing runs the command as one undo step.',
        details: [
          'The signal never holds what the document does not: a write snaps to the grid, clamps to the range, or does nothing where the command refuses — and the signal says what was taken. A write of what the document already says runs nothing.',
          'A model signal forms can stand on: `form(model, p => debounce(p, \'blur\'))` writes once a field is done with — one undo step, no snapping mid-number.',
          'The typed models cover the caret’s band (padding, fill), its layout column (padding and gap) and the page layout as flat settings (`kind: \'none\' | \'centered\' | \'table\'`).',
          '`atRest` is a value as typing settles: a single write passes at once, a burst lands when it stops — for views too costly to redraw on every key.',
        ],
      },
      {
        id: 'email-field-keys',
        name: 'emailFieldKeys',
        from: `${LIB}/keyboard`,
        signature: '[emailFieldKeys] (emailFieldKeysCommitted) (emailFieldKeysDismissed)',
        summary:
          'The keys of a field inside something with keys of its own — a number field in a menu, a panel, a toolbar.',
        details: [
          'Import the directive as `FieldKeys`. Typed keys stay in the field — a digit is never the menu’s typeahead — except shortcuts with Ctrl or ⌘.',
          'Enter commits (`emailFieldKeysCommitted`, a menu closes on it); Escape puts the field back as its model says (`emailFieldKeysDismissed`).',
          'With `[formField]` on the same element it is the field’s other half: a field debounced to its blur commits on Enter and on `change` (an arrow’s step) too, and shows what its model took — even a snap back onto the value already there.',
        ],
      },
      {
        id: 'email-keep-focus',
        name: 'emailKeepFocus',
        from: `${LIB}/focus`,
        signature: '[emailKeepFocus] · [emailKeepFocusExcept]="selector"',
        summary: 'A press on the element never takes focus from where it is.',
        details: [
          'Import the directive as `KeepFocus`. `[emailKeepFocusExcept]` names what may still take focus (`""` for nothing); `[emailKeepFocus]="false"` turns it off.',
          'The editor keeps its caret and selection through a click on a tool, and menus that depend on its focus stay open.',
          'One on a container covers everything in it; text entry inside is the default exception. The keyboard still reaches every tool.',
        ],
      },
      {
        id: 'inject-actions',
        name: 'injectActions · editorState · emailAction',
        from: `${LIB}/actions`,
        signature:
          '(editor: () => Editor | undefined) => EditorActions · => Signal<EditorState> · emailAction="id" [emailActionFrom]="actions"',
        summary:
          'The extensions’ actions bound to a live editor as signals — pressed, disabled, run.',
        details: [
          'Actions are what extensions declare (`editor.actions`: id, title, icon, command, `isActive`, `isEnabled`). The editor is read reactively, so a code view is one `computed`.',
          '`emailAction` (import `ActionTrigger`, exported as `emailAction`) makes a host’s own control the trigger for the action of that id: `aria-pressed` and `aria-disabled` (never native `disabled` or a style), and the caret returns to the editor after running. `[emailActionAria]="false"` and `[emailActionFocus]="false"` turn either off.',
          'A host’s own buttons join as `HostAction` — a run, never a command: `host` for what stands alone (a link dialog), `override` to replace a kit action’s run (a table size picker).',
        ],
      },
      {
        id: 'email-anchor',
        name: 'emailAnchor',
        from: `${LIB}/anchor`,
        signature: '[emailAnchor]="rect | null" · exportAs emailAnchor',
        summary:
          'A real element kept over a box the editor reports — a selection, a caret, a block.',
        details: [
          'For anything that floats from an element: `cdkOverlayOrigin`, `matMenuTriggerFor`, an Aria menu trigger, CSS anchor positioning, Floating UI.',
          'Holds its last place while the box is `null`, so what it carries closes in place.',
          'Import the directive as `Anchor`; `anchor.element` is the element, for an API that wants one. It takes no pointer events, so a `matMenuTriggerFor` on it opens from code (`trigger.openMenu()`).',
        ],
      },
    ],
  },
];

/** A section by id, each export with its example (`API_EXAMPLES`). */
const section = (id: string): ApiSection => {
  const found = API_SECTIONS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No API section ${id}`);
  return {
    ...found,
    entries: found.entries.map((entry) => ({ ...entry, example: API_EXAMPLES[entry.id] })),
  };
};

/** The pages, in the aside's order (`API_PAGES`). */
export const API_PAGE_CONTENT: readonly ApiPage[] = [
  {
    id: 'editor',
    title: 'Editor',
    lede: 'Mount an editor, choose a kit, and the behaviour that comes with it.',
    sections: [section('editor'), section('kits'), section('behaviour')],
  },
  {
    id: 'menus',
    title: 'Menus & suggestions',
    lede: 'Floating menus and handles, the menus that open at the caret, and the writing aids around them.',
    sections: [section('menus'), section('suggestions'), section('writing')],
  },
  {
    id: 'documents',
    title: 'Documents & source',
    lede: 'HTML in and out of the editor, the source pane’s tooling, and the seeds for a reply, a forward or an import.',
    sections: [section('documents'), section('source'), section('reply-forward-import')],
  },
  {
    id: 'addresses',
    title: 'Addresses',
    lede: section('addresses').intro,
    sections: [section('addresses')],
  },
  {
    id: 'sending',
    title: 'Merge tags & sending',
    lede: 'Personalization, the payload a send produces, and the inline images it carries.',
    sections: [section('merge-tags'), section('send'), section('inline-images')],
  },
  {
    id: 'safety',
    title: 'Email safety',
    lede: 'What mail clients will do to the document, and how long it is — answered before it is sent.',
    sections: [section('email-safety'), section('measurement')],
  },
  {
    id: 'integration',
    title: 'Integration directives',
    lede: section('integration').intro,
    sections: [section('integration')],
  },
];
