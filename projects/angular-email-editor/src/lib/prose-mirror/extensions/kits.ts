import { Extension, NodeExtension } from '../extension';
import { Document } from './nodes/document';
import { Paragraph } from './nodes/paragraph';
import { EmailParagraph } from './nodes/email-paragraph';
import { CodeLine } from './nodes/code-line';
import { Text } from './nodes/text';
import { HtmlLanguage } from './html-language';
import { CodeLineIndent } from './code-line-indent';
import { createSourceMarks } from './html-source-marks';
import { HardBreak } from './nodes/hard-break';
import { MergeTag } from './nodes/merge-tag';
import { Heading } from './nodes/heading';
import { Blockquote } from './nodes/blockquote';
import { BulletList, ListItem, OrderedList } from './nodes/lists';
import { Image } from './nodes/image';
import { Divider } from './nodes/divider';
import { Button } from './nodes/button';
import { InlineAtomSelection } from './inline-atom-selection';
import { SelectedBlocks } from './block-selection';
import { Table, TableRow, TableCell } from './nodes/table';
import { Columns, Column } from './nodes/columns';
import { Bold } from './marks/bold';
import { Italic } from './marks/italic';
import { Underline } from './marks/underline';
import { Link } from './marks/link';
import { Strike } from './marks/strike';
import { TextStyle } from './marks/text-style';
import { History } from './history';
import { LayoutGuides } from './layout-guides';
import { LayoutInteraction } from './layout-interaction';
import { Gapcursor } from './gapcursor';
import { ClickBelow } from './click-below';
import { ColumnResize } from './column-resize';
import { ColumnsResize } from './columns-resize';
import { NoTextDrag } from './no-text-drag';
import { SplitKeepingMarks } from './split-keeping-marks';
import { BaseKeymap } from './base-keymap';
import { PasteHygiene } from './paste-hygiene';
import { ClearFormatting } from './clear-formatting';
import { QuotedHistory } from './quoted-history';
import { Section } from './nodes/section';
import { DocumentStyles } from './document-styles';
import { AuthoredEnter, preserveExtensions } from '../preserve';

/** Everything but the paragraph flavour, which is what the kits swap. */
const withParagraph = (paragraph: NodeExtension): Extension[] => [
  Document,
  paragraph,
  Text,
  HardBreak,
  // Personalization tokens (`{{firstName}}`): pills in the editor, raw
  // Handlebars-flavoured text in the email.
  MergeTag,
  Heading,
  Blockquote,
  BulletList,
  OrderedList,
  ListItem,
  Image,
  Divider,
  Button,
  // Images and buttons selected like characters: a drag covers them.
  InlineAtomSelection,
  // Whole blocks selected as blocks (Notion's): lit, and walked by its
  // keys. Before the tables and gap-cursor, whose arrows it outranks while
  // there is one.
  SelectedBlocks,
  Table,
  TableRow,
  TableCell,
  Columns,
  Column,
  Section,
  // A click below the last block starts a line there (Notion's). Before
  // gap-cursor, whose click would park a cursor under a trailing table.
  ClickBelow,
  // After the layout blocks on purpose: their own arrow escapes must be
  // reached before gap-cursor claims the arrows (see the extension's docs).
  Gapcursor,
  // Table NodeView (scroll wrapper + display colgroup) and the boundary-drag
  // handles. Percentages only — see the extension's docs.
  ColumnResize,
  // The layout block's twin: same drag vocabulary, px-cap model.
  ColumnsResize,
  Bold,
  Italic,
  Underline,
  Link,
  Strike,
  TextStyle,
  History,
  // One editor-only outline mechanism for every layout block (table, columns).
  LayoutGuides,
  // Their grips, drags, pills and menus, on or off by type (`setLayoutInteraction`).
  LayoutInteraction,
  NoTextDrag,
  // Enter in a structural text cell (an MJML `<td>`) breaks the line instead
  // of splitting the cell. Before SplitKeepingMarks, which would split it.
  AuthoredEnter,
  // After lists/blockquote (their Enter wins inside those), before BaseKeymap
  // (whose plain splitBlock this replaces): keeps font/colour across Enter.
  SplitKeepingMarks,
  BaseKeymap,
  PasteHygiene,
  ClearFormatting,
  // The structural family: authored layout markup kept verbatim in the
  // `email` and `preserve` modes (the source pane, `setContent`); inert in
  // `repair` mode (paste, seeds). Last, so the canonical nodes stay the
  // defaults of every group.
  ...preserveExtensions,
];

/** Semantic HTML output (`<p>` paragraphs) for content rendered in the app. */
export const richTextExtensions: Extension[] = withParagraph(Paragraph);

/**
 * Email-safe output: `<div>` lines instead of `<p>` (mail clients render
 * paragraph margins as double spacing) and empty lines as `<div><br></div>`.
 */
export const emailExtensions: Extension[] = [
  ...withParagraph(EmailParagraph),
  // A preserved document's head styles, applied to the editor view scoped to
  // this editor only — the visual pane renders a template as the recipient
  // sees it.
  DocumentStyles,
  // Reply-specific (so not in the rich-text kit): the quoted history, kept
  // beside the body and folded behind Gmail's `⋯`. A host in another
  // language swaps it for its own `createQuotedHistory({ labels })`.
  QuotedHistory,
];

/**
 * Plain text — a mail client's plain-text mode: the message as lines and
 * nothing else. No marks, no blocks, no images, no tokens in the schema, so
 * neither a shortcut (Mod-B has nothing to toggle) nor a paste (HTML is
 * read down to its text) can bring formatting in. Lines are the email
 * kit's `<div>` lines, Shift-Enter a `<br>` inside one, so what the editor
 * publishes is still email HTML — `emailPlainText` reads it back as exactly
 * the text written, the `text/plain` a plain-text message sends. The
 * quoted history is kept beside it, as in the email kit.
 *
 * A host switches a message between the two by mounting a new editor on
 * the other kit (a schema is fixed for an editor's life) with the content
 * carried over: `plainTextHTML(emailPlainText(html))` on the way in.
 */
export const plainTextExtensions: Extension[] = [
  Document,
  EmailParagraph,
  Text,
  HardBreak,
  History,
  QuotedHistory,
  BaseKeymap,
];

/**
 * The parallel source-editor kit: the document is HTML source text, one
 * `codeLine` per line, with highlighting, linting and formatting instead of
 * rich-text nodes. Developed alongside the email kit on the same extension
 * contract — only the extension set differs.
 */
export const htmlSourceExtensions: Extension[] = [
  Document,
  CodeLine,
  Text,
  HtmlLanguage,
  // Each line's indentation on it, for a host's VS Code-style soft wrap.
  CodeLineIndent,
  // The email kit's mark shortcuts (Mod-B, Mod-I, ...) work on the source
  // too, by round-tripping the selection through the email schema itself —
  // toggling is identical on both sides by construction.
  createSourceMarks({ extensions: emailExtensions }),
  History,
  NoTextDrag,
  BaseKeymap,
];
