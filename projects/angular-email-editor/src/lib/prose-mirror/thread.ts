/**
 * What a message says of the conversation it is part of — its three thread
 * headers (RFC 5322 §3.6.4), as they stand in the message: ids in angle
 * brackets, a list of them separated by whitespace. `InboundMessage` carries
 * them; anything shaped like this threads.
 */
export interface ThreadHeaders {
  /** `Message-ID`: the message's own id. */
  messageId?: string;
  /** `In-Reply-To`: the id of the message it answers. */
  inReplyTo?: string;
  /** `References`: the ids of the conversation so far, oldest first. */
  references?: string;
  /** When it was sent — what orders a conversation. */
  date?: Date | string;
}

/**
 * Messages gathered into their conversations, by what they say themselves:
 * two messages are in one where either names the other — or a message they
 * both name — in `References` or `In-Reply-To`. Never by subject: "Re:
 * Invoice" is a thousand conversations.
 *
 * A message in no conversation is one of its own, so every message comes
 * back, once. A conversation stands where its first message stood in the
 * list given; inside it the messages run oldest first, by their dates —
 * and as they were given, where a date is missing or cannot be read.
 *
 * ```ts
 * for (const conversation of threadMessages(inbox)) {
 *   const latest = conversation.at(-1);   // the row a list shows
 *   const count = conversation.length;    // Gmail's "3" beside the names
 * }
 * ```
 */
export function threadMessages<T extends ThreadHeaders>(messages: readonly T[]): T[][] {
  // Union-find over the messages, joined through every id they name.
  const root = messages.map((_, index) => index);
  const find = (index: number): number => {
    while (root[index] !== index) index = root[index] = root[root[index]!]!;
    return index;
  };
  const named = new Map<string, number>();
  messages.forEach((message, index) => {
    for (const id of messageIds(message.messageId, message.inReplyTo, message.references)) {
      const other = named.get(id);
      if (other === undefined) named.set(id, index);
      else root[find(index)] = find(other);
    }
  });

  const conversations = new Map<number, T[]>();
  messages.forEach((message, index) => {
    const key = find(index);
    const conversation = conversations.get(key);
    if (conversation) conversation.push(message);
    else conversations.set(key, [message]);
  });
  return [...conversations.values()].map(oldestFirst);
}

/** The ids a header names — one, or a list of them: each without its angle
    brackets, as written otherwise (a `Message-ID` is case-sensitive). Where
    a header brackets its ids, those alone: the rest is a comment or the
    prose an old client wrote round them ("Your message of Mon, 17 Aug
    2026 <a@x>"), and a word of it would join every message that says it.
    An id written without brackets is still one — an `@` in it. */
export function messageIds(...headers: (string | undefined)[]): string[] {
  return headers.flatMap((header) => {
    if (!header) return [];
    const bracketed = header.match(/<[^<>\s]+>/g);
    if (bracketed) return bracketed.map((id) => id.slice(1, -1));
    return header.match(/[^<>\s,()]+@[^<>\s,()]+/g) ?? [];
  });
}

/** By date where every message has one that can be read; as given else — a
    sort that guessed at the rest would move a message past the one it
    answers. */
function oldestFirst<T extends ThreadHeaders>(conversation: T[]): T[] {
  const sent = conversation.map(({ date }) =>
    date === undefined ? NaN : new Date(date).getTime(),
  );
  if (sent.some(Number.isNaN)) return conversation;
  return conversation
    .map((message, index) => ({ message, at: sent[index]!, index }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map(({ message }) => message);
}
