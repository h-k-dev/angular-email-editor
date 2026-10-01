/**
 * Line folding for sending — the HTML as compact as ever, its lines kept
 * short enough to survive any transport.
 *
 * RFC 5322 caps a line at 998 octets. A mailer that sends the HTML part
 * quoted-printable or base64 never meets the cap; one that sends it 7bit or
 * 8bit lets a relay cut a longer line wherever it reaches the cap — inside a
 * tag, inside a word — which is where the stray `!` and the broken layout of
 * a forwarded Exchange mail come from. Our serialized body is one line.
 *
 * **Two edits only**, both whitespace the HTML tokenizer ignores:
 * - a space or tab *between the attributes of a start tag* becomes a line
 *   break;
 * - where a line has no such space (MJML's runs of Outlook conditionals and
 *   end tags), a line break goes right before the `>` that closes a tag —
 *   `</td⏎>` is `</td>`, Prettier prints it — never after a `/`, where it
 *   would undo a self-closing slash.
 *
 * Never touched: text (its spaces may be `pre`), attribute values, comments
 * (Outlook's conditional ones are markup to Outlook, kept byte for byte),
 * doctypes, CDATA, processing instructions, the content of raw text
 * elements (`style`, `title`, `textarea`, `noscript`, …) — and *anything*
 * after `<svg>`, `<math>`, `<script>` or `<plaintext>`: in foreign content
 * other elements hold raw text, a script's end hides behind escapes, and
 * where they end takes the parser's whole tree, not a tokenizer. A line with
 * nowhere to fold stays long — a transport encoding carries it.
 *
 * The tokenizer is the HTML standard's (§13.2.5) in every state a fold
 * depends on — tag and attribute states, where `<` opens a tag, the end of
 * a comment, of raw text. Where it is unsure it folds nothing: a missed fold
 * costs a long line, a wrong one the email.
 */

/** Default fold width, in octets: well inside the 998 RFC 5322 allows,
    leaving room for a transport's CR and dot-stuffing. */
export const FOLD_WIDTH = 900;

/** HTML elements whose content the tokenizer reads as text (RAWTEXT and
    RCDATA), up to their own end tag. */
const RAW_TEXT = new Set([
  'style',
  'title',
  'textarea',
  'noscript',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
]);

/** Elements past which folding stops for good — see above. */
const STOP = new Set(['svg', 'math', 'script', 'plaintext']);

type State =
  | 'data'
  | 'tagName'
  | 'beforeAttrName'
  | 'attrName'
  | 'afterAttrName'
  | 'beforeValue'
  | 'valueDq'
  | 'valueSq'
  | 'valueUnquoted'
  | 'afterValue'
  | 'selfClosing'
  | 'endTag'
  | 'comment'
  | 'bogus'
  | 'cdata'
  | 'rawText'
  | 'stopped';

const isAlpha = (char: string | undefined) => !!char && /^[A-Za-z]$/.test(char);
/** The tokenizer's whitespace: tab, LF, FF, space — CR is LF by then. */
const isSpace = (char: string) =>
  char === ' ' || char === '\t' || char === '\n' || char === '\f' || char === '\r';
const asciiLower = (text: string) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

const octetsOf = (char: string): number => {
  const code = char.codePointAt(0)!;
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
};

/**
 * `html` with its long lines folded — see above. Lines are measured in
 * octets (UTF-8); a line that fits is never touched, and folding twice
 * changes nothing.
 */
export function foldHTML(html: string, width = FOLD_WIDTH): string {
  const chars = Array.from(html);
  const out = chars.slice();
  // Widened on purpose: the closures below set it, which the compiler's
  // narrowing does not see.
  let state = 'data' as State;
  let tagName = '';
  let rawName = '';
  let commentStart = 0;
  let cdataClosed = false;
  let lineStart = 0;
  let lineOctets = 0;
  let foldAt = -1; // the last space of this line the tokenizer ignores
  let breakAt = -1; // the last `>` of this line a break may go before

  const at = (index: number, text: string) => chars.slice(index, index + text.length).join('') === text;

  /** A `>` closing a start tag: where a break may go before, as a last
      resort — not after a `/`, where it would undo the slash. Then the
      content: raw text, markup, or nothing more to fold. */
  const endStartTag = (i: number) => {
    if (chars[i - 1] !== '/') breakAt = i;
    if (STOP.has(tagName)) state = 'stopped';
    else if (RAW_TEXT.has(tagName)) {
      state = 'rawText';
      rawName = tagName;
    } else state = 'data';
  };

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    let foldable = false;

    switch (state) {
      case 'data':
        if (char !== '<') break;
        if (isAlpha(chars[i + 1])) {
          state = 'tagName';
          tagName = '';
        } else if (chars[i + 1] === '/' && isAlpha(chars[i + 2])) {
          state = 'endTag';
        } else if (at(i, '<!--')) {
          // The `!--` passes through the comment state like any character —
          // counted into the line, and no `>` among them.
          state = 'comment';
          commentStart = i + 4;
        } else if (at(i, '<![CDATA[')) {
          state = 'cdata';
          cdataClosed = chars.slice(i).join('').includes(']]>');
        } else if (chars[i + 1] === '!' || chars[i + 1] === '?' || chars[i + 1] === '/') {
          // A doctype, a processing instruction, `</ x>`, `</>`: to the `>`.
          state = 'bogus';
        }
        break;

      case 'tagName':
        if (isSpace(char)) {
          state = 'beforeAttrName';
          foldable = true;
        } else if (char === '/') state = 'selfClosing';
        else if (char === '>') endStartTag(i);
        else tagName += asciiLower(char);
        break;

      case 'beforeAttrName':
        if (isSpace(char)) foldable = true;
        else if (char === '/') state = 'selfClosing';
        else if (char === '>') endStartTag(i);
        // Anything else — `=` too — starts an attribute name.
        else state = 'attrName';
        break;

      case 'attrName':
        if (isSpace(char)) {
          state = 'afterAttrName';
          foldable = true;
        } else if (char === '/') state = 'selfClosing';
        else if (char === '=') state = 'beforeValue';
        else if (char === '>') endStartTag(i);
        break;

      case 'afterAttrName':
        if (isSpace(char)) foldable = true;
        else if (char === '/') state = 'selfClosing';
        else if (char === '=') state = 'beforeValue';
        else if (char === '>') endStartTag(i);
        else state = 'attrName';
        break;

      case 'beforeValue':
        if (isSpace(char)) foldable = true;
        else if (char === '"') state = 'valueDq';
        else if (char === "'") state = 'valueSq';
        else if (char === '>') endStartTag(i);
        else state = 'valueUnquoted';
        break;

      case 'valueDq':
        if (char === '"') state = 'afterValue';
        break;

      case 'valueSq':
        if (char === "'") state = 'afterValue';
        break;

      case 'valueUnquoted':
        if (isSpace(char)) {
          state = 'beforeAttrName';
          foldable = true;
        } else if (char === '>') endStartTag(i);
        break;

      case 'afterValue':
        if (isSpace(char)) {
          state = 'beforeAttrName';
          foldable = true;
        } else if (char === '/') state = 'selfClosing';
        else if (char === '>') endStartTag(i);
        else state = 'attrName'; // missing whitespace: reconsumed as a name
        break;

      case 'selfClosing':
        if (char === '>') endStartTag(i);
        else if (isSpace(char)) {
          state = 'beforeAttrName';
          foldable = true;
        } else state = 'attrName';
        break;

      case 'endTag':
        if (char === '>') {
          if (chars[i - 1] !== '/') breakAt = i;
          state = 'data';
        }
        break;

      case 'comment': {
        // `-->`, and the early endings: `<!-->`, `<!--->`, `--!>`.
        if (char !== '>') break;
        const inside = i - commentStart;
        if (
          inside === 0 ||
          (inside === 1 && chars[i - 1] === '-') ||
          (inside >= 2 && chars[i - 1] === '-' && chars[i - 2] === '-') ||
          (inside >= 3 && chars[i - 1] === '!' && chars[i - 2] === '-' && chars[i - 3] === '-')
        ) {
          state = 'data';
        }
        break;
      }

      case 'bogus':
        if (char === '>') state = 'data';
        break;

      case 'cdata':
        // In foreign content a CDATA section runs to `]]>`; in HTML it is a
        // bogus comment ending at the first `>`. Skipping to `]]>` folds less,
        // never wrongly; with no `]]>` at all, the first `>` it is.
        if (char === '>' && ((chars[i - 1] === ']' && chars[i - 2] === ']') || !cdataClosed)) {
          state = 'data';
        }
        break;

      case 'rawText': {
        // Only the element's own end tag ends it: `</` and its name, ASCII
        // case-insensitive, then whitespace, `/` or `>` — nothing else.
        if (char !== '<' || chars[i + 1] !== '/') break;
        const name = chars.slice(i + 2, i + 2 + rawName.length).join('');
        const after = chars[i + 2 + rawName.length];
        if (asciiLower(name) === rawName && after !== undefined && (isSpace(after) || after === '/' || after === '>')) {
          state = 'endTag';
        }
        break;
      }

      case 'stopped':
        break;
    }

    if (char === '\n') {
      lineStart = i + 1;
      lineOctets = 0;
      foldAt = -1;
      breakAt = -1;
      continue;
    }
    // Only a space or a tab is turned into a break: a form feed or carriage
    // return is ignorable too, but not worth the doubt.
    if (foldable && (char === ' ' || char === '\t')) foldAt = i;
    lineOctets += octetsOf(char);

    // Too wide: fold — and again, while it still is and a point is left. A
    // `>` after the space just folded at is in the new line, and still good.
    while (lineOctets > width) {
      if (foldAt >= lineStart) {
        // A space first: the break takes its place.
        out[foldAt] = '\n';
        lineStart = foldAt + 1;
        foldAt = -1;
      } else if (breakAt > lineStart) {
        // Else before a tag's `>`, which starts the next line.
        out[breakAt] = '\n>';
        lineStart = breakAt;
        breakAt = -1;
      } else break;
      lineOctets = 0;
      for (let j = lineStart; j <= i; j++) lineOctets += octetsOf(chars[j]);
    }
  }
  return out.join('');
}
