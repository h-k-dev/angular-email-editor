/**
 * Authored markup on real editor nodes.
 *
 * In the `email` parse mode, a text line, heading or image written by someone
 * else (MJML's `<div style="font-family:Ubuntu…;font-size:11px">`, a template's
 * `<img … height="auto">`) becomes the composer's own node — editable with
 * every command — while its tag and attributes ride along **exactly as
 * authored** in an `html` attribute. The node renders and serializes from
 * that markup; only the values the composer models (an image's `src`/`alt`,
 * a line's alignment) are written back into it when edited.
 *
 * `html` is `null` for the composer's own canonical output — which is why the
 * golden corpus stays byte-identical: canonical markup never carries it.
 */
import { Node } from 'prosemirror-model';
import { AttributePairs, verbatimElement } from './preserve';
import { declarationProperty, splitDeclarations } from './email-vocabulary';

export interface AuthoredMarkup {
  /** Lower-cased tag name as authored (`div`, `p`, `h2`, `img`). */
  tag: string;
  /** Attributes verbatim, in authored order. */
  attrs: AttributePairs;
}

/** The node attribute holding authored markup; spread into a node's `attrs`. */
export const AUTHORED_ATTRS = { html: { default: null } };

export function authoredMarkup(node: Node): AuthoredMarkup | null {
  return (node.attrs['html'] as AuthoredMarkup | null | undefined) ?? null;
}

/**
 * The authored element, with modelled values written back: an override
 * replaces an existing attribute in place, `null` removes it, and an override
 * the markup lacks is appended.
 */
export function renderAuthored(
  markup: AuthoredMarkup,
  content: boolean,
  overrides: Record<string, string | null | undefined> = {},
): { dom: HTMLElement; contentDOM?: HTMLElement } {
  const pairs: [string, string | null | undefined][] = markup.attrs.map(([name, value]) =>
    name in overrides ? [name, overrides[name]] : [name, value],
  );
  for (const [name, value] of Object.entries(overrides)) {
    if (!markup.attrs.some(([existing]) => existing === name)) pairs.push([name, value]);
  }
  return verbatimElement(markup.tag, pairs, content);
}

/** The value of one attribute of the markup, or null. */
export function authoredAttribute(markup: AuthoredMarkup, name: string): string | null {
  return markup.attrs.find(([existing]) => existing === name)?.[1] ?? null;
}

/**
 * Sets one CSS declaration in the markup's `style`, touching nothing else:
 * an existing declaration keeps its place and spacing, a new one is appended
 * in the style's own punctuation (`a:b;` stays compact, `a: b;` stays spaced).
 */
export function withStyleDeclaration(
  markup: AuthoredMarkup,
  property: string,
  value: string,
): AuthoredMarkup {
  const style = authoredAttribute(markup, 'style');
  let next: string;
  if (style === null || !style.trim()) {
    next = `${property}: ${value};`;
  } else {
    const parts = splitDeclarations(style);
    const index = parts.findIndex((part) => declarationProperty(part) === property);
    if (index >= 0) {
      const part = parts[index];
      const colon = part.indexOf(':');
      const spacing = /^\s*/.exec(part.slice(colon + 1))![0];
      const trailing = /\s*$/.exec(part)![0];
      parts[index] = `${part.slice(0, colon + 1)}${spacing}${value}${trailing}`;
      next = parts.join(';');
    } else {
      const compact = !/:\s/.test(style);
      const declaration = compact ? `${property}:${value};` : `${property}: ${value};`;
      const base = style.trimEnd();
      next = base.endsWith(';')
        ? `${base}${compact ? '' : ' '}${declaration}`
        : `${base}; ${declaration}`;
    }
  }
  return withAttribute(markup, 'style', next);
}

/** Sets one attribute, in place when present, appended otherwise. */
export function withAttribute(markup: AuthoredMarkup, name: string, value: string): AuthoredMarkup {
  const exists = markup.attrs.some(([existing]) => existing === name);
  return {
    tag: markup.tag,
    attrs: exists
      ? markup.attrs.map(([existing, old]) => [existing, existing === name ? value : old])
      : [...markup.attrs, [name, value]],
  };
}

/** The markup minus attributes that must stay unique (`id`) — for a block
    split off an authored one, which inherits everything else. */
export function inheritedMarkup(markup: AuthoredMarkup): AuthoredMarkup {
  return { tag: markup.tag, attrs: markup.attrs.filter(([name]) => name !== 'id') };
}
