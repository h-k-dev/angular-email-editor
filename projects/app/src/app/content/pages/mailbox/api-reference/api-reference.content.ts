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
  /** What to know, a few words each — `//` comments under the signature.
      An export with an example says it in the example's comments instead. */
  readonly notes?: readonly string[];
  /** How a host uses it — TypeScript, ready to copy. */
  readonly example?: string;
  /** What the step shows: the example, else the import and the signature
      (`stepCode`). Filled in by `section`. */
  readonly code?: string;
}

/** A section: what a host is doing when it meets these exports. */
export interface ApiSection {
  readonly id: string;
  readonly title: string;
  readonly intro: string;
  readonly entries: readonly ApiEntry[];
}

/** A page of the reference: one aside link, a few sections. No lede of
    its own: the trail names the page and its first section opens it. */
export interface ApiPage {
  /** The route segment — its `API_PAGES` id. */
  readonly id: string;
  readonly title: string;
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
      },
      {
        id: 'editor-options',
        name: 'EditorOptions',
        signature: '{ parent, extensions, content?, quoted?, parseMode?, attributes?, onUpdate? }',
        summary: 'What `createEditor` takes.',
        notes: [
          'parent: where the editable mounts',
          'quoted: the reply / forward history, kept beside the body',
          'onUpdate: after every change to the document',
        ],
      },
      {
        id: 'editor-type',
        name: 'Editor',
        signature:
          '{ view, schema, state, commands, exec(), isActive(), getHTML(), setContent(), getQuoted(), setQuoted(), getText(), setText(), focus(), destroy() }',
        summary: 'The mounted editor.',
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
        notes: [
          'isMarkActive reads the stored marks on an empty selection',
          'isNodeActive walks every ancestor: a list is active in its paragraph',
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
        notes: ['lines are divs (p margins double in mail), empty ones div > br'],
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
        notes: ['mark shortcuts round-trip through the email schema'],
      },
      {
        id: 'define-extension',
        name: 'defineNode · defineMark · defineExtension',
        signature: '(extension) => NodeExtension | MarkExtension | FunctionalExtension',
        summary: 'The three ways to author an extension.',
        notes: ['any of: a schema spec, plugins, keymaps, input rules, commands, slash items'],
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
      },
      {
        id: 'create-block-marquee',
        name: 'createBlockMarquee · BlockSelection',
        signature: '(options?: { surface?, canvas?, threshold? }) => FunctionalExtension',
        summary:
          'Notion’s marquee: drag from the empty room around the text to select whole blocks.',
      },
      {
        id: 'table-cell-grip',
        name: 'createTableHandles: cell grip · clearCells',
        signature: "onOpen({ kind: 'cell', index, row, tablePos, boundingBox }) · Command",
        summary:
          'A grip on the caret cell’s edge that hands the host the cell to open a menu for — colour, alignment, clear contents. The caret stays put.',
        notes: ['clearCells empties the caret cell, or every selected one'],
      },
      {
        id: 'table-band-drag',
        name: 'createTableHandles: band drag · moveTableBand',
        signature:
          "(tablePos, 'row' | 'column', from, to) => Command · BAND_MOVING_CLASS · BAND_DROP_CLASS",
        summary: 'Notion’s drag-to-move for table rows and columns.',
        notes: [
          'dragged: the band wears BAND_MOVING_CLASS, the drop edge BAND_DROP_CLASS',
          'release = one undo step; Escape cancels',
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
      },
      {
        id: 'merge-tag-trigger',
        name: 'mergeTagTrigger',
        signature: '(options?: { query?, allow?, …SuggestionTrigger }) => SuggestionTrigger',
        summary: 'The `{{` trigger with its edge cases handled.',
      },
      {
        id: 'email-suggestion-menu',
        name: 'email-suggestion-menu',
        from: `${LIB}/suggestion-menu`,
        signature: '[email-suggestion-menu] + [email-suggestion-menu-item]',
        summary: 'Renders any suggestion menu’s state as an accessible listbox.',
        notes: [
          'the editor points at the options with aria-activedescendant',
          'pages in on scroll; says searching, loading, no results, failed',
        ],
      },
      {
        id: 'suggestion-sections',
        name: 'SuggestionItem.section · sections',
        signature: 'section?: string · sections?: Record<string, string> | (id) => string',
        summary: 'Headings inside a menu.',
        notes: [
          'blocks, styling, media, layout, message — or a host’s own',
          'each item carries the heading it opens: item.heading',
        ],
      },
      {
        id: 'paged-source',
        name: 'pagedSource',
        signature:
          '({ from: { find(filter, signal) }, with: (query, { skip, limit }) => filter, map: (row) => SuggestionItem | null, pageSize? = 20, debounce? = 300, cache? }) => SuggestionSource',
        summary: 'A source for a backend that pages by offset — the paging written once.',
      },
      {
        id: 'list-source',
        name: 'listSource · matchSuggestions',
        signature: '({ from, with?, map, cache? }) => SuggestionSource · (items, query) => items',
        summary:
          'The same grammar for a list loaded in one request and searched the way the menu searches its own items.',
      },
      {
        id: 'debounced-source',
        name: 'debouncedSource · cachedSource',
        signature:
          '(source, wait? = 300) => SuggestionSource · (source, { ttl?, max? }?) => SuggestionSource',
        summary: '`pagedSource`’s two behaviours, for a source written by hand.',
        notes: [
          'debouncedSource holds a query asked within wait of the last',
          'cachedSource: by query and cursor, never failures, one request per key',
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
      },
      {
        id: 'create-content-stream',
        name: 'createContentStream · streamContent · isStreaming',
        signature:
          '(options?) => FunctionalExtension · (view, target, async ({ write, getWritableStream, signal }) => …, { format?, transform? }) => { stop, done }',
        summary: 'Streams content into the document and owns everything around it.',
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
        notes: [
          'LayoutGuides: table and column guides that peek on hover',
          'QuotedHistory: the kept history; createQuotedHistory({ labels }) to translate',
        ],
      },
      {
        id: 'interaction-layer',
        name: 'ColumnResize · ColumnsResize · History · BaseKeymap · ClickBelow · Gapcursor · NoTextDrag · SplitKeepingMarks',
        signature: 'Extension',
        summary: 'The interaction layer.',
        notes: [
          'ClickBelow: a click under the last block starts a line, dropped if left empty',
          'Gapcursor: a caret where no text can go; SplitKeepingMarks: marks survive Enter',
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
        notes: [
          'inlineStyles: the <style> sheet folded in, media queries answered at 600px',
          'dropHidden: display:none removed',
          'unwrapLayoutTables: builders’ one-cell tables taken out',
          'inheritTextStyles: a wrapper’s colour, size, face, alignment onto its blocks',
        ],
      },
      {
        id: 'section',
        name: 'Section · insertSection · setSectionBackground · setSectionImage · removeSection',
        signature:
          'node · (background?) => Command · (color | null) => Command · (url | null) => Command · () => Command',
        summary: 'A full-width band: a fill edge to edge, the content centred in the 600px column.',
        notes: [
          'one presentation table: bgcolor for Outlook, background-color for Gmail',
          'a background image: http(s) only, with VML for Outlook',
          'a builder’s section (MJML) reads the same way',
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
        signature: '(html: string, options?: { lang?, dir?, title?, previewText? }) => string',
        summary: 'The full document a transport sends.',
      },
      {
        id: 'render-for-client',
        name: 'renderForClient · RENDERING_CLIENTS',
        signature:
          "(html, client: 'apple-mail' | 'gmail' | 'outlook-desktop', { dark?, pane? }) => string",
        summary:
          'The email as a given client would draw it — a whole document for a sandboxed frame.',
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
        notes: [
          'a keystroke only moves the highlighting along',
          'rescan + onDiagnostics once typing rests (rescanDelay, 200 ms)',
        ],
      },
      {
        id: 'lint-html',
        name: 'scanHTML · lintHTML',
        signature: '(source) => HtmlScan · (source, scan?, options?) => HtmlDiagnostic[]',
        summary: 'Tokenizes the source, then reports what will not survive a mail client.',
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
      },
      {
        id: 'reply-quote',
        name: 'replyQuote · forwardQuote',
        signature: '(inbound, options?: ComposeSeedOptions) => string',
        summary: 'The quoted history alone, for `createEditor({ quoted })` or `setQuoted`.',
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
        notes: [
          'options.locale formats a Date; a string date stays as written',
          'options.labels: attribution, forwarded, from, date, subject, to — else English',
        ],
      },
      {
        id: 'reply-envelope',
        name: 'replyEnvelope',
        signature:
          "(inbound, kind: 'reply' | 'reply-all' | 'forward', options?: ReplyEnvelopeOptions) => { to, cc, subject }",
        summary: 'Who an answer goes to and what it is called.',
      },
      {
        id: 'imported-document',
        name: 'importedDocument · importLoss',
        signature: '(inbound) => string · (inbound) => ImportLoss',
        summary:
          'The message itself as the document — what a dropped `.eml` becomes — and what that import drops.',
        notes: ['importLoss: { removedElements, removedTags, inlineImages } — show it to the user'],
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
        notes: [
          'split: typed or pasted text → mailboxes in header form',
          'parse / format: { name?, address } and back, quoted where needed',
          'identity: what makes two addresses one recipient',
        ],
      },
      {
        id: 'default-address-rules',
        name: 'defaultAddressRules',
        from: `${LIB}/address`,
        signature: 'AddressRules',
        summary: 'Ours (rules.ts, its deviations listed in the file).',
        notes: [
          'quoting, comments, groups, RFC 2047 names, IP literals, IDN',
          'strict where a typo hides: a domain needs a dot',
          'lenient where people type: , ; and newlines split; "Ada ada@x.io" is one',
        ],
      },
      {
        id: 'provide-address-rules',
        name: 'provideAddressRules',
        from: `${LIB}/address`,
        signature: '(rules: Partial<AddressRules>) => Provider',
        summary:
          'Puts a host’s rule in force through the `ADDRESS_RULES` token, whole or in part — the parts left out stay ours.',
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
        notes: ['split reads it back; a typo or {{placeholder}} goes in as it is'],
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
        notes: ['unknown syntax diagnosed live; angularRequiredFields reports what is read'],
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
        notes: [
          'html: every data-URL image already a cid: reference',
          'requiredFields: the merge-tag fields, read off the nodes',
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
        notes: ['pure: the editor keeps showing its data URLs'],
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
        notes: ['against DUAL_CONTRAST_MIN_RATIO / DUAL_BACKGROUND_MIN_RATIO'],
      },
      {
        id: 'email-text-palette',
        name: 'emailTextPalette · emailBackgroundPalette',
        signature: 'PaletteColor[]',
        summary: 'The colours that pass on both sides — the swatches the composer’s pickers offer.',
        notes: ['AA on white, on every pale fill, and inverted; dark is Dawn’s'],
      },
      {
        id: 'dawn',
        name: 'renderDawn · createDarkRendering · dawnDarkColor',
        signature:
          '(html, { scheme, pane? }) => string · ({ scope? }) => Extension · (token: string) => string',
        summary: 'Dawn, the render engine: everything seen in dark is drawn by it.',
        notes: [
          'renderDawn: a message for a frame — the reading pane, a thumbnail',
          'createDarkRendering: the live editor, dark while its root matches scope',
          'dawnDarkColor: one light colour as drawn dark — a swatch on dark paper',
        ],
      },
      {
        id: 'email-palette',
        name: 'EMAIL_PALETTE · providePalette · injectPalette · colorSuggestions',
        from: `${LIB}/palette`,
        signature:
          'InjectionToken<EmailPalette> · (config: Partial<EmailPalette> | (defaults) => Partial<EmailPalette>) => Provider · () => EmailPalette · (ctx, palette) => SuggestionCommandItem[]',
        summary: 'The palette in use: the library’s, unless the app provides its own.',
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
      },
      {
        id: 'measure-doc',
        name: 'readTypography · measureDoc · createBlockMeasureCache',
        from: `${LIB}/metrics`,
        signature:
          '(dom) => EditorTypography · (doc, contentWidth, typography, cache) => TextMetrics',
        summary:
          'Read the editable’s typography once, then measure the whole document at a content width.',
        notes: ['pure arithmetic, no DOM, cached per node'],
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
      },
      {
        id: 'editor-model',
        name: 'editorModel · atRest',
        from: `${LIB}/actions`,
        signature:
          '(editor, { read, write, initial, equal? }) => WritableSignal<T> · sectionPaddingModel · sectionBackgroundModel · columnSpacingModel · pageLayoutModel · atRest(source, { rest?, passes? })',
        summary:
          'Something the document says — a band’s padding, the page layout — as a writable signal: reading follows the editor, writing runs the command as one undo step.',
      },
      {
        id: 'email-field-keys',
        name: 'emailFieldKeys',
        from: `${LIB}/keyboard`,
        signature: '[emailFieldKeys] (emailFieldKeysCommitted) (emailFieldKeysDismissed)',
        summary:
          'The keys of a field inside something with keys of its own — a number field in a menu, a panel, a toolbar.',
      },
      {
        id: 'email-keep-focus',
        name: 'emailKeepFocus',
        from: `${LIB}/focus`,
        signature: '[emailKeepFocus] · [emailKeepFocusExcept]="selector"',
        summary: 'A press on the element never takes focus from where it is.',
      },
      {
        id: 'inject-actions',
        name: 'injectActions · editorState · emailAction',
        from: `${LIB}/actions`,
        signature:
          '(editor: () => Editor | undefined) => EditorActions · => Signal<EditorState> · emailAction="id" [emailActionFrom]="actions"',
        summary:
          'The extensions’ actions bound to a live editor as signals — pressed, disabled, run.',
      },
      {
        id: 'email-anchor',
        name: 'emailAnchor',
        from: `${LIB}/anchor`,
        signature: '[emailAnchor]="rect | null" · exportAs emailAnchor',
        summary:
          'A real element kept over a box the editor reports — a selection, a caret, a block.',
      },
    ],
  },
];

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * An export with no example still shows code: where it is imported from,
 * then its signature — each name beside its own when the `·`-joined lists
 * pair up — and its notes as comments. A name that is no identifier (an
 * element) has no import line; its entry point leads as a comment.
 */
export function stepCode(entry: ApiEntry): string {
  const names = entry.name.split(' · ');
  const signatures = entry.signature.split(' · ');
  const identifiers = names.every((name) => IDENTIFIER.test(name));
  const lines: string[] = [];
  if (identifiers) {
    lines.push(`import { ${names.join(', ')} } from '${entry.from ?? LIB}';`, '');
  } else if (entry.from) {
    lines.push(`// ${entry.from}`, '');
  }
  if (identifiers && names.length === signatures.length) {
    names.forEach((name, index) => lines.push(`${name}: ${signatures[index]}`));
  } else {
    lines.push(entry.signature);
  }
  if (entry.notes) lines.push('', ...entry.notes.map((note) => `// ${note}`));
  return lines.join('\n');
}

/** A section by id, each export with its example (`API_EXAMPLES`) and the
    code its step shows. */
const section = (id: string): ApiSection => {
  const found = API_SECTIONS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No API section ${id}`);
  return {
    ...found,
    entries: found.entries.map((entry) => {
      const example = API_EXAMPLES[entry.id];
      return { ...entry, example, code: example ?? stepCode(entry) };
    }),
  };
};

/** The pages, in the aside's order (`API_PAGES`). */
export const API_PAGE_CONTENT: readonly ApiPage[] = [
  {
    id: 'editor',
    title: 'Editor',
    sections: [section('editor'), section('kits'), section('behaviour')],
  },
  {
    id: 'menus',
    title: 'Menus & suggestions',
    sections: [section('menus'), section('suggestions'), section('writing')],
  },
  {
    id: 'documents',
    title: 'Documents & source',
    sections: [section('documents'), section('source'), section('reply-forward-import')],
  },
  {
    id: 'addresses',
    title: 'Addresses',
    sections: [section('addresses')],
  },
  {
    id: 'sending',
    title: 'Merge tags & sending',
    sections: [section('merge-tags'), section('send'), section('inline-images')],
  },
  {
    id: 'safety',
    title: 'Email safety',
    sections: [section('email-safety'), section('measurement')],
  },
  {
    id: 'integration',
    title: 'Integration directives',
    sections: [section('integration')],
  },
];
