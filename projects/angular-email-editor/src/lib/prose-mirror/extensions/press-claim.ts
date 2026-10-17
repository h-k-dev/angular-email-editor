/**
 * Presses a gesture has taken for itself — the block marquee's — so the
 * editor's other press listeners (the inline atoms' drag) leave them alone.
 * Internal: not part of the library's API.
 */
const claimed = new WeakSet<Event>();

export const claimPress = (event: Event): void => {
  claimed.add(event);
};

export const isClaimedPress = (event: Event): boolean => claimed.has(event);
