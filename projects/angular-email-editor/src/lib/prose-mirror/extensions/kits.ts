import { Extension, NodeExtension } from '../extension';
import { Document } from './nodes/document';
import { Paragraph } from './nodes/paragraph';
import { EmailParagraph } from './nodes/email-paragraph';
import { CodeLine } from './nodes/code-line';
import { Text } from './nodes/text';
import { HtmlLanguage } from './html-language';
import { createSourceMarks } from './html-source-marks';
import { HardBreak } from './nodes/hard-break';
import { Heading } from './nodes/heading';
import { Blockquote } from './nodes/blockquote';
import { BulletList, ListItem, OrderedList } from './nodes/lists';
import { Image } from './nodes/image';
import { Divider } from './nodes/divider';
import { Button } from './nodes/button';
import { Table, TableRow, TableCell } from './nodes/table';
import { Columns, Column } from './nodes/columns';
import { Bold } from './marks/bold';
import { Italic } from './marks/italic';
import { Underline } from './marks/underline';
import { Link } from './marks/link';
import { Strike } from './marks/strike';
import { TextStyle } from './marks/text-style';
import { History } from './history';
import { NoTextDrag } from './no-text-drag';
import { SplitKeepingMarks } from './split-keeping-marks';
import { BaseKeymap } from './base-keymap';
import { PasteHygiene } from './paste-hygiene';
import { ClearFormatting } from './clear-formatting';

/** Everything but the paragraph flavour, which is what the kits swap. */
const withParagraph = (paragraph: NodeExtension): Extension[] => [
  Document,
  paragraph,
  Text,
  HardBreak,
  Heading,
  Blockquote,
  BulletList,
  OrderedList,
  ListItem,
  Image,
  Divider,
  Button,
  Table,
  TableRow,
  TableCell,
  Columns,
  Column,
  Bold,
  Italic,
  Underline,
  Link,
  Strike,
  TextStyle,
  History,
  NoTextDrag,
  // After lists/blockquote (their Enter wins inside those), before BaseKeymap
  // (whose plain splitBlock this replaces): keeps font/colour across Enter.
  SplitKeepingMarks,
  BaseKeymap,
  PasteHygiene,
  ClearFormatting,
];

/** Semantic HTML output (`<p>` paragraphs) for content rendered in the app. */
export const richTextExtensions: Extension[] = withParagraph(Paragraph);

/**
 * Email-safe output: `<div>` lines instead of `<p>` (mail clients render
 * paragraph margins as double spacing) and empty lines as `<div><br></div>`.
 */
export const emailExtensions: Extension[] = withParagraph(EmailParagraph);

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
  // The email kit's mark shortcuts (Mod-B, Mod-I, ...) work on the source
  // too, by round-tripping the selection through the email schema itself —
  // toggling is identical on both sides by construction.
  createSourceMarks({ extensions: emailExtensions }),
  History,
  NoTextDrag,
  BaseKeymap,
];
