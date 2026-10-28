/**
 * A style attribute read as its own text — never through the CSSOM, which
 * engines read differently (a server's DOM most of all).
 */

export interface Declaration {
  name: string;
  value: string;
  important: boolean;
}

/** A style attribute's declarations: split on `;` outside parentheses and
    quotes (a `url(data:…;base64,…)` holds one), names lower-cased,
    `!important` lifted off the value. Empty and nameless parts dropped. */
export function parseDeclarations(style: string): Declaration[] {
  const declarations: Declaration[] = [];
  for (const text of splitDeclarations(style)) {
    const colon = text.indexOf(':');
    if (colon < 0) continue;
    const name = text.slice(0, colon).trim().toLowerCase();
    let value = text.slice(colon + 1).trim();
    const important = /!\s*important$/i.test(value);
    if (important) value = value.replace(/!\s*important$/i, '').trim();
    if (!name || !value) continue;
    declarations.push({ name, value, important });
  }
  return declarations;
}

function splitDeclarations(style: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < style.length; i++) {
    const ch = style[i];
    if (quote) {
      if (ch === quote && style[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      parts.push(style.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(style.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}
