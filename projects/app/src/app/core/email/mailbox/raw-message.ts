/**
 * Whether a text is a whole message as it travels (RFC 5322) — what Gmail's
 * "Show original" shows, an `.eml` opened in a text editor: a block of
 * header fields (`Name: value`, folded lines indented under them), then a
 * blank line, then the body. Only a sniff, the parser decides the rest: two
 * fields at least, `From:` or `MIME-Version:` among them, so a paste of
 * prose that happens to start with "Note: …" is never taken for one.
 */
export function looksLikeRawMessage(text: string): boolean {
  const lines = text.trimStart().split(/\r?\n/);
  const end = lines.indexOf('');
  if (end < 2) return false;
  const head = lines.slice(0, end);
  if (!/^[!-9;-~]+:/.test(head[0])) return false;
  if (!head.every((line) => /^[!-9;-~]+:/.test(line) || /^[ \t]/.test(line))) return false;
  return head.some((line) => /^(from|mime-version):/i.test(line));
}
