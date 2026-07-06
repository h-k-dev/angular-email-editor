/**
 * The client-support data module (M3): a curated, versioned subset of what
 * caniemail documents about our floor clients. Pure data + lookups — the
 * lint engine, tooltips and (later) autocomplete all read from here.
 *
 * Curation rule: only entries we are confident about, phrased as what
 * *actually happens* in the client. Accuracy beats coverage.
 */

export type EmailClient = 'gmail' | 'outlook-desktop' | 'outlook-web' | 'apple-mail' | 'yahoo';

export const CLIENT_LABELS: Record<EmailClient, string> = {
  gmail: 'Gmail',
  'outlook-desktop': 'Outlook (Windows)',
  'outlook-web': 'Outlook.com',
  'apple-mail': 'Apple Mail',
  yahoo: 'Yahoo Mail',
};

export function clientList(clients: EmailClient[]): string {
  return clients.map((client) => CLIENT_LABELS[client]).join(', ');
}

export interface CssSupportIssue {
  /** Lower-cased CSS property this entry describes. */
  property: string;
  /** Restrict to matching values (e.g. display:flex, background:url(…)). */
  valuePattern?: RegExp;
  /** Restrict to these tags (e.g. padding is fine on table cells). */
  onTags?: string[];
  /** Clients where the declaration does not do what it says. */
  ignoredBy: EmailClient[];
  /** What actually happens — this is the tooltip. */
  note: string;
}

export const CSS_SUPPORT: CssSupportIssue[] = [
  {
    property: 'max-width',
    ignoredBy: ['outlook-desktop'],
    note: 'it sizes from the width attribute instead — pair both (the hybrid) or the cap is lost',
  },
  {
    property: 'padding',
    onTags: ['div', 'p', 'span'],
    ignoredBy: ['outlook-desktop'],
    note: 'the Word engine only honours padding on table cells',
  },
  {
    property: 'border-radius',
    ignoredBy: ['outlook-desktop'],
    note: 'corners render square',
  },
  {
    property: 'background-image',
    ignoredBy: ['outlook-desktop'],
    note: 'image backgrounds need VML there; the background color shows instead',
  },
  {
    property: 'background',
    valuePattern: /url\s*\(/i,
    ignoredBy: ['outlook-desktop'],
    note: 'image backgrounds need VML there; the background color shows instead',
  },
  {
    property: 'position',
    ignoredBy: ['outlook-desktop', 'gmail'],
    note: 'elements fall back into normal flow',
  },
  {
    property: 'display',
    valuePattern: /^(inline-)?(flex|grid)\b/i,
    ignoredBy: ['outlook-desktop', 'gmail'],
    note: 'modern layout falls back to block flow — use spongy inline-block columns instead',
  },
  {
    property: 'float',
    ignoredBy: ['outlook-desktop'],
    note: 'content stacks instead of wrapping around',
  },
  {
    property: 'opacity',
    ignoredBy: ['outlook-desktop'],
    note: 'renders fully opaque',
  },
  {
    property: 'box-shadow',
    ignoredBy: ['outlook-desktop'],
    note: 'shadows simply vanish',
  },
  {
    property: 'transform',
    ignoredBy: ['outlook-desktop', 'gmail'],
    note: 'renders untransformed in place',
  },
  {
    property: 'animation',
    ignoredBy: ['outlook-desktop', 'gmail'],
    note: 'nothing animates; the first frame is the email',
  },
  {
    property: 'font',
    ignoredBy: ['outlook-desktop'],
    note: 'the Word engine misreads the shorthand — set font-size and font-family separately',
  },
  {
    property: 'line-height',
    ignoredBy: ['outlook-desktop'],
    note: 'the Word engine may substitute its own unless mso-line-height-rule is set',
  },
];

/** Issues that apply to a concrete declaration on a concrete tag. */
export function findCssIssues(property: string, value: string, tag: string): CssSupportIssue[] {
  return CSS_SUPPORT.filter(
    (issue) =>
      issue.property === property &&
      (!issue.valuePattern || issue.valuePattern.test(value)) &&
      (!issue.onTags || issue.onTags.includes(tag)),
  );
}

/** Attributes worth suggesting per email-safe tag; `'*'` applies to all.
    The schema knows what is legal — autocomplete offers only that. */
export const EMAIL_TAG_ATTRIBUTES: Record<string, string[]> = {
  '*': ['style', 'title'],
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'width'],
};

/** Style properties safe enough to *suggest*. Anything here that still has
    a CSS_SUPPORT entry (max-width, padding) is legitimate but situational —
    the lint explains the situation when it applies. */
export const EMAIL_SAFE_STYLE_PROPERTIES: string[] = [
  'background-color',
  'border',
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'height',
  'letter-spacing',
  'max-width',
  'padding',
  'text-align',
  'text-decoration',
  'width',
];

/** Gmail clips messages above ~102 KB — the recipient sees a truncated email
    with a "[View entire message]" link, and tracking of anything below the
    clip is lost. The hardest size constraint in email. */
export const GMAIL_CLIP_BYTES = 102 * 1024;

export interface SizeBudget {
  bytes: number;
  limit: number;
  level: 'ok' | 'warning' | 'error';
}

/** UTF-8 size of the canonical HTML against the Gmail clipping limit;
    warning from 80% of the budget, error above it. */
export function emailSizeBudget(html: string): SizeBudget {
  const bytes = new TextEncoder().encode(html).length;
  const level = bytes > GMAIL_CLIP_BYTES ? 'error' : bytes > GMAIL_CLIP_BYTES * 0.8 ? 'warning' : 'ok';
  return { bytes, limit: GMAIL_CLIP_BYTES, level };
}
