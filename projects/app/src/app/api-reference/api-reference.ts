import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** One export, as the reference table renders it. */
interface ApiEntry {
  name: string;
  signature: string;
  does: string;
}

/** A card: a heading, a sentence of framing, and the exports it covers. */
interface ApiGroup {
  title: string;
  hint: string;
  entries: ApiEntry[];
}

/**
 * The API reference page: the library’s public surface, grouped the way a
 * host meets it — mount an editor, pick a kit, move documents in and out,
 * hand a send payload to a transport. Mirrors `public-api.ts`; the styling
 * side lives on its own page.
 */
@Component({
  selector: 'app-api-reference',
  imports: [RouterLink],
  templateUrl: './api-reference.html',
  styleUrl: './api-reference.scss',
})
export class ApiReference {
  readonly groups: ApiGroup[] = [
    {
      title: 'Editor',
      hint:
        'The core is framework-free: an extension set defines the schema, the plugins, the ' +
        'keymaps and the named commands, and createEditor mounts them. Angular appears only in ' +
        'the panes this example app builds around it.',
      entries: [
        {
          name: 'createEditor',
          signature: '(options: EditorOptions) => Editor',
          does: 'Builds the schema from the extension set and mounts a ProseMirror view into options.parent, collecting every extension’s plugins, keymaps, input rules and named commands.',
        },
        {
          name: 'EditorOptions',
          signature: '{ parent, extensions, content?, attributes?, onUpdate? }',
          does: 'parent is the element the editable mounts into, content the initial HTML, attributes the DOM attributes for the editable, onUpdate a callback after every document-changing transaction.',
        },
        {
          name: 'Editor',
          signature:
            '{ view, schema, state, commands, exec(), isActive(), getHTML(), setContent(), getText(), setText(), focus(), destroy() }',
          does: 'commands are the extensions’ named commands bound to the live view (editor.commands.toggleBold()). setContent/setText apply a minimal diff as an external sync — selection, scroll and plugin state survive, nothing enters the undo history and onUpdate does not fire, so two editors mirroring each other cannot echo.',
        },
        {
          name: 'createSchema',
          signature: '(extensions: Extension[]) => Schema',
          does: 'The schema an extension set defines, without mounting anything — what parseHTML and serializeToHTML work against.',
        },
        {
          name: 'isMarkActive',
          signature: '(state: EditorState, type: MarkType) => boolean',
          does: 'Whether the mark applies at the selection (stored marks when it is empty).',
        },
        {
          name: 'isNodeActive',
          signature: '(state: EditorState, type: NodeType, attrs?) => boolean',
          does: 'Walks the selection’s whole ancestor chain, so wrappers (blockquote, lists) report active even though the cursor’s direct parent is a paragraph.',
        },
      ],
    },
    {
      title: 'Kits',
      hint:
        'A kit is just an Extension[]. Three ship: the email kit the composer runs, the rich-text ' +
        'kit for content rendered in the app, and the source kit the HTML pane runs — the same ' +
        'extension contract, a different set.',
      entries: [
        {
          name: 'emailExtensions',
          signature: 'Extension[]',
          does: 'Email-safe output: div lines instead of p (mail clients render paragraph margins as double spacing), empty lines as div > br, plus the reply quote fold.',
        },
        {
          name: 'richTextExtensions',
          signature: 'Extension[]',
          does: 'Semantic HTML output (p paragraphs) for content rendered inside the app rather than mailed.',
        },
        {
          name: 'htmlSourceExtensions',
          signature: 'Extension[]',
          does: 'The parallel source editor: the document is HTML source text, one codeLine per line, with highlighting, linting and formatting instead of rich-text nodes. Mark shortcuts round-trip through the email schema, so toggling is identical on both sides by construction.',
        },
        {
          name: 'defineNode / defineMark / defineExtension',
          signature: '(extension) => NodeExtension | MarkExtension | FunctionalExtension',
          does: 'The three ways to author one. An extension contributes any of: a schema spec, plugins, keymaps, input rules, named commands and slash items.',
        },
      ],
    },
    {
      title: 'Extensions',
      hint:
        'Factories take the host’s callbacks (a menu needs somewhere to render); the rest are ' +
        'ready-made singletons. Everything below is exported individually, so a host can compose ' +
        'its own kit instead of taking one whole.',
      entries: [
        {
          name: 'createBubbleMenu / createBlockMenu / createSlashMenu',
          signature: '(options) => FunctionalExtension',
          does: 'The three menus, as state plus a render callback: selection formatting, the block handle, and the slash inserter. The library owns positioning and keyboard behaviour; the host owns the markup.',
        },
        {
          name: 'createMergeTagMenu',
          signature: '(options: MergeTagMenuOptions) => FunctionalExtension',
          does: 'The personalization picker: the host resolves a MergeTagRequest to a MergeTagPage, so the field list can come from anywhere — and page.',
        },
        {
          name: 'createAngularExpressions',
          signature: '(options?: AngularExpressionsOptions) => FunctionalExtension',
          does: 'Opts the document into the AngularJS-expression dialect: expressions parse, unknown syntax is diagnosed live, and angularRequiredFields reports what the body reads.',
        },
        {
          name: 'createTextMetrics',
          signature: '(options: TextMetricsOptions) => FunctionalExtension',
          does: 'Streams live TextMetrics (words, characters, lines, estimated height) — measured mathematically over cached glyph widths, never by touching the DOM.',
        },
        {
          name: 'createHtmlLanguage / createHtmlAutocomplete / createSourceMarks',
          signature: '(options) => FunctionalExtension',
          does: 'The source pane’s language service: highlighting plus lint diagnostics, tag and attribute completion, and mark shortcuts that round-trip the selection through the email schema.',
        },
        {
          name: 'LayoutGuides, QuoteFold, PasteHygiene, ClearFormatting',
          signature: 'Extension',
          does: 'Table and column guides that peek on hover, the folded quoted history, paste sanitizing, and formatting removal.',
        },
        {
          name: 'ColumnResize, ColumnsResize, History, BaseKeymap, Gapcursor, NoTextDrag, SplitKeepingMarks',
          signature: 'Extension',
          does: 'The interaction layer: table and column-block resizing, undo/redo, the base keymap, a caret for positions no text can hold, drag suppression, and marks that survive a split.',
        },
      ],
    },
    {
      title: 'Documents & HTML',
      hint:
        'HTML is the canonical format on both sides of the composer: what the editor serializes ' +
        'is what the source pane lints and what the host sends. Everything here is pure.',
      entries: [
        {
          name: 'parseHTML / serializeToHTML',
          signature: '(html, schema) => Node · (doc, schema) => string',
          does: 'The document in and out of the schema — the round trip the two panes share.',
        },
        {
          name: 'emailPlainText',
          signature: '(html: string) => string',
          does: 'The text/plain projection of the canonical HTML — the other half of a well-formed multipart/alternative body.',
        },
        {
          name: 'scanHTML / lintHTML',
          signature: '(source) => HtmlScan · (source, scan?) => HtmlDiagnostic[]',
          does: 'Tokenizes the source, then reports what will not survive a mail client: tags outside EMAIL_SAFE_TAGS, unsupported CSS, fonts below MIN_FONT_SIZE, unbroken runs past MAX_UNBROKEN_RUN.',
        },
        {
          name: 'HtmlDiagnostic',
          signature: '{ severity: "error" | "warning", message, from, to }',
          does: 'One lint finding, positioned in the source — what the status strip counts and what its jump button reveals.',
        },
        {
          name: 'formatHTML',
          signature: '(html, indent?, width = FORMAT_WIDTH) => string',
          does: 'Pretty-prints the source pane’s document without changing what it means.',
        },
        {
          name: 'completionContextAt / openTags',
          signature: '(source, offset) => CompletionContext | null · (source, scan?) => string[]',
          does: 'What the caret sits in (tag name, attribute name, attribute value) and which elements are still open there — the autocomplete’s input.',
        },
        {
          name: 'sanitizePastedHTML',
          signature: '(html: string) => string',
          does: 'Strips what a paste from a word processor or a web page drags along, before it reaches the schema.',
        },
        {
          name: 'EMAIL_SAFE_TAGS / VOID_TAGS / EMAIL_SAFE_STYLE_PROPERTIES / EMAIL_TAG_ATTRIBUTES',
          signature: 'Set<string> · string[] · Record<string, string[]>',
          does: 'The vocabulary lint and completion both read — the tags, attributes and style properties that survive the mail clients.',
        },
      ],
    },
    {
      title: 'Reply, forward & import',
      hint:
        'Seeds are documents, not transports. The host parses the inbound message with whatever ' +
        'MIME parser it already trusts (postal-mime, mailparser); toInboundMessage is the whole ' +
        'bridge, and the seed comes back as HTML for the same canonical signal.',
      entries: [
        {
          name: 'InboundMessage',
          signature: '{ html?, text?, from?, date?, subject?, to? }',
          does: 'The inbound message as document content only — the attribution line and the forwarded-message header. The envelope stays the host’s.',
        },
        {
          name: 'toInboundMessage',
          signature: '(parsed: ParsedEmailLike) => InboundMessage',
          does: 'Bridges a parser result into the seeds, duck-typed so the library depends on no parser.',
        },
        {
          name: 'replyDocument / forwardDocument',
          signature: '(inbound, options?: ComposeSeedOptions) => string',
          does: 'The seed document: an empty composing area above the quoted history, with the attribution line (reply) or the forwarded header block (forward). options.locale formats a Date-typed date; a string date is used verbatim.',
        },
        {
          name: 'importedDocument',
          signature: '(inbound: InboundMessage) => string',
          does: 'The message itself as the document — what a dropped .eml becomes.',
        },
        {
          name: 'importLoss',
          signature: '(inbound: InboundMessage) => ImportLoss',
          does: 'What the import will drop, computed from the same HTML importedDocument consumes: { removedElements, removedTags, inlineImages }. Surface it — silent loss is the failure mode.',
        },
      ],
    },
    {
      title: 'Send',
      hint:
        'The send is an intent, not a transport: the user’s send is another editor action, and ' +
        'what it produces is a payload the host wires to its own mailer. Nothing network-shaped ' +
        'lives in this library.',
      entries: [
        {
          name: 'createSendIntent',
          signature: '(options: { onSend: (intent: SendIntent) => void }) => FunctionalExtension',
          does: 'Three ways in, one payload: the /send slash item, Mod-Enter, and the requestSend command for a toolbar button.',
        },
        {
          name: 'SendIntent',
          signature: '{ html, text, inlineImages: InlineImage[], requiredFields: string[] }',
          does: 'The canonical HTML with every data-URL image already promoted to a cid: reference, its plain-text projection, the inline parts that HTML references, and every merge-tag field the body reads — straight off the nodes, so a host never text-parses the HTML to discover them.',
        },
      ],
    },
    {
      title: 'Inline images',
      hint:
        'One registry per composer — provide InlineImages on the composer component, never in ' +
        'root: two composers must not share parts. The editor holds data URLs; the payload holds ' +
        'cid: references.',
      entries: [
        {
          name: 'InlineImages',
          signature: 'class InlineImages extends InlineImageStore',
          does: 'The registry as an Angular service: add(blob, cid?), blob(id), dataUrl(cid), previewHtml(html), a version signal that bumps on every change, and every URL revoked with the composer.',
        },
        {
          name: 'createInlineImages',
          signature: '(options: { registry: InlineImageRegistry }) => FunctionalExtension',
          does: 'Wires the registry into the editor, so a cid: image repaints the moment its part arrives.',
        },
        {
          name: 'promoteInlineImages',
          signature: '(doc: Node, registry?) => PromotedInlineImages',
          does: 'A copy of the document with every data-URL image pointing at its cid:, plus the parts it references, each id once, in document order. Pure — the editor keeps showing its data URLs.',
        },
        {
          name: 'rewriteInlineImageSources',
          signature: '(html: string, resolve: (cid) => string | undefined) => string',
          does: 'The preview’s projection: every cid: the resolver knows becomes a data URL (a sandboxed, opaque-origin frame cannot load the editor’s blob URLs). Unknown cids are left alone.',
        },
        {
          name: 'decodeDataUrl',
          signature: '(src: string) => Blob | null',
          does: 'A data: URL as a typed Blob — base64 or percent-encoded; null for anything malformed, so a bad source is left alone rather than sent as garbage.',
        },
      ],
    },
    {
      title: 'Email safety',
      hint:
        'What the mail clients will do to the document, answered before it is sent. All pure ' +
        'functions over the canonical HTML, or over one CSS declaration.',
      entries: [
        {
          name: 'emailSizeBudget',
          signature: '(html: string) => SizeBudget',
          does: 'UTF-8 size against the Gmail clipping limit (GMAIL_CLIP_BYTES, 102 kB): { bytes, limit, level } — warning from 80% of the budget, error above it.',
        },
        {
          name: 'findCssIssues / CSS_SUPPORT',
          signature: '(property, value, tag) => CssSupportIssue[]',
          does: 'Which clients drop or mangle a declaration, and what to use instead.',
        },
        {
          name: 'clientList / CLIENT_LABELS',
          signature: '(clients: EmailClient[]) => string',
          does: 'Those clients as prose, for a message a person reads.',
        },
        {
          name: 'passesDualContrast / passesDualBackground / contrastRatio',
          signature: '(hex: string) => boolean · (a, b) => number',
          does: 'Whether a colour survives both a light and a dark client (many invert), against DUAL_CONTRAST_MIN_RATIO and DUAL_BACKGROUND_MIN_RATIO.',
        },
        {
          name: 'emailTextPalette / emailBackgroundPalette',
          signature: 'PaletteColor[]',
          does: 'The colours that pass on both sides — the swatches the composer’s pickers offer.',
        },
      ],
    },
    {
      title: 'Merge tags & measurement',
      hint:
        'Personalization is a mark on the document, so the fields a body needs are a query over ' +
        'nodes rather than a scan of text. Length is arithmetic over cached glyph widths, so a ' +
        'live counter costs no layout.',
      entries: [
        {
          name: 'mergeTagFields / mergeTagExpressions',
          signature: '(doc: Node) => string[]',
          does: 'Every field the body reads, in first-use order — what SendIntent.requiredFields carries.',
        },
        {
          name: 'ExpressionDialect / analyzeAngularExpression / angularRequiredFields',
          signature: 'interface · (expr) => ExpressionIssue[] · (expressions) => string[]',
          does: 'The template dialect the document opts into: parse, diagnose, and report the fields. angularDialect is the AngularJS-expression one that ships.',
        },
        {
          name: 'readTypography / measureDoc / createBlockMeasureCache',
          signature:
            '(dom) => EditorTypography · (doc, contentWidth, typography, cache) => TextMetrics',
          does: 'Read the editable’s typography once, then measure the whole document at a content width — pure arithmetic, no DOM access, results cached per node.',
        },
      ],
    },
  ];
}
