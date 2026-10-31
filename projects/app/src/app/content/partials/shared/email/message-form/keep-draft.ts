import {
  DOCUMENT,
  DestroyRef,
  Directive,

  // Signals
  computed,
  debounced,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { InlineImages } from '@h-k-dev/angular-email-editor';

import { AttachmentUploads } from '../../../../../core/email/attachment-uploads';
import {
  DRAFT_SAVE_DELAY,
  DRAFT_SESSION,
  Draft,
  DraftContent,
  SaveOptions,
  draftOf,
  envelopeOf,
  serializeDraft,
} from '../../../../../core/email/draft';
import { Envelope } from '../../../../../core/email/envelope';
import { MessageSheet } from './message-sheet';

/**
 * Keeps a sheet's message as *the* draft (the {@link Draft} service — one
 * per app, shared with every tab), the way a mail client keeps one — without
 * a Save button:
 *
 * - **Opened as the draft.** The sheet starts as the stored draft, when
 *   there is one: storage reads synchronously, and this runs before the
 *   sheet first renders, so it never shows empty first.
 * - **Saved once the message rests** — half a second after the last change,
 *   not on every keystroke — and at once when the page may be going away
 *   (hidden, or unloading) or the sheet is left for another page: text
 *   first then, without waiting for a pasted image to reach the store.
 * - **Only while there is something to keep.** A sheet nobody has written
 *   on has no draft, and emptying the message removes it.
 * - **Shared with every tab.** A draft saved elsewhere replaces this
 *   message as soon as it lands (the editor defers it while someone types
 *   in it); an attachment this tab is still uploading stays, as no other
 *   tab can know of it. Last writer wins.
 * - **Gone after a send, or a discard** — in every tab.
 *
 * On the sheet itself, so a frame opts in: the composer page keeps its
 * draft; a compose window, which is a message of its own, does not take
 * the page's. A pop-out keeps its session's ({@link DRAFT_SESSION}) — kept
 * even while blank: the draft is the session, there as long as the window
 * is.
 */
@Directive({
  selector: '[keepDraft]',
  exportAs: 'keepDraft',
})
export class KeepDraft {
  // Either sheet, the desktop's or the phone's.
  readonly #sheet = inject(MessageSheet);
  readonly #draft = inject(Draft);
  readonly #uploads = inject(AttachmentUploads);
  readonly #images = inject(InlineImages);
  /** A pop-out's draft lives while it is blank too. */
  readonly #session = inject(DRAFT_SESSION) !== null;

  /** The draft's state, for a status line. */
  readonly note = computed(() => {
    if (this.#draft.failed()) return 'Draft not saved — this browser is not keeping it';
    const at = this.#draft.savedAt();
    return at
      ? `Draft saved · ${at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
      : null;
  });

  constructor() {
    const message = this.#sheet.message;
    message.set(this.#fromDraft(this.#draft.incoming().content));

    // The restored body's images come from the blob store; until they have,
    // the editor shows them as missing.
    void this.#draft.loadParts(message().html, this.#images);

    // The debounce only paces: what is saved is the message as it is when
    // the save runs — never the snapshot that started the wait, which a
    // draft taken in from another tab may have replaced since.
    const resting = debounced(() => message(), inject(DRAFT_SAVE_DELAY));
    effect(() => {
      resting.value();
      untracked(() => this.#save(message()));
    });

    effect(() => {
      const { content } = this.#draft.incoming();
      untracked(() => this.#take(content));
    });

    // Started over — sent or discarded: the draft has done its job.
    this.#sheet.cleared.subscribe(() => this.#draft.discard());

    const document = inject(DOCUMENT);
    const window = document.defaultView;
    const flush = () => this.flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    // pagehide, not beforeunload: it fires where beforeunload does not (a
    // mobile tab discarded in the background) and keeps the page eligible
    // for the back/forward cache.
    document.addEventListener('visibilitychange', onVisibility);
    window?.addEventListener('pagehide', flush);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      window?.removeEventListener('pagehide', flush);
      flush();
    });
  }

  /** Saves the message now, text first — the page may be going away. */
  flush(): void {
    this.#save(this.#sheet.message(), { now: true });
  }

  #save(message: Envelope, options?: SaveOptions): void {
    this.#draft.save(this.#toDraft(message), this.#images, options);
  }

  #toDraft(message: Envelope): DraftContent | null {
    return draftOf(message, this.#sheet.newMessage(), this.#session);
  }

  /** Takes in a draft another tab saved — or its absence, once that tab has
      sent or discarded it. The first run sees the draft this message was
      opened with, and changes nothing. */
  #take(content: DraftContent | null): void {
    const current = this.#sheet.message();
    const kept = this.#toDraft(current);
    if (serializeDraft(content) === serializeDraft(kept)) return;
    const next = this.#fromDraft(content, current);
    for (const attachment of current.attachments) {
      if (!next.attachments.includes(attachment)) this.#uploads.cancel(attachment.key);
    }
    this.#sheet.message.set(next);
    if (content) void this.#draft.loadParts(content.html, this.#images);
  }

  /** The message a draft makes. Attachments this message already holds keep
      their references — their chips stay put — and the rest are adopted
      from the store under keys of this session; the uploads still under way
      here come along. */
  #fromDraft(content: DraftContent | null, current?: Envelope): Envelope {
    if (!content) return this.#sheet.newMessage();
    const held = new Map(
      current?.attachments.flatMap((ref) => (ref.id === null ? [] : [[ref.id, ref] as const])),
    );
    const message = envelopeOf(
      content,
      (attachment) => held.get(attachment.id) ?? this.#uploads.adopt(attachment),
    );
    return {
      ...message,
      attachments: [
        ...message.attachments,
        ...(current?.attachments.filter((ref) => ref.id === null) ?? []),
      ],
    };
  }
}
