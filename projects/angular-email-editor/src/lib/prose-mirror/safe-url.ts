/** Whether a URL may be emitted at all: script schemes are refused on parse
    and on every command — mail clients block them anyway, and the schema
    never carries what a client would refuse. */
export function isSafeUrl(url: string | null): boolean {
  if (!url) return false;
  // Block javascript: and vbscript: protocols (case-insensitive, ignoring leading spaces)
  const isMalicious = /^\s*(javascript|vbscript):/i.test(url);
  return !isMalicious;
}
