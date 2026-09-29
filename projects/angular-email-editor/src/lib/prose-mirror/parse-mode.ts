import { ParseRule, TagParseRule } from 'prosemirror-model';

/**
 * How markup is parsed through the schema.
 *
 * - `email` — the default for everything a host or the source pane hands the
 *   editor. Every tag, attribute and CSS property that Apple Mail, Outlook or
 *   Gmail applies is recognized and kept **exactly as authored** (see
 *   `email-vocabulary.ts`): MJML's output, a hand-built table template, the
 *   document envelope, Outlook conditional comments. Text lines, headings and
 *   images become real editor nodes carrying their authored attributes;
 *   layout structure stays structure. Anything no floor client applies is
 *   dropped.
 * - `preserve` — the opt-in for special needs: like `email`, but nothing is
 *   dropped for being outside the vocabulary (custom elements, `data-*`,
 *   framework attributes, invented CSS). Executable content is still refused.
 * - `repair` — the schema is law: markup is rewritten into the composer's
 *   canonical form. The clipboard and the reply/forward/import seeds use it —
 *   pasted Word or Docs markup is cleaned, not kept.
 */
export type ParseMode = 'email' | 'preserve' | 'repair';

/** Which parse rules take part: the `repair` set, or the `authored` set
    shared by `email` and `preserve` (they differ only in the vocabulary
    filter that runs before the parse). */
export type RuleScope = 'repair' | 'authored';

/** The rule scope a mode parses with. */
export function scopeOf(mode: ParseMode): RuleScope {
  return mode === 'repair' ? 'repair' : 'authored';
}

/** Custom key on a parse rule restricting it to one scope. */
export const PARSE_SCOPE_KEY = 'aeeParseScope';

/** A parse rule that only takes part in the given scope. */
export function ruleForScope<T extends ParseRule>(scope: RuleScope, rule: T): T {
  return Object.assign({}, rule, { [PARSE_SCOPE_KEY]: scope });
}

/** The scope a rule is restricted to, if any. */
export function ruleScope(rule: ParseRule | TagParseRule): RuleScope | undefined {
  return (rule as unknown as Record<string, RuleScope | undefined>)[PARSE_SCOPE_KEY];
}
