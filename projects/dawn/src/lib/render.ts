import { renderForClient } from './client-rendering';
import { DawnScheme } from './color';
import { dawnDarkDocument, dawnSurfaceRules, declaresDark } from './css';

export interface DawnRenderOptions {
  /** Light or dark paper. */
  readonly scheme: DawnScheme;
  /** The reading pane: a phone draws the message edge to edge, a desktop
      pane keeps a margin round it. Default desktop. */
  readonly pane?: 'phone' | 'desktop';
}

/**
 * An email as Dawn draws it to be read — the one drawing of every view of
 * a message: a reading pane, a thumbnail, a bench. Takes a fragment (a
 * message body) or a whole document; returns a document for a sandboxed
 * frame.
 *
 * Drawn as the library's WebKit client draws it (`renderForClient`'s
 * `apple-mail`). Dark is drawn here, never written into an email. In dark, a
 * message that declares dark keeps its own rules on the dark surface; any
 * other has every colour it paints drawn dark (`dawnDarkDocument`), its
 * pictures as they are, and lies on the dark surface with Dawn's ink and
 * links — laid right after the client's surface, under the message's own
 * rules.
 */
export function renderDawn(html: string, { scheme, pane }: DawnRenderOptions): string {
  const client = { pane } as const;
  if (scheme === 'light') return renderForClient(html, 'apple-mail', client);
  const message = new DOMParser().parseFromString(html, 'text/html');
  if (declaresDark(message)) return renderForClient(html, 'apple-mail', { ...client, dark: true });
  dawnDarkDocument(message);
  const drawn = renderForClient(
    '<!doctype html>' + message.documentElement.outerHTML,
    'apple-mail',
    client,
  );
  const doc = new DOMParser().parseFromString(drawn, 'text/html');
  const surface = doc.head.querySelector('style');
  const sheet = doc.createElement('style');
  sheet.textContent = dawnSurfaceRules('dark');
  doc.head.insertBefore(sheet, surface ? surface.nextSibling : doc.head.firstChild);
  return '<!doctype html>' + doc.documentElement.outerHTML;
}
