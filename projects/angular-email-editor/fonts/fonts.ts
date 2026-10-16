/**
 * The fonts an email is written in — Gmail's set, in Gmail's order — as
 * plain data: no Angular, no ProseMirror. The editor's `textStyle` mark
 * stores and emits only these stacks, the toolbar offers them, and an
 * editor of another kind (summernote's `fontNames`) can offer the same set
 * from the same constant, so a message reads the same font whichever
 * composer wrote it.
 */

/**
 * A client a font is checked against — the three a writer's recipients
 * mostly read in, the same ids as the library's `RenderingClient`.
 */
export type FontClient = 'gmail' | 'apple-mail' | 'outlook-desktop';

/** The clients, in the order a picker shows them (G, A, O), with the letter
    and name it shows them by. */
export const fontClients: readonly { id: FontClient; letter: string; name: string }[] = [
  { id: 'gmail', letter: 'G', name: 'Gmail' },
  { id: 'apple-mail', letter: 'A', name: 'Apple Mail' },
  { id: 'outlook-desktop', letter: 'O', name: 'Outlook' },
];

/** A font the editor offers: one of {@link emailFontFamilies}. */
export interface EmailFont {
  /** Stable, for a host's translation key: `sans-serif`, `fixed-width`, … */
  readonly id: string;
  /** The label, in English — Gmail's words. */
  readonly name: string;
  /**
   * The exact `font-family` value emitted — the canonical stored form. A
   * family name of more than one word is double-quoted: the CSSOM (Chrome's
   * and jsdom's alike) quotes it on reserialization, so the stored bytes are
   * already what comes back and a round trip is stable.
   */
  readonly stack: string;
  /** The face the stack is for — its first family, unquoted: what an editor
      that sets a single family (summernote) offers for it. */
  readonly face: string;
  /**
   * The clients that draw the face itself rather than its fallback — the
   * face is on the machine the client runs on:
   *
   * - `gmail`: Gmail on the web, read on Windows or macOS (it draws with
   *   the reader's own fonts; one of them lacking the face is a no).
   * - `apple-mail`: Apple Mail on macOS *and* iOS — a phone lacks Arial
   *   Black, Comic Sans, Tahoma.
   * - `outlook-desktop`: Outlook on Windows, which brings Office's fonts
   *   (Arial Narrow, Garamond).
   *
   * Elsewhere the stack's fallback draws: the email still reads, in a near
   * face. Curated, conservative — a face only some readers have is a no.
   */
  readonly clients: readonly FontClient[];
}

/** The family names of a `font-family` value, unquoted, in order. */
function familiesOf(stack: string): string[] {
  return stack
    .split(',')
    .map((family) => family.replace(/["']/g, '').trim())
    .filter(Boolean);
}

const G: FontClient = 'gmail';
const A: FontClient = 'apple-mail';
const O: FontClient = 'outlook-desktop';

function font(id: string, name: string, stack: string, clients: FontClient[]): EmailFont {
  return { id, name, stack, face: familiesOf(stack)[0], clients };
}

/**
 * Gmail's fonts, in its menu's order. A stack is the face, then what a
 * client without it should draw instead, then the generic. Each face leads
 * only its own stack, so a single family read back from another editor
 * (`font-family: 'Arial Black'`) finds its font exactly.
 *
 * The first stack naming a family claims it (see {@link matchEmailFont}):
 * `helvetica` and `sans-serif` read as Sans Serif, `times` and `serif` as
 * Serif, `courier` and `monospace` as Fixed width.
 */
export const emailFontFamilies: readonly EmailFont[] = [
  font('sans-serif', 'Sans Serif', 'Arial, Helvetica, sans-serif', [G, A, O]),
  font('serif', 'Serif', '"Times New Roman", Times, serif', [G, A, O]),
  font('fixed-width', 'Fixed width', '"Courier New", Courier, monospace', [G, A, O]),
  // Not on iOS.
  font('wide', 'Wide', '"Arial Black", sans-serif', [G, O]),
  // Office's, not Windows' own — nor on iOS.
  font('narrow', 'Narrow', '"Arial Narrow", sans-serif', [O]),
  // Not on iOS.
  font('comic-sans-ms', 'Comic Sans MS', '"Comic Sans MS", sans-serif', [G, O]),
  // Office's only: neither macOS, iOS nor Windows itself has it.
  font('garamond', 'Garamond', 'Garamond, "Times New Roman", serif', [O]),
  font('georgia', 'Georgia', 'Georgia, serif', [G, A, O]),
  // Not on iOS.
  font('tahoma', 'Tahoma', 'Tahoma, sans-serif', [G, O]),
  font('trebuchet-ms', 'Trebuchet MS', '"Trebuchet MS", sans-serif', [G, A, O]),
  font('verdana', 'Verdana', 'Verdana, sans-serif', [G, A, O]),
];

/**
 * The font a message is written in until the writer picks another — Gmail's
 * Sans Serif, Arial. Nothing is emitted for it: unstyled text is drawn in
 * the client's own default, as Gmail's is. An editor shows it as its
 * surface font, so what is written looks as it will in Gmail; summernote
 * takes its face (`fontName: emailDefaultFont.face`).
 */
export const emailDefaultFont: EmailFont = emailFontFamilies[0];

/**
 * The faces of {@link emailFontFamilies}, in order — the set for an editor
 * that offers single families. For summernote, both lists: `fontNamesIgnoreCheck`
 * keeps a face this machine lacks (Garamond, Arial Narrow) in the menu.
 *
 * ```ts
 * $('#editor').summernote({ fontNames: emailFontFaces, fontNamesIgnoreCheck: emailFontFaces });
 * ```
 */
export const emailFontFaces: readonly string[] = emailFontFamilies.map((f) => f.face);

/** Every size the editor stores, in px. */
export const allowedFontSizes = [10, 12, 14, 16, 18, 24, 32] as const;
export type FontSize = (typeof allowedFontSizes)[number];

/**
 * The sizes a picker offers: the phone-safe subset (≥14px). Below ~13px iOS
 * auto-inflates text and reflows the layout, so they are not *offered* —
 * but every {@link allowedFontSizes} size is still read and kept, because a
 * hand-typed size in the HTML source is the author's own responsibility.
 */
export const emailFontSizes: readonly FontSize[] = [14, 16, 18, 24, 32];

/** A `font-family` value as a comparison key: lower-cased, quotes dropped,
    whitespace around commas collapsed — so a hand-typed or CSSOM-reserialized
    stack matches a curated one regardless of cosmetic differences. */
export function fontFamilyKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s*,\s*/g, ',')
    .trim();
}

const FONT_BY_KEY = new Map(emailFontFamilies.map((f) => [fontFamilyKey(f.stack), f]));

/** Each family a stack names to the first stack naming it. */
const FONT_BY_FAMILY = new Map<string, EmailFont>();
for (const f of emailFontFamilies) {
  for (const family of fontFamilyKey(f.stack).split(',')) {
    if (!FONT_BY_FAMILY.has(family)) FONT_BY_FAMILY.set(family, f);
  }
}

/** Whether `value` is exactly one of the stacks, give or take quotes, case
    and spacing. */
export function isEmailFontStack(value: unknown): value is string {
  return typeof value === 'string' && FONT_BY_KEY.has(fontFamilyKey(value));
}

/**
 * The font a `font-family` value is. One of the stacks is itself; a stack of
 * someone else's is the font it falls back to — the first of its families a
 * stack names, its generic last: a builder's web font (`Ubuntu, Helvetica,
 * Arial, sans-serif`) is Sans Serif, the face a client without that font
 * draws anyway, and summernote's `'Comic Sans MS'` is Comic Sans MS.
 * Nothing to fall back to, no font.
 */
export function matchEmailFont(raw: string | null | undefined): EmailFont | null {
  if (!raw) return null;
  const key = fontFamilyKey(raw);
  const exact = FONT_BY_KEY.get(key);
  if (exact) return exact;
  for (const family of key.split(',')) {
    const found = FONT_BY_FAMILY.get(family.trim());
    if (found) return found;
  }
  return null;
}
