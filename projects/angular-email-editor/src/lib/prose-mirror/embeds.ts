/**
 * Embedded players as links to their pages — no mail client plays one. The
 * `<iframe>` the parse refuses leaves its link behind (html.ts); a `<video>`
 * kept as written is offered as one (corrections.ts).
 */

/** The page a viewer opens for an embedded player's address. */
export function videoPage(src: string): string {
  const url = src.trim().replace(/^\/\//, 'https://');
  const youtube = /^https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/([\w-]+)/i.exec(url);
  if (youtube) return `https://www.youtube.com/watch?v=${youtube[1]}`;
  const vimeo = /^https?:\/\/player\.vimeo\.com\/video\/(\d+)/i.exec(url);
  if (vimeo) return `https://vimeo.com/${vimeo[1]}`;
  return url;
}

/** Each embedded player matching `selector` becomes a link to its page,
    where it stood (one with no page to open goes). Returns how many. */
function playersAsLinks(root: ParentNode, selector: string): number {
  const players = Array.from(root.querySelectorAll(selector));
  for (const embed of players) {
    const page = videoPage(embed.getAttribute('src')!);
    if (!/^https?:\/\//i.test(page)) {
      embed.remove();
      continue;
    }
    const link = embed.ownerDocument.createElement('a');
    link.setAttribute('href', page);
    link.textContent = embed.getAttribute('title')?.trim() || page;
    embed.replaceWith(link);
  }
  return players.length;
}

/** Each `<video>` becomes a link to its page — a correction, offered. */
export const videosAsLinks = (root: ParentNode): number => playersAsLinks(root, 'video[src]');

/** Each `<iframe>` player becomes a link to its page — the parse's refusal
    of the frame (html.ts), so what it played is not lost with it. */
export const refusedEmbedsAsLinks = (root: ParentNode): number =>
  playersAsLinks(root, 'iframe[src]');
