import { hasDocumentEnvelope } from './envelope';
import { parseDeclarations } from './style-text';

/**
 * The quoted history of a received message — what an answer carries of the
 * mail it answers, under its own text — told apart from that text. Every
 * client marks it its own way, and none says so in a header:
 *
 * - **Gmail** wraps it in `.gmail_quote` (a `<blockquote>`, or a container
 *   with the attribution line, `.gmail_attr`, over one).
 * - **Outlook** puts nothing round it: a rule, then a header block
 *   (`#divRplyFwdMsg` on the web, a `border-top` line over From/Sent/To in
 *   Word's HTML), and the answered mail after it, to the end.
 * - **Apple Mail** and **Thunderbird** quote in `<blockquote type="cite">`,
 *   Thunderbird's attribution in `.moz-cite-prefix` over it.
 * - **Yahoo** (`.yahoo_quoted`) and **Proton** (`.protonmail_quote`) wrap it.
 * - **Plain-text headers** (WEB.DE, GMX, Outlook plain text): a block opening
 *   with `From:` / `Von:`, then date, recipient and `Subject:` / `Betreff:`
 *   fields (with a `-----Original Message-----` separator over it, a date or
 *   a recipient is enough), followed by the answered mail. Unless a separator
 *   opens it, a reply's mark must stand right over it — a rule, a separator,
 *   or an attribution line ("Am … schrieb …", its colon optional) — so a
 *   notification's field list is never taken for one.
 * - Anything else: a `<blockquote>` right under a line that ends as an
 *   attribution does ("On … wrote:").
 *
 * Only a history that **trails** is one: the message's own text, then the
 * quote, then nothing. A quote answered line by line (text after it) is the
 * message itself and stays; so does a message that is nothing but a quote
 * (a bare forward) — folding it away would leave an empty sheet.
 */

/** A received body told apart: its own text, and the history it quotes. */
export interface QuotedSplit {
  /** The message's own text — the whole of it where it quotes nothing. A
      whole document stays one, a fragment a fragment. */
  readonly body: string;
  /** The quoted history, a fragment — empty where there is none. */
  readonly quoted: string;
}

/**
 * A received body without the history it quotes, and that history beside
 * it — for a conversation, where each message's history is the messages
 * above it, and reading it again under every one is noise.
 */
export function splitQuoted(html: string): QuotedSplit {
  const message = parse(html);
  const history = trailingHistory(message.body);
  // What `foldQuoted` would not fold, this does not take apart either.
  if (!foldable(history)) return { body: html, quoted: '' };
  const holder = message.createElement('div');
  holder.append(...history);
  return { body: serialize(message, html), quoted: holder.innerHTML };
}

export interface FoldQuotedOptions {
  /** What the toggle is called for assistive tech and on hover — "Quoted
      text", in the reader's language. What is shown is a `⋯` toggle. */
  readonly label: string;
  /** CSS for the fold inside the frame: omitted uses Dawn's default thin `⋯`
      pill and each quoted message in a box of its own, the boxes straight
      down one under the other (themeable via `--dawn-quoted-*`); a string
      appends consumer rules after Dawn's defaults; `false` emits headless
      semantic markup with no `<style>` at all. */
  readonly style?: string | false;
}

/**
 * A received body with the history it quotes folded behind a `⋯` — and the
 * body as it came where it quotes nothing. The fold is a `<details>`: it
 * opens and closes in a frame that runs no script, by pointer and by
 * keyboard, and says which it is to assistive tech. Drawn with the text's
 * own ink on a grey that reads on light and dark paper, so it needs no
 * scheme — or headless with `style: false`, and themeable via
 * `--dawn-quoted-*` custom properties.
 *
 * Fold first, then draw (`renderDawn`): the fold is part of the document
 * Dawn draws.
 */
export function foldQuoted(html: string, { label, style }: FoldQuotedOptions): string {
  const message = parse(html);
  const history = trailingHistory(message.body);
  const head = history[0];
  const parent = head?.parentElement;
  if (!head || !parent || !foldable(history)) return html;

  const fold = message.createElement('details');
  fold.setAttribute('data-dawn-quoted', '');
  const toggle = message.createElement('summary');
  toggle.setAttribute('aria-label', label);
  toggle.setAttribute('title', label);
  toggle.textContent = '⋯';

  parent.insertBefore(fold, head);
  if (style === false) {
    fold.append(toggle, ...history);
  } else {
    const sheet = message.createElement('style');
    sheet.textContent = style ? `${FOLD_STYLE}\n${style}` : FOLD_STYLE;
    fold.append(toggle, sheet, ...history);
  }
  markFold(fold);
  return serialize(message, html);
}

const THREAD_GAP =
  'display: block !important; width: 2px !important; height: 16px !important; margin-block: 8px !important; margin-inline: 12px 0 !important; padding: 0 !important; border: 0 !important; border-radius: 2px !important; background: transparent !important;';
const THREAD_STEM = 'background: var(--dawn-quoted-stem, rgba(128, 128, 128, 0.36)) !important;';

/** Where a quoted message is drawn as a box of its own — the line round
    it, the gap between two, the room inside — and the paper under them,
    which the gap is painted in (Dawn's surfaces say it:
    `--dawn-quoted-paper`; the system's canvas else). The line is opaque —
    the grey of the thread's stem, laid on the paper once: a box under
    another runs on its sides and foot, and a see-through line would darken
    with every box it lies on. */
const BOX_PAPER = 'var(--dawn-quoted-paper, Canvas)';
const BOX_LINE = `var(--dawn-quoted-box-line, color-mix(in srgb, rgb(128, 128, 128) 36%, ${BOX_PAPER}))`;
const STEM = 'var(--dawn-quoted-stem, rgba(128, 128, 128, 0.36))';

/** Semantic markers stamped by `markFold` so Dawn's stylesheet stays
    completely client-agnostic (no `.gmail_*`, `.moz-*`, `.yahoo_*`,
    `.protonmail_*`, or `#divRplyFwdMsg` selectors in CSS). */
const BOX = '[data-dawn-quoted-box]';
const HEAD = '[data-dawn-quoted-head]';
const FOOT = '[data-dawn-quoted-foot]';
const ATTR = '[data-dawn-quoted-attr]';
const HEADER = '[data-dawn-quoted-header]';
const JOINED = '[data-dawn-quoted-joined]';
const LAST = '[data-dawn-quoted-last]';
const STEM_RULE = '[data-dawn-quoted-stem]';

/** Every box, whole or in two parts. */
const BOXES = `${BOX}, ${HEAD}, ${FOOT}`;

/** Under a box (a message quoted in the one that quotes it): out over that
    box's sides and foot, so its sides and foot are the box's own and the
    two read as two boxes, one under the other, never one in the other. The
    margin over it is the box's padding, the box's foot (1px), then the gap.
    Applied only to boxes marked `data-dawn-quoted-last` (`markLast`): those
    that genuinely trail their enclosing box with no text node, sibling or
    layout barrier in the way. */
const BREAK_OUT =
  'margin: calc(var(--_pad) + 1px + var(--_gap)) var(--_out) var(--_out) !important; position: relative !important;';

/** The box's foot, drawn by the box under it — the box's own border runs on
    down beside it: a line under the box's padding, its corners round, and
    paper round the curve over the box's straight sides. Positioned against
    the padding box: its top is the gap, its 1px foot and its corner over the
    border box's top. */
const FOOT_OF_ABOVE = [
  'content: "" !important',
  'position: absolute !important',
  'display: block !important',
  'box-sizing: border-box !important',
  'top: calc(-2px - var(--_gap) - var(--_r)) !important',
  'left: -1px !important',
  'right: -1px !important',
  'width: auto !important',
  'height: calc(var(--_r) + 1px) !important',
  'margin: 0 !important',
  'padding: 0 !important',
  'background: none !important',
  `border: 1px solid ${BOX_LINE} !important`,
  'border-top: 0 !important',
  'border-radius: 0 0 var(--_r) var(--_r) !important',
  `box-shadow: 0 0 0 var(--_r) ${BOX_PAPER} !important`,
  // Never over the box's last line, nor out past its sides: the paper is
  // round the curve, inside the box, and down into the gap (1px out for
  // the line's anti-aliasing).
  'clip-path: inset(0 -1px calc(-1 * var(--_r))) !important',
  'pointer-events: none !important',
].join('; ');

/** The gap over a box: paper over the sides of the box above it, the
    thread's stem down it from that box's foot to this one's top, and paper
    round this box's top corners, where the box above's straight sides run
    on beside it. */
const GAP_OVER = [
  'content: "" !important',
  'position: absolute !important',
  'top: calc(-1px - var(--_gap)) !important',
  'left: -1px !important',
  'right: -1px !important',
  'height: calc(var(--_gap) + var(--_r)) !important',
  'pointer-events: none !important',
  `background: linear-gradient(${STEM}, ${STEM}) calc(1px + var(--_pad)) 0 / 2px var(--_gap) no-repeat, linear-gradient(${BOX_PAPER}, ${BOX_PAPER}) 0 0 / 100% var(--_gap) no-repeat, radial-gradient(circle at 100% 100%, transparent calc(var(--_r) - 0.5px), ${BOX_PAPER} var(--_r)) 0 var(--_gap) / var(--_r) var(--_r) no-repeat, radial-gradient(circle at 0 100%, transparent calc(var(--_r) - 0.5px), ${BOX_PAPER} var(--_r)) 100% var(--_gap) / var(--_r) var(--_r) no-repeat !important`,
].join('; ');

/** Inside a box. */
const IN_BOX = `details[data-dawn-quoted] :is(${BOXES})`;

/**
 * Each quoted message a box of its own, its corners round, the boxes
 * straight down one under the other and the thread's stem between two — by
 * style alone, the message's markup as it came. A client nests each
 * message in the one that quotes it, so every box runs on round all those
 * under it: the last box in another is drawn out over that box's sides and
 * foot (`BREAK_OUT`), draws its foot (`FOOT_OF_ABOVE`, its `::before`) and
 * paints the gap (`GAP_OVER`, its `::after`). Each box its own formatting
 * context (`flow-root`): the margin of the text inside it stays inside,
 * never opening a gap between a box's two parts. Unwrapped histories (such
 * as Outlook's, where header and mail run on as siblings) keep the thread's
 * stem.
 */
const BOX_STYLE = [
  `details[data-dawn-quoted] { --_pad: var(--dawn-quoted-box-padding, 12px); --_gap: var(--dawn-quoted-box-gap, 16px); --_r: var(--dawn-quoted-box-radius, 8px); --_out: calc(-1 * (var(--_pad) + 1px)); }`,
  // A blank line that only leads into the box under it (`<br><br>` over a
  // forward): the box's padding is that room already.
  `${IN_BOX} br:has(+ br + :is(${BOX}, ${JOINED})) { display: none; }`,
  `details[data-dawn-quoted] ${BOX} { display: flow-root !important; margin: 8px 0 0 !important; padding: var(--_pad) !important; border: 1px solid ${BOX_LINE} !important; border-radius: var(--_r) !important; }`,
  `details[data-dawn-quoted] ${HEAD} { display: flow-root !important; margin: 8px 0 0 !important; padding: var(--_pad) var(--_pad) 4px !important; border: 1px solid ${BOX_LINE} !important; border-block-end: 0 !important; border-radius: var(--_r) var(--_r) 0 0 !important; }`,
  `details[data-dawn-quoted] ${FOOT} { display: flow-root !important; margin: 0 !important; padding: 0 var(--_pad) var(--_pad) !important; border: 1px solid ${BOX_LINE} !important; border-block-start: 0 !important; border-radius: 0 0 var(--_r) var(--_r) !important; }`,
  // A box with the parent's text after it (or inside a layout barrier): inside the parent's, room under it.
  `${IN_BOX} :is(${BOX}, ${FOOT}):not(${LAST}) { margin-block-end: 8px !important; }`,
  `${IN_BOX} ${BOX}${LAST} { ${BREAK_OUT} }`,
  `${IN_BOX} ${HEAD}${LAST} { ${BREAK_OUT} margin-block-end: 0 !important; }`,
  `${IN_BOX} ${FOOT}${LAST} { margin: 0 var(--_out) var(--_out) !important; }`,
  `${IN_BOX} :is(${BOX}, ${HEAD})${LAST}::before { ${FOOT_OF_ABOVE}; }`,
  `${IN_BOX} :is(${BOX}, ${HEAD})${LAST}::after { ${GAP_OVER}; }`,
  // A forward with no word of its own: no box, its line under its parent's.
  `details[data-dawn-quoted] ${JOINED} { margin: 8px 0 0 !important; padding: 0 !important; border: 0 !important; }`,
];

/**
 * The fold's own rules: a thin `⋯` pill (16px tall visually, with a 24px
 * vertical hit target via `::after` for WCAG 2.5.8), WebKit's marker off
 * `<summary>`, attribution lines muted and small, and the quoted messages
 * in boxes (`BOX_STYLE`) — unwrapped histories keep their rules as the
 * thread's gap and stem. Themeable via `--dawn-quoted-*` custom properties;
 * pure presentation so the message's markup stays as it came.
 *
 * Spacing stays on a 4px grid (4 / 8 / 12 / 16px) with a 2px thread stem.
 */
const FOLD_STYLE = [
  'details[data-dawn-quoted] > summary { position: relative; display: block; width: fit-content; box-sizing: border-box; min-width: 28px; margin: 8px 0; padding: 0 8px; border-radius: var(--dawn-quoted-toggle-radius, 8px); background: var(--dawn-quoted-toggle-bg, rgba(128, 128, 128, 0.24)); font: 700 16px/16px Arial, sans-serif; letter-spacing: 1px; text-align: center; cursor: pointer; list-style: none; user-select: none; }',
  'details[data-dawn-quoted] > summary:hover { background: var(--dawn-quoted-toggle-bg-hover, rgba(128, 128, 128, 0.34)); }',
  'details[data-dawn-quoted] > summary::after { content: ""; position: absolute; inset: -4px 0; }',
  'details[data-dawn-quoted] > summary::-webkit-details-marker { display: none; }',
  'details[data-dawn-quoted][open] > summary { margin-bottom: 0; }',
  // A header written out as text has no box and no rule over it: the gap
  // a box keeps under the ⋯, kept here too.
  `details[data-dawn-quoted] ${HEADER} { margin-block-start: 8px !important; }`,
  'details[data-dawn-quoted] blockquote { margin: 0 !important; padding: 0 !important; border: 0 !important; }',
  `details[data-dawn-quoted] > style + br, details[data-dawn-quoted] br:has(+ :is(${BOX}, ${HEAD}, ${ATTR}, ${HEADER}, ${JOINED}, blockquote)) { display: none; }`,
  `details[data-dawn-quoted] ${ATTR} > br:last-child { display: none; }`,
  `details[data-dawn-quoted] ${ATTR} { margin: 0 0 4px !important; padding: 0 !important; border: 0 !important; font-size: 0.875em; color: var(--dawn-quoted-attr-color, color-mix(in srgb, currentColor 72%, transparent)); }`,
  // A quote first in the fold that is no box (its line no element of its
  // own): the thread's gap over it, as over a box.
  `details[data-dawn-quoted] > blockquote:not(:where(${BOX}, ${FOOT}))::before { content: ""; ${THREAD_GAP} }`,
  `details[data-dawn-quoted] hr { ${THREAD_GAP} }`,
  `details[data-dawn-quoted] :is(blockquote hr, hr${STEM_RULE}) { ${THREAD_STEM} }`,
  ...BOX_STYLE,
].join('\n');

/**
 * Stamps Dawn's semantic `data-dawn-quoted-*` markers across the folded
 * history so both `FOLD_STYLE` and headless (`style: false`) consumers style
 * every client's quotes uniformly without client-specific selectors.
 */
function markFold(fold: Element): void {
  const elements = Array.from(fold.querySelectorAll('*')).filter(
    (element) =>
      !(
        element.parentElement === fold &&
        (element.tagName === 'SUMMARY' || element.tagName === 'STYLE')
      ),
  );
  markJoined(fold);
  const footToHead = markBoxesAndAttributions(elements);
  markHeaders(elements, fold);
  markStems(fold);
  markLast(fold, elements, footToHead);
}

/**
 * A forwarded quote wrapper that is all its parent's message, marked
 * `data-dawn-quoted-joined`: nothing to read between the parent's
 * attribution and it — a forward sent with no word of its own. It is no box
 * of its own: it carries on in the parent's, its line under the parent's.
 * Read here, not by style: a word written straight into a wrapper
 * (`Works for me.<br><div class="gmail_quote">`) is a text node, which no
 * selector sees.
 */
function markJoined(fold: Element): void {
  for (const quote of Array.from(fold.querySelectorAll('div.gmail_quote'))) {
    const parent = quote.parentElement?.closest('blockquote');
    if (!parent?.matches(':is(div.gmail_quote, .gmail_quote_container) > .gmail_attr + blockquote'))
      continue;
    if (nothingBefore(quote, parent)) quote.setAttribute('data-dawn-quoted-joined', '');
  }
}

/** Whether nothing to read stands before the node, up to `top`. */
function nothingBefore(node: Node, top: Node): boolean {
  for (let at: Node = node; at !== top; at = at.parentNode!) {
    for (let before = at.previousSibling; before; before = before.previousSibling) {
      if (!isBlank(before)) return false;
    }
  }
  return true;
}

/**
 * Marks attribution lines (`data-dawn-quoted-attr`), two-part boxes
 * (`data-dawn-quoted-head` + `data-dawn-quoted-foot`), and single-element
 * boxes (`data-dawn-quoted-box`) across every supported client's markup.
 */
function markBoxesAndAttributions(elements: readonly Element[]): WeakMap<Element, Element> {
  const footToHead = new WeakMap<Element, Element>();

  for (const element of elements) {
    if (element.matches('.gmail_attr')) {
      element.setAttribute('data-dawn-quoted-attr', '');
      continue;
    }
    if (element.matches('.moz-cite-prefix')) {
      element.setAttribute('data-dawn-quoted-attr', '');
      const foot = adjacentBlockquote(element);
      if (foot) pairTwoPartBox(element, foot, footToHead);
      continue;
    }
    if (
      element.parentElement?.matches('.yahoo_quoted, .protonmail_quote') &&
      !previous(element) &&
      adjacentBlockquote(element)
    ) {
      element.setAttribute('data-dawn-quoted-attr', '');
      continue;
    }
    if (element.parentElement?.matches(WRAPPED) && !previous(element)) continue;
    const foot = adjacentBlockquote(element);
    if (foot && isAttribution(element)) {
      element.setAttribute('data-dawn-quoted-attr', '');
      pairTwoPartBox(element, foot, footToHead);
    }
  }

  for (const element of elements) {
    if (
      element.hasAttribute('data-dawn-quoted-joined') ||
      element.hasAttribute('data-dawn-quoted-foot')
    ) {
      continue;
    }
    if (isWrappedBox(element)) element.setAttribute('data-dawn-quoted-box', '');
  }

  return footToHead;
}

function pairTwoPartBox(head: Element, foot: Element, footToHead: WeakMap<Element, Element>): void {
  head.setAttribute('data-dawn-quoted-head', '');
  foot.setAttribute('data-dawn-quoted-foot', '');
  footToHead.set(foot, head);
}

/** Marks plain-text quoted headers (`isHeaderBlock`) — skipping anything
    already boxed, inside an attribution or known header container
    (`#divRplyFwdMsg`, Word's ruled header), or standing first inside a box
    that already provides padding. */
function markHeaders(elements: readonly Element[], fold: Element): void {
  for (const element of elements) {
    if (
      element.matches(BOXES) ||
      element.closest(`${ATTR}, ${HEADED}`) ||
      insideWordHeader(element, fold)
    ) {
      continue;
    }
    const enclosingBox = element.closest(BOX);
    if (enclosingBox && nothingBefore(element, enclosingBox)) continue;
    if (!isHeaderBlock(element)) continue;
    // A separator or attribution in a block of its own right over the fields
    // — or over the wrappers they open — goes with them: the gap sits over
    // that block, not between the two.
    const lead = lineBefore(opened(element, enclosingBox ?? fold));
    if (lead instanceof Element && HEADER_BLOCK_TAGS.has(lead.tagName) && isReplyMarkLine(lead)) {
      // First in a box, the box's padding is that gap already.
      if (!(enclosingBox && nothingBefore(lead, enclosingBox))) {
        lead.setAttribute('data-dawn-quoted-header', '');
      }
      continue;
    }
    // Prefer the tightest leading header block over a short mail wrapper around it.
    if (
      Array.from(element.querySelectorAll('*')).some(
        (child) => isHeaderBlock(child) && nothingBefore(child, element),
      )
    ) {
      continue;
    }
    // When a separator line stands in its own sibling block over the fields,
    // mark that leading block so the gap sits above it (never an inline tag
    // like `<b>`, where `margin-block-start` has no effect).
    const first = firstContentChild(element);
    if (
      first instanceof Element &&
      HEADER_BLOCK_TAGS.has(first.tagName) &&
      SEPARATOR_LINE.test((first.textContent ?? '').trim())
    ) {
      first.setAttribute('data-dawn-quoted-header', '');
    } else {
      element.setAttribute('data-dawn-quoted-header', '');
    }
  }
}

function insideWordHeader(element: Element, fold: Element): boolean {
  for (let at: Element | null = element; at && at !== fold; at = at.parentElement) {
    if (isWordHeader(at)) return true;
  }
  return false;
}

function firstContentChild(element: Element): ChildNode | null {
  let child = element.firstChild;
  while (child && isBlank(child)) child = child.nextSibling;
  return child;
}

/** Marks `<hr>` rules that follow a known unwrapped header container as
    vertical thread stems. */
function markStems(fold: Element): void {
  for (const hr of Array.from(fold.querySelectorAll(`${HEADED} ~ hr`))) {
    hr.setAttribute('data-dawn-quoted-stem', '');
  }
}

/** A `<blockquote>` immediately after `element` (with at most one `<br>`
    and blank text or comments between them — matching CSS's
    `+ blockquote, + br + blockquote`). */
function adjacentBlockquote(element: Element): Element | null {
  let next = element.nextSibling;
  let br = false;
  while (next) {
    if (next.nodeType === 3 && !(next.textContent ?? '').trim()) {
      next = next.nextSibling;
      continue;
    }
    if (next.nodeType === 8) {
      next = next.nextSibling;
      continue;
    }
    if (!br && next instanceof Element && next.tagName === 'BR') {
      br = true;
      next = next.nextSibling;
      continue;
    }
    return next instanceof Element && next.tagName === 'BLOCKQUOTE' ? next : null;
  }
  return null;
}

/** Whether `element` is a client-wrapped quoted message drawn as a
    single-element box. */
function isWrappedBox(element: Element): boolean {
  if (
    element.matches(
      'div.gmail_quote, .gmail_quote_container, .yahoo_quoted, .protonmail_quote, blockquote[type="cite"]',
    )
  ) {
    return true;
  }
  return (
    element.matches('blockquote.gmail_quote') &&
    !element.parentElement?.matches('div.gmail_quote, .gmail_quote_container')
  );
}

/**
 * Nested boxes that genuinely trail their enclosing box with no text node,
 * sibling or layout barrier in the way, marked `data-dawn-quoted-last`:
 * only those break out over their parent's sides and foot.
 */
function markLast(
  fold: Element,
  elements: readonly Element[],
  footToHead: WeakMap<Element, Element>,
): void {
  const isBox = (el: Element): boolean =>
    el.hasAttribute('data-dawn-quoted-box') || el.hasAttribute('data-dawn-quoted-foot');
  for (const element of elements) {
    if (!isBox(element)) continue;
    let outer: Element | null = null;
    for (let at = element.parentElement; at && at !== fold; at = at.parentElement) {
      if (isBox(at)) {
        outer = at;
        break;
      }
    }
    if (!outer) continue;
    if (!trails(element, outer) || hasLayoutBarrier(element, outer)) continue;
    element.setAttribute('data-dawn-quoted-last', '');
    footToHead.get(element)?.setAttribute('data-dawn-quoted-last', '');
  }
}

const BARRIER_TAGS = new Set([
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
  'UL',
  'OL',
  'LI',
]);

const SIDE_OR_FOOT_BOX =
  /^(?:padding|margin|border)(?:-(?:left|right|bottom|inline|inline-start|inline-end|block-end|width))?$/;

const ZERO_LENGTH = /^(?:0(?:[a-z%]+)?|none)$/i;

/** Whether an intermediate element between a nested box and its enclosing
    box offsets it from the outer box's padding box (a table, a list, or
    non-zero side/bottom padding, margin or border). */
function hasLayoutBarrier(box: Element, outer: Element): boolean {
  for (let at = box.parentElement; at && at !== outer; at = at.parentElement) {
    if (BARRIER_TAGS.has(at.tagName)) return true;
    // `blockquote` and joined Gmail quotes have their box styles zeroed by `FOLD_STYLE`.
    if (at.tagName === 'BLOCKQUOTE' || at.hasAttribute('data-dawn-quoted-joined')) continue;
    for (const { name, value } of parseDeclarations(at.getAttribute('style') ?? '')) {
      if (!SIDE_OR_FOOT_BOX.test(name)) continue;
      if (name === 'margin' || name === 'padding') {
        const parts = value.split(/\s+/);
        // 1 value sets all sides; 2+ values set sides/bottom from index 1 on.
        const sides = parts.length === 1 ? parts : parts.slice(1);
        if (sides.some((part) => !ZERO_LENGTH.test(part))) return true;
      } else if (!ZERO_LENGTH.test(value)) {
        return true;
      }
    }
  }
  return false;
}

/** What wraps a quoted history, by the client that wrote it. */
const WRAPPED =
  '.gmail_quote, .gmail_quote_container, .yahoo_quoted, .protonmail_quote, blockquote[type="cite"]';

/** What heads a history that runs on to the message's end, unwrapped.
    Never Outlook's `#appendonsend` alone: it marks where an answer would be
    appended, in a message that answers nothing too. */
const HEADED = '#divRplyFwdMsg, #mail-editor-reference-message-container';

/** Word's reply header: a line over From / Sent / To, Outlook's blue or
    grey, as Word writes it (`solid #E1E1E1 1.0pt`) or as it is written back
    (`1pt solid #e1e1e1`) — told from a newsletter's divider by the bold
    field names in it. */
const WORD_HEADER =
  /border-top:\s*(?:[\d.]+[a-z]*\s+)?solid\s+(?:[\d.]+[a-z]*\s+)?#(?:e1e1e1|b5c4df)\b/i;

/** Sender field labels across the languages mail clients write headers in. */
const FROM_LABELS =
  'from|von|de|da|van|från|fra|od|lähettäjä|от|від|差出人|发件人|寄件[者人]|보낸\\s*사람|kimden|feladó|de la|από|من|מאת';

/** Outlook/Word's "From:" header field, bold, in the languages Word writes
    it in — tells Word's reply header from a receipt or newsletter divider
    that shares the same `#e1e1e1` top rule with a bold label ("Total:",
    "Order ID:"). */
const FROM_FIELD = new RegExp(`^(?:${FROM_LABELS})\\s*[:：]$`, 'iu');

/** A header field line that opens a quoted mail written out as text —
    "Von: …", "From: …" — its value after it. */
const FROM_LINE = new RegExp(`^(?:${FROM_LABELS})\\s*[:：]\\s*\\S`, 'iu');

/** The subject field of such a header, in the same languages. */
const SUBJECT_LINE =
  /^(?:subject|betreff|objet|asunto|oggetto|onderwerp|ämne|emne|aihe|assunto|temat|předmět|predmet|тема|件名|主题|主旨|제목|konu|tárgy|subiect|θέμα|الموضوع|נושא)\s*[:：]/iu;

/** The date/sent field of a plain-text header, in the same languages. */
const DATE_LINE =
  /^(?:date|sent|datum|gesendet|envoyé|fecha|enviado|data|inviato|verzonden|skickat|dato|sendt|wysłano|dátum|odesláno|päiväys|päivämäärä|lähetetty|enviada|дата|отправлено|надіслано|日時|日付|送信日時|日期|发送时间|寄件日期|傳送時間|날짜|보낸\s*날짜|tarih|gönderildi|küldve|trimis|ημερομηνία|απεστάλη|التاريخ|تاريخ|תאריך|נשלח)\s*[:：]/iu;

/** The recipient field of a plain-text header, in the same languages. */
const TO_LINE =
  /^(?:to|an|à|pour|para|a|aan|till|til|do|komu|pro|pre|vastaanottaja|кому|宛先|收件[者人]|받는\s*사람|kime|címzett|către|προς|إلى|אל)\s*[:：]/iu;

/** The line some clients set over that header: "-----Original Message-----",
    "-----Ursprüngliche E-Mail-----", "---------- Forwarded message ---------",
    or Outlook's plain-text rule of underscores. */
const SEPARATOR_LINE = /^(?:-{2,}\s*[^-\s].{1,58}[^-\s]\s*-{2,}|_{10,})$/u;

/** Block elements that can hold an unwrapped plain-text header — never inline
    wrappers (`<font>`, `<span>`, `<b>`), blockquotes, or table/list items
    that cannot have `<details>` inserted beside them. */
const HEADER_BLOCK_TAGS = new Set([
  'DIV',
  'P',
  'SECTION',
  'ARTICLE',
  'ASIDE',
  'MAIN',
  'HEADER',
  'FOOTER',
  'CENTER',
  'ADDRESS',
  'PRE',
]);

/** Non-rendered element blocks stripped before measuring plain-text headers. */
const NON_CONTENT_BLOCK = /<(style|script|title|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** How far into a header its subject may come (From, Sent/Date, To, Cc,
    Bcc, Subject — and a line to spare). */
const HEADER_LINES = 8;

/** How long a header written out as text may be, at most: a block that long
    is the mail itself, not its header. */
const HEADER_LENGTH = 1000;

/**
 * A line that is an attribution, in the languages a client writes it in —
 * each a word of its own ("rewrote:" is none):
 * - the verb last: "On … Sam wrote:", "… a écrit :", "… escribió:";
 * - the verb before who: "Am … schrieb Monika:", "Op … schreef Jan:" —
 *   or before when: "Monika schrieb am 18.08.2026 um 10:12:";
 * - Japanese: the date first ("2026年8月18日 … :"), or "…書きました:".
 */
const ATTRIBUTIONS = [
  /(?<!\p{L})(?:wrote|écrit|escribió|scritto|napisał\(a\)|escreveu)\s*:\s*$/iu,
  /(?<!\p{L})(?:schrieb|schreef|skrev)(?!\p{L})(?:[^:：]|:\d{2}){0,120}[:：]\s*$/iu,
  /^\d{4}年\d{1,2}月\d{1,2}日.*[:：]\s*$/u,
  /(?:書きました|のメッセージ)\s*[:：]\s*$/u,
];

/** A whole line this long at most is an attribution, not a paragraph that
    happens to end on the word. */
const ATTRIBUTION_LENGTH = 200;

/** Where a `<details>` cannot stand: these hold only their own kind, and a
    parser moves anything else out of them. A history is never widened to
    one of their children (a cell, a row, a list's item). */
const HOLDS_ITS_OWN = new Set([
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'COLGROUP',
  'UL',
  'OL',
  'DL',
  'SELECT',
]);

/** Whether a history can be folded: a `<details>` can stand where it
    starts. A cell, a row or a list's item that is the quote itself cannot
    have one beside it — a parser moves it out, empty — so such a history
    is neither folded nor split off. */
function foldable(history: readonly ChildNode[]): boolean {
  const parent = history[0]?.parentElement;
  return !!parent && !HOLDS_ITS_OWN.has(parent.tagName);
}

/**
 * The nodes of the trailing history, in order — moved nowhere yet: the
 * first of them and every sibling after it. None where the message quotes
 * nothing, quotes in the middle of its text, or is nothing but the quote.
 *
 * The first mark that makes one, in the message's order: a quote in the
 * middle of the text (answered under it) is no history, and does not stand
 * in the way of the one at the end.
 */
function trailingHistory(body: HTMLElement): ChildNode[] {
  for (const element of Array.from(body.querySelectorAll('*'))) {
    // What is quoted in a quote is that quote's own.
    if (element.parentElement?.closest(`blockquote, ${WRAPPED}`)) continue;
    const start = historyStart(element, body);
    if (!start) continue;
    const history = [start, ...following(start)];
    // An unfoldable mark (a table cell or list item) or an empty one folds
    // nothing away and does not stand in the way of a real history below.
    if (!foldable(history) || history.every(isBlank)) continue;
    // What is left without it: the message's own text, or nothing.
    const own = body.cloneNode(true) as HTMLElement;
    const kept = nodeAt(own, pathTo(body, start));
    for (const node of [kept, ...following(kept)]) node.remove();
    return isBlank(own) ? [] : history;
  }
  return [];
}

/** Where the history this element marks starts — its first node, the
    attribution line over it included — or null where it marks none. */
function historyStart(element: Element, body: HTMLElement): ChildNode | null {
  // A wrapped quote or blockquote is a history only at the message's end —
  // never via `isHeaderBlock`, even when a short forward opens with headers.
  if (element.matches(WRAPPED) || element.tagName === 'BLOCKQUOTE') {
    if (!(element.matches(WRAPPED) || isAttributed(element)) || !trails(element, body)) return null;
    const line = lineBefore(element);
    return rise(line && isAttribution(line) ? line : element, body);
  }
  // What follows an unwrapped header is the answered mail, to the end.
  if (element.matches(HEADED) || isWordHeader(element)) return rise(element, body);
  if (isHeaderBlock(element) && headsQuote(element, body)) {
    // A reply's mark on a line of its own over the header — or over the
    // wrappers the header opens — goes with it.
    const line = lineBefore(opened(element, body));
    return rise(line && isReplyMarkLine(line) ? line : element, body);
  }
  return null;
}

/**
 * Whether a plain-text header heads a quoted mail, not a notification's
 * fields ("New ticket: From / Date / To / Subject"): a separator line opens
 * it, or a reply's mark stands right over it — a rule, a separator line, or
 * an attribution line, its colon optional (WEB.DE's "Am 17.11.26 um 11:19
 * schrieb Kanzlei Novak" has none). What stands over it is the last line
 * before it, out through the wrappers it opens.
 */
function headsQuote(element: Element, body: HTMLElement): boolean {
  if (SEPARATOR_LINE.test(linesOf(element)[0] ?? '')) return true;
  for (let at: Element | null = element; at && at !== body; at = at.parentElement) {
    for (let before = at.previousSibling; before; before = before.previousSibling) {
      if (isRule(before)) return true;
      if (isBlank(before)) continue;
      const lines =
        before instanceof Element ? linesOf(before) : [(before.textContent ?? '').trim()];
      return isReplyMark(lines[lines.length - 1] ?? '');
    }
  }
  return false;
}

/** A rule: an `<hr>`, or a block that holds nothing else (`<div><hr></div>`). */
function isRule(node: ChildNode): boolean {
  if (!(node instanceof Element)) return false;
  return node.tagName === 'HR' || (isBlank(node) && node.querySelector('hr') !== null);
}

/** A node that is a reply's mark and nothing else: one line, a separator
    or an attribution. */
function isReplyMarkLine(node: ChildNode): boolean {
  if (node instanceof Element && !isOneLine(node)) return false;
  return isReplyMark((node.textContent ?? '').trim());
}

/** A line that marks a reply: a separator, or an attribution with or
    without its closing colon. */
function isReplyMark(line: string): boolean {
  if (SEPARATOR_LINE.test(line)) return true;
  if (line.length > ATTRIBUTION_LENGTH) return false;
  const closed = /[:：]\s*$/u.test(line) ? line : `${line}:`;
  return ATTRIBUTIONS.some((form) => form.test(closed));
}

function isWordHeader(element: Element): boolean {
  return (
    WORD_HEADER.test(element.getAttribute('style') ?? '') &&
    Array.from(element.querySelectorAll('b, strong')).some((bold) =>
      FROM_FIELD.test((bold.textContent ?? '').trim()),
    )
  );
}

/**
 * A quoted mail's header written out as plain text, in a block of its own —
 * no class, no id, no rule over it: "Von: … / Datum: … / An: … / Betreff: …"
 * as WEB.DE's and GMX's apps write it, and Outlook's plain
 * "-----Original Message-----" over the same fields. Without a separator
 * line, all four standard fields (From, Date/Sent, To, Subject) are required
 * so ticket and contact-form summaries stay untouched; with a separator line,
 * From + Subject + Date/To suffice. A block much longer than a header is the
 * mail round it, not the header.
 */
function isHeaderBlock(element: Element): boolean {
  if (!HEADER_BLOCK_TAGS.has(element.tagName) || element.matches(WRAPPED)) return false;
  // A wrapper whose leading content is a wrapped quote or blockquote belongs
  // to that quote's trailing check, never to the unwrapped header path.
  if (
    Array.from(element.querySelectorAll(`blockquote, ${WRAPPED}`)).some((quote) =>
      nothingBefore(quote, element),
    )
  ) {
    return false;
  }
  const hasNonContent = element.querySelector('style, script, title, noscript') !== null;
  if (!hasNonContent) {
    const text = element.textContent ?? '';
    if (text.length > HEADER_LENGTH || (!text.includes(':') && !text.includes('：'))) return false;
  }
  const lines = linesOf(element);
  if (hasNonContent && lines.reduce((sum, line) => sum + line.length, 0) > HEADER_LENGTH) {
    return false;
  }
  const hasSeparator = SEPARATOR_LINE.test(lines[0] ?? '');
  const from = hasSeparator ? 1 : 0;
  if (!FROM_LINE.test(lines[from] ?? '')) return false;
  const rest = lines.slice(from + 1, from + HEADER_LINES);
  if (!rest.some((line) => SUBJECT_LINE.test(line))) return false;
  const hasDate = rest.some((line) => DATE_LINE.test(line));
  const hasTo = rest.some((line) => TO_LINE.test(line));
  return hasSeparator ? hasDate || hasTo : hasDate && hasTo;
}

/** An element's text, a line at a time: split at its line breaks and its
    blocks' edges, non-rendered blocks and blank lines dropped. */
function linesOf(element: Element): string[] {
  return element.innerHTML
    .replace(NON_CONTENT_BLOCK, '')
    .split(BREAKS)
    .map((line) =>
      line
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .trim(),
    )
    .filter(Boolean);
}

/** A plain `<blockquote>` under an attribution line: a client that marks
    its quote no other way. */
function isAttributed(element: Element): boolean {
  if (element.tagName !== 'BLOCKQUOTE') return false;
  const before = lineBefore(element);
  return !!before && isAttribution(before);
}

/** Whether the node is an attribution line, and nothing else: a block that
    holds the answer's own text over the line ("Thanks.<br>On … wrote:") is
    the answer's, and stays in sight. */
function isAttribution(node: ChildNode): boolean {
  if (node instanceof Element && node.matches('.gmail_attr, .moz-cite-prefix')) return true;
  if (node instanceof Element && !isOneLine(node)) return false;
  const text = (node.textContent ?? '').trim();
  return text.length <= ATTRIBUTION_LENGTH && ATTRIBUTIONS.some((form) => form.test(text));
}

/** Whether an element holds one line of text at most, and nothing but
    text: no line break, block start or block end with text on both sides of
    it — `Thanks.<div>On … wrote:</div>` is two lines, as an editor writes
    them — and no picture (a signature's). */
function isOneLine(element: Element): boolean {
  if (element.querySelector('img')) return false;
  const lines = element.innerHTML.split(BREAKS).filter((line) =>
    line
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim(),
  );
  return lines.length <= 1;
}

/** Where one line ends and the next starts: a line break, or a block's
    start or end. */
const BREAKS =
  /<br\b[^>]*>|<\/?(?:div|p|li|h[1-6]|tr|blockquote|section|article|table|ul|ol)\b[^>]*>/i;

/** The node before this one that holds anything — none across a rule: what
    stands over an `<hr>` is not this quote's line. */
function lineBefore(node: ChildNode): ChildNode | null {
  let before = node.previousSibling;
  while (before && isBlank(before)) {
    if (before instanceof Element && before.tagName === 'HR') return null;
    before = before.previousSibling;
  }
  return before;
}

/** The node before this one that holds anything. */
function previous(node: ChildNode): ChildNode | null {
  let before = node.previousSibling;
  while (before && isBlank(before)) before = before.previousSibling;
  return before;
}

/** The outermost wrapper the node opens, up to `top`: out of each parent it
    stands first in. Stops where something stands before it, and inside a
    cell or a list's item: beside those, nothing but their own kind can
    stand. */
function opened(start: ChildNode, top: Element): ChildNode {
  let from = start;
  while (
    from.parentElement &&
    from.parentElement !== top &&
    !HOLDS_ITS_OWN.has(from.parentElement.parentElement?.tagName ?? '') &&
    !previous(from)
  ) {
    from = from.parentElement;
  }
  return from;
}

/** Out of the wrappers a history is the whole of (`opened`): a `<div>`
    round the quote alone is the history too. */
function rise(start: ChildNode, body: HTMLElement): ChildNode {
  let from = opened(start, body);
  // Blank lines over it go with it — Outlook's rule and the empty mark it
  // leaves where the answer was appended too: the gap is the history's,
  // not the text's. Non-content tags (`<style>`, `<meta>`) stay in place.
  while (
    from.previousSibling &&
    isBlank(from.previousSibling) &&
    !(from.previousSibling instanceof Element && NON_CONTENT.has(from.previousSibling.tagName)) &&
    previous(from)
  ) {
    from = from.previousSibling;
  }
  return from;
}

/** Whether nothing but blank follows the node, up to `root`. */
function trails(node: ChildNode, root: Element): boolean {
  for (let at: Node = node; at !== root; at = at.parentNode as Node) {
    if (following(at as ChildNode).some((after) => !isBlank(after))) return false;
    if (!at.parentNode) return false;
  }
  return true;
}

function following(node: ChildNode): ChildNode[] {
  const after: ChildNode[] = [];
  for (let next = node.nextSibling; next; next = next.nextSibling) after.push(next);
  return after;
}

/** Elements inside `<body>` whose text is never read by the recipient. */
const NON_CONTENT = new Set(['STYLE', 'SCRIPT', 'TITLE', 'NOSCRIPT', 'META', 'LINK']);

/** Holds nothing to read: no text, no picture — line breaks, empty blocks,
    a comment, a rule, or non-rendered metadata (`<style>`, `<script>`). */
function isBlank(node: Node): boolean {
  if (node.nodeType === 3) return !(node.textContent ?? '').trim();
  if (node.nodeType !== 1) return true;
  const element = node as Element;
  if (NON_CONTENT.has(element.tagName)) return true;
  if (element.tagName === 'IMG') return false;
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (!isBlank(child)) return false;
  }
  return true;
}

/** A node's place under `root`: its index at each level down. */
function pathTo(root: Node, node: Node): number[] {
  const path: number[] = [];
  for (let at = node; at !== root; at = at.parentNode as Node) {
    path.unshift(Array.prototype.indexOf.call(at.parentNode!.childNodes, at));
  }
  return path;
}

function nodeAt(root: Node, path: readonly number[]): ChildNode {
  return path.reduce<Node>((at, index) => at.childNodes[index]!, root) as ChildNode;
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(
    hasDocumentEnvelope(html) ? html : `<body>${html}`,
    'text/html',
  );
}

/** The message as it came: a whole document whole, a fragment a fragment. */
function serialize(message: Document, source: string): string {
  return hasDocumentEnvelope(source)
    ? '<!doctype html>' + message.documentElement.outerHTML
    : message.body.innerHTML;
}
