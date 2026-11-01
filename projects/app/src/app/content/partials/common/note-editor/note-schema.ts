import MarkdownIt from 'markdown-it';
import { toggleMark } from 'prosemirror-commands';
import { InputRule, wrappingInputRule } from 'prosemirror-inputrules';
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownSerializer,
} from 'prosemirror-markdown';
import { Fragment, MarkType, Node, Schema, Slice } from 'prosemirror-model';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import { Command, EditorState } from 'prosemirror-state';

/**
 * A note's words: paragraphs, line breaks, bullet and numbered lists;
 * bold, italic, strike, code and links — what Markdown says of them, and
 * nothing else. What a calendar's description holds, Google's: a few
 * lines, a list of what to bring, a word stressed and a link to the call.
 *
 * The note IS Markdown: read from it (`noteDoc`), written as it
 * (`noteMarkdown`), copied as it and pasted from it — CommonMark with
 * GitHub's strikethrough, a line break where a line ends.
 */
export const noteSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      // Pasted rich text: a heading is a line of its own here, as is code.
      parseDOM: [
        { tag: 'p' },
        { tag: 'div' },
        { tag: 'h1' },
        { tag: 'h2' },
        { tag: 'h3' },
        { tag: 'h4' },
        { tag: 'h5' },
        { tag: 'h6' },
        { tag: 'pre', preserveWhitespace: 'full' },
      ],
      toDOM: () => ['p', 0],
    },
    bullet_list: {
      content: 'list_item+',
      group: 'block',
      attrs: { tight: { default: true } },
      parseDOM: [{ tag: 'ul' }],
      toDOM: () => ['ul', 0],
    },
    ordered_list: {
      content: 'list_item+',
      group: 'block',
      attrs: { order: { default: 1 }, tight: { default: true } },
      parseDOM: [
        {
          tag: 'ol',
          getAttrs: (dom) => ({ order: Number((dom as HTMLElement).getAttribute('start') ?? 1) }),
        },
      ],
      toDOM: (node) => ['ol', { start: node.attrs['order'] === 1 ? null : node.attrs['order'] }, 0],
    },
    list_item: {
      content: 'paragraph block*',
      defining: true,
      parseDOM: [{ tag: 'li' }],
      toDOM: () => ['li', 0],
    },
    text: { group: 'inline' },
    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM: () => ['br'],
    },
  },
  marks: {
    link: {
      attrs: { href: {} },
      inclusive: false,
      parseDOM: [
        {
          tag: 'a[href]',
          getAttrs: (dom) => {
            const href = linkHref((dom as HTMLElement).getAttribute('href') ?? '');
            return href ? { href } : false;
          },
        },
      ],
      toDOM: (mark) => [
        'a',
        { href: mark.attrs['href'], target: '_blank', rel: 'noopener noreferrer' },
        0,
      ],
    },
    strong: {
      parseDOM: [
        { tag: 'strong' },
        { tag: 'b' },
        {
          style: 'font-weight',
          getAttrs: (value) => /^(bold(er)?|[6-9]\d\d)$/.test(value) && null,
        },
      ],
      toDOM: () => ['strong', 0],
    },
    em: {
      parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
      toDOM: () => ['em', 0],
    },
    strike: {
      parseDOM: [
        { tag: 's' },
        { tag: 'del' },
        { tag: 'strike' },
        { style: 'text-decoration=line-through' },
      ],
      toDOM: () => ['s', 0],
    },
    code: {
      parseDOM: [{ tag: 'code' }],
      toDOM: () => ['code', 0],
    },
  },
});

const { link, strong, em, strike, code } = noteSchema.marks;
const { paragraph, bullet_list, ordered_list, list_item, hard_break } = noteSchema.nodes;

// ─── Markdown ─────────────────────────────────────────────────────────

/**
 * CommonMark with GitHub's `~~strike~~`, bare addresses linked, a line
 * ended a line broken (an invitation's plain text keeps its lines), and
 * no HTML — tags are words. What the note cannot hold says what it can:
 * an image its words, linked to it; a heading or a code block a
 * paragraph; a quote or a rule nothing of its own.
 */
const tokenizer = new MarkdownIt('commonmark', { html: false, linkify: true, breaks: true })
  .enable(['strikethrough', 'linkify'])
  .use((md) =>
    md.core.ruler.push('note_images', (state) => {
      for (const block of state.tokens) {
        block.children =
          block.children?.flatMap((token) => {
            if (token.type !== 'image') return [token];
            const open = new state.Token('link_open', 'a', 1);
            open.attrSet('href', token.attrGet('src') ?? '');
            const words = new state.Token('text', '', 0);
            words.content = token.content || token.attrGet('src') || '';
            return [open, words, new state.Token('link_close', 'a', -1)];
          }) ?? null;
      }
    }),
  );

/** Whether the list's items are one line apart — no blank line between. */
function tight(tokens: { hidden: boolean }[], index: number): boolean {
  return tokens[index + 2]?.hidden ?? true;
}

const parser = new MarkdownParser(noteSchema, tokenizer, {
  paragraph: { block: 'paragraph' },
  heading: { block: 'paragraph' },
  code_block: { block: 'paragraph', noCloseToken: true },
  fence: { block: 'paragraph', noCloseToken: true },
  blockquote: { ignore: true },
  hr: { ignore: true, noCloseToken: true },
  bullet_list: { block: 'bullet_list', getAttrs: (_, tokens, i) => ({ tight: tight(tokens, i) }) },
  ordered_list: {
    block: 'ordered_list',
    getAttrs: (token, tokens, i) => ({
      order: Number(token.attrGet('start') ?? 1),
      tight: tight(tokens, i),
    }),
  },
  list_item: { block: 'list_item' },
  hardbreak: { node: 'hard_break' },
  // A line ended where no Markdown breaks it — markdown-it's `breaks`
  // still calls it soft.
  softbreak: { node: 'hard_break' },
  em: { mark: 'em' },
  strong: { mark: 'strong' },
  s: { mark: 'strike' },
  code_inline: { mark: 'code', noCloseToken: true },
  link: { mark: 'link', getAttrs: (token) => ({ href: linkHref(token.attrGet('href') ?? '') }) },
});

const { nodes: markdownNodes, marks: markdownMarks } = defaultMarkdownSerializer;

const serializer = new MarkdownSerializer(
  {
    paragraph: markdownNodes['paragraph'],
    // `-`, as GitHub and Notion write a bullet.
    bullet_list: (state, node) => state.renderList(node, '  ', () => '- '),
    ordered_list: markdownNodes['ordered_list'],
    list_item: markdownNodes['list_item'],
    hard_break: markdownNodes['hard_break'],
    text: markdownNodes['text'],
  },
  {
    em: markdownMarks['em'],
    strong: markdownMarks['strong'],
    link: markdownMarks['link'],
    code: markdownMarks['code'],
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  },
);

/** A note, read from its Markdown. */
export function noteDoc(markdown: string): Node {
  return parser.parse(markdown);
}

/** Whether the note holds nothing — one empty paragraph. */
export function noteEmpty(doc: Node): boolean {
  return doc.childCount === 1 && doc.firstChild!.type === paragraph && !doc.firstChild!.childCount;
}

/** A note's Markdown — none for an empty one, so "no description" stays
    `''`. */
export function noteMarkdown(doc: Node): string {
  return noteEmpty(doc) ? '' : serializer.serialize(doc);
}

/** What is copied, as Markdown — words alone a line of it. */
export function sliceMarkdown(slice: Slice): string {
  const content = slice.content.firstChild?.isInline
    ? Fragment.from(paragraph.create(null, slice.content))
    : slice.content;
  const doc = noteSchema.topNodeType.createAndFill(null, content);
  return doc ? noteMarkdown(doc) : slice.content.textBetween(0, slice.content.size, '\n\n');
}

/** Markdown pasted, as what it says — a slice as open as it goes, so a
    line pasted into a line joins it. */
export function markdownSlice(markdown: string): Slice {
  return Slice.maxOpen(noteDoc(markdown).content);
}

/** Text pasted plain (Shift): its lines, as they are — no Markdown read. */
export function linesSlice(text: string): Slice {
  const lines = text
    .split(/\r?\n/)
    .map((line) => paragraph.create(null, line ? noteSchema.text(line) : null));
  return Slice.maxOpen(Fragment.from(lines));
}

// ─── Commands ─────────────────────────────────────────────────────────

/** An address as a note keeps one: a bare `www.example.com` gets its
    `https://`; one that is not the web's, mail's or a phone's is none
    (`''`) — never `javascript:`. */
export function linkHref(typed: string): string {
  const href = typed.trim();
  if (!href) return '';
  if (/^(https?:|mailto:|tel:)/i.test(href)) return href;
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return '';
  return `https://${href}`;
}

/** Whether pasted text is an address — one word, a scheme or `www.`. */
export function isAddress(text: string): boolean {
  return /^(https?:\/\/|mailto:)\S+$|^www\.\S+\.\S+$/i.test(text.trim());
}

/** The selection linked to `href` — an address pasted over words. */
export function setLink(href: string): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty || !href) return false;
    dispatch?.(state.tr.removeMark(from, to, link).addMark(from, to, link.create({ href })));
    return true;
  };
}

/** The line broken where the caret is (Shift+Enter). */
export const breakLine: Command = (state, dispatch) => {
  dispatch?.(state.tr.replaceSelectionWith(hard_break.create()).scrollIntoView());
  return true;
};

/** Whether the caret is in a list. */
function inList(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type === list_item) return true;
  }
  return false;
}

/** At the very start of a list's item: out of the list a level. */
const liftAtStart: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset > 0 || $from.node(-1)?.type !== list_item) return false;
  return liftListItem(list_item)(state, dispatch);
};

/**
 * The keys, Notion's: Mod-B, Mod-I, Mod-Shift-S, Mod-E for code;
 * Mod-Shift-8 a bullet list, Mod-Shift-7 a numbered one. In a list, Enter
 * is the next item (an empty one ends the list), Tab and Shift+Tab move
 * an item in and out — and are the list's even where the item cannot
 * move, so focus never leaves mid-list; Backspace at an item's start
 * takes it out.
 */
export const noteKeys: Record<string, Command> = {
  'Mod-b': toggleMark(strong),
  'Mod-i': toggleMark(em),
  'Mod-Shift-s': toggleMark(strike),
  'Mod-e': toggleMark(code),
  'Mod-Shift-8': wrapInList(bullet_list),
  'Mod-Shift-7': wrapInList(ordered_list),
  Enter: splitListItem(list_item),
  Tab: (state, dispatch) => inList(state) && (sinkListItem(list_item)(state, dispatch), true),
  'Shift-Tab': (state, dispatch) =>
    inList(state) && (liftListItem(list_item)(state, dispatch), true),
  Backspace: liftAtStart,
};

// ─── Syntax ───────────────────────────────────────────────────────────

/**
 * Words between two delimiters, closed as they are typed: the delimiters
 * gone, the words marked — and the mark not carried on past them. The
 * pattern's group 1 is the words; it ends on the closing delimiter, the
 * character just typed its last.
 */
function markRule(pattern: RegExp, type: MarkType): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const [whole, words] = match;
    const from = start + whole.indexOf(words);
    const to = from + words.length;
    return state.tr
      .delete(to, end)
      .delete(start, from)
      .addMark(start, start + words.length, type.create())
      .removeStoredMark(type);
  });
}

/** Words that neither start nor end on a space, between `d`s (escaped). */
const between = (open: string, d: string, close = open) =>
  new RegExp(`(?<![${d}\\w])${open}([^${d}\\s](?:[^${d}]*[^${d}\\s])?)${close}$`);

/**
 * The note's syntax, Markdown's (and Notion's), as it is typed: `- ` (or
 * `* `, `+ `) at a line's start a bullet list, `1. ` a numbered one;
 * `**bold**`, `*italic*` or `_italic_`, `~~strike~~` or `~strike~`,
 * `` `code` ``, `[words](address)` for a link, and an address typed then
 * a space — linked as it stands. Backspace right after takes one back to
 * what was typed.
 */
export const noteRules: readonly InputRule[] = [
  wrappingInputRule(/^\s*([-+*])\s$/, bullet_list),
  wrappingInputRule(
    /^(\d+)\.\s$/,
    ordered_list,
    (match) => ({ order: Number(match[1]) }),
    (match, node) => node.childCount + node.attrs['order'] === Number(match[1]),
  ),
  markRule(between('\\*\\*', '*'), strong),
  markRule(between('\\*', '*'), em),
  markRule(between('_', '_'), em),
  markRule(between('~~', '~'), strike),
  markRule(between('~', '~'), strike),
  markRule(/(?<!`)`([^`]+)`$/, code),
  new InputRule(/\[([^\]]+)\]\(([^)\s]+)\)$/, (state, match, start, end) => {
    const [, words, typed] = match;
    const href = linkHref(typed);
    if (!href) return null;
    return state.tr
      .replaceWith(start, end, noteSchema.text(words, [link.create({ href })]))
      .removeStoredMark(link);
  }),
  new InputRule(/(?<!\S)((?:https?:\/\/|www\.)\S+\.\S+)\s$/, (state, match, start, end) => {
    const [, address] = match;
    if (state.doc.rangeHasMark(start, start + address.length, link)) return null;
    return state.tr
      .addMark(start, start + address.length, link.create({ href: linkHref(address) }))
      .insertText(match[0].slice(address.length), end);
  }),
];
