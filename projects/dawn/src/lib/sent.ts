import { parseDeclarations } from './style-text';

/*
 * The email as sent: what a fragment (the editor's canonical HTML) becomes
 * in the body of the sent document — and so what Dawn and the client
 * simulations draw of a fragment, so a preview is the email.
 */

/**
 * The class a stacking column carries in the sent email — the hook of the
 * one rule the email document's head holds ({@link STACK_RULE}): on a phone
 * a stacked column takes the whole width instead of its desktop cap. Where
 * a client drops the head, the column keeps its cap: narrower, still whole.
 * The editor's HTML never carries it ({@link markStackingColumns} adds it
 * at send), so the canonical form stays class-free.
 */
export const STACK_CLASS = 'aee-stack';

/** The phone rule for {@link STACK_CLASS} — MJML's breakpoint. */
export const STACK_RULE =
  `@media only screen and (max-width: 479px) { ` +
  `.${STACK_CLASS} { max-width: 100% !important; } }`;

/** The opening of a stacking column as the editor writes it (its
    `columnStyle`), its layout marker first — a held column's `width` is a
    percentage, and never matches. */
const STACKING_COLUMN =
  /<div (?:class="([^"]*)" )?style="display: inline-block; width: 100%; max-width: \d+px;/g;

/** Canonical HTML with every stacking column carrying {@link STACK_CLASS}
    beside its marker — for the email document only. */
export function markStackingColumns(html: string): string {
  return html.replace(STACKING_COLUMN, (open, classes: string | undefined) =>
    classes === undefined
      ? open.replace('<div style=', `<div class="${STACK_CLASS}" style=`)
      : open.replace(`class="${classes}"`, `class="${classes} ${STACK_CLASS}"`),
  );
}

/** The tags a line of the email is written in — what an image can stand
    alone on. */
const LINE_TAGS = new Set(['DIV', 'P', 'TD', 'TH', 'LI', 'H1', 'H2', 'H3', 'H4']);

/** Whether `node` is nothing a reader would see beside an image: blank
    text, a comment. */
const isBlank = (node: globalThis.Node): boolean =>
  node.nodeType === 8 || (node.nodeType === 3 && !(node.textContent ?? '').trim());

/** The line `image` stands alone on — itself, or the one link round it, the
    only thing there — or null where it shares its line. */
function soleLineOf(image: HTMLImageElement): HTMLElement | null {
  let box: HTMLElement = image;
  const parent = image.parentElement;
  if (
    parent?.tagName === 'A' &&
    Array.from(parent.childNodes).every((n) => n === image || isBlank(n))
  ) {
    box = parent;
  }
  const line = box.parentElement;
  if (!line || !LINE_TAGS.has(line.tagName)) return null;
  return Array.from(line.childNodes).every((n) => n === box || isBlank(n)) ? line : null;
}

/** A line's alignment, as a client reads it: its `text-align`, else its
    legacy `align`. */
function alignmentOfLine(line: HTMLElement): string | null {
  const declared = parseDeclarations(line.getAttribute('style') ?? '').filter(
    ({ name }) => name === 'text-align',
  );
  return (declared.at(-1)?.value ?? line.getAttribute('align') ?? '').trim().toLowerCase() || null;
}

/** Appends declarations to an element's style text — as text, never
    through the CSSOM — leaving the ones it already says alone. */
function addStyle(element: Element, declarations: [name: string, value: string][]): void {
  const style = element.getAttribute('style') ?? '';
  const said = new Set(parseDeclarations(style).map(({ name }) => name));
  const added = declarations.filter(([name]) => !said.has(name)).map(([n, v]) => `${n}: ${v};`);
  if (!added.length) return;
  const base = style.trim();
  element.setAttribute(
    'style',
    `${base}${base && !base.endsWith(';') ? ';' : ''}${base ? ' ' : ''}${added.join(' ')}`,
  );
}

/**
 * The images of the email as sent, made what Outlook and the rest draw
 * cleanly — for the email document only; the editor's HTML stays as it is
 * (`emailDocument` runs this, as it adds the columns' stacking class).
 *
 * - **No border**: Outlook draws a link's border round a linked image unless
 *   told not to — `border="0"` for its Word engine, `border: 0` for the rest.
 * - **No gap under one alone on its line** (a logo, a banner, a linked
 *   picture): an inline image sits on the line's baseline, and the room for
 *   the letters' descenders shows under it as a few px of the line's
 *   colour. Alone on its line, it is a block instead (`display: block`),
 *   kept where the line put it — centred or right by auto margins, the
 *   line's `text-align` no longer reaching a block. An image sharing its
 *   line with words stays inline: a block would break the line.
 *
 * Idempotent: what an image already says it keeps.
 */
export function fitEmailImages(html: string): string {
  if (!/<img\b/i.test(html)) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const image of Array.from(template.content.querySelectorAll('img'))) {
    if (!image.hasAttribute('border')) image.setAttribute('border', '0');
    addStyle(image, [['border', '0']]);
    const line = soleLineOf(image);
    if (!line) continue;
    const align = alignmentOfLine(line);
    addStyle(image, [
      ['display', 'block'],
      ...(align === 'center'
        ? ([
            ['margin-left', 'auto'],
            ['margin-right', 'auto'],
          ] as [string, string][])
        : align === 'right'
          ? ([['margin-left', 'auto']] as [string, string][])
          : []),
    ]);
  }
  return template.innerHTML;
}

/**
 * The editor's canonical HTML as {@link emailDocument} puts it in the body:
 * images first — no border, and no gap under one alone on its line
 * (image.ts) — then the columns' stacking class, by pattern, on the markup
 * as the editor wrote it. The head's {@link STACK_RULE} is what that class
 * hangs on. Anything that draws a fragment as it is sent (client-rendering.ts)
 * takes both, so a preview stacks a phone's columns as the email does.
 */
export function sentBody(html: string): string {
  return markStackingColumns(fitEmailImages(html));
}
