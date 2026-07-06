/**
 * The `text/plain` projection of canonical email HTML — the multipart
 * alternative every well-formed email should carry (spam scoring cares, and
 * some recipients read it). Blockquotes become `> `, lists become `- ` /
 * `1. `, links keep their URL, images fall back to their alt text.
 */
export function emailPlainText(html: string): string {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const lines: string[] = [];
  renderChildren(body, lines, '');
  return lines.join('\n');
}

function renderChildren(parent: Element, lines: string[], prefix: string): void {
  for (const child of Array.from(parent.children)) renderBlock(child, lines, prefix);
}

function renderBlock(element: Element, lines: string[], prefix: string): void {
  const tag = element.tagName.toLowerCase();

  if (tag === 'blockquote') {
    renderChildren(element, lines, `${prefix}> `);
    return;
  }
  if (tag === 'ul' || tag === 'ol') {
    renderList(element, lines, prefix, tag === 'ol');
    return;
  }
  if (tag === 'img') {
    lines.push(prefix + imageText(element));
    return;
  }

  // div, p, headings — one line each, more via <br>. A single trailing <br>
  // is the empty-line marker (<div><br></div>), not an extra line.
  const raw = inlineText(element);
  const text = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  for (const line of text.split('\n')) lines.push(prefix + line);
}

function renderList(list: Element, lines: string[], prefix: string, ordered: boolean): void {
  let index = 1;
  for (const item of Array.from(list.children)) {
    if (item.tagName.toLowerCase() !== 'li') continue;
    const bullet = ordered ? `${index++}. ` : '- ';

    const itemLines: string[] = [];
    renderChildren(item, itemLines, '');
    if (!itemLines.length) itemLines.push(inlineText(item).trim());

    lines.push(prefix + bullet + itemLines[0]);
    for (const rest of itemLines.slice(1)) {
      lines.push(prefix + ' '.repeat(bullet.length) + rest);
    }
  }
}

function inlineText(element: Element): string {
  let out = '';
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue ?? '';
    } else if (node instanceof Element) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'br') {
        out += '\n';
      } else if (tag === 'a') {
        const href = node.getAttribute('href') ?? '';
        const text = inlineText(node);
        out += !href || text === href ? text || href : `${text} (${href})`;
      } else if (tag === 'img') {
        out += imageText(node);
      } else {
        out += inlineText(node);
      }
    }
  }
  return out;
}

function imageText(element: Element): string {
  const alt = element.getAttribute('alt');
  return alt ? `[${alt}]` : '[image]';
}
