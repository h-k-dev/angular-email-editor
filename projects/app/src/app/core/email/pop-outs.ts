import { LocationStrategy } from '@angular/common';
import { DOCUMENT, DestroyRef, Injector, Service, inject } from '@angular/core';
import { Router } from '@angular/router';

// Angular Material
import { MatSnackBar } from '@angular/material/snack-bar';

// Angular Email Editor
import { inlineImageCids } from '@h-k-dev/angular-email-editor';

import { AttachmentUploads } from './attachment-uploads';
import { ComposeWindowContent, ComposeWindows, InlinePart } from './compose-windows';
import { draftKey, draftOf, envelopeOf, parseDraft, serializeDraft } from './draft';
import { BLANK } from './envelope';
import { BlobStore } from '../storages/blob-store';
import { LocalStorage } from '../storages/local-storage';
import { I18n } from '../translations/i18n';

/** The channel every tab of the app hears the pop-outs on. */
const CHANNEL = 'angular-email-editor:compose';

/** What a pop-out says, and what is said back to it — news only: the
    message itself is always in its session's draft.
    - `pop-in`: the pop-out hands its message back — a tab takes it in;
    - `adopted`: a tab has, and the pop-out may close;
    - `sent`: the pop-out sent its message (the tab that opened it says so). */
interface PopOutNews {
  readonly type: 'pop-in' | 'adopted' | 'sent';
  readonly session: string;
}

/** How long a pop-out waits for a tab to take its message back before it
    becomes the mailbox itself, ms. */
const ADOPT_TIMEOUT = 1500;

/** How long a tab that did not open the pop-out leaves its opener to take
    the message back first, ms. */
const OPENER_FIRST = 400;

/** A pop-out's size, px, at most — the landing's document, room around
    its column — and its least room to the screen's edges. */
const POP_OUT_WIDTH = 1040;
const POP_OUT_HEIGHT = 860;
const SCREEN_MARGIN = 32;

/** The lock a session's draft is held under: one place at a time — the
    tab handing it over, the pop-out showing it, the tab taking it back. */
function lockName(session: string): string {
  return `${draftKey(session)}:lock`;
}

/**
 * Pop-outs: a message in a browser window of its own — the front page's
 * document (`/compose/:session`), Gmail's pop-out. The third way a message
 * opens, beside a window on the edge and the zoomed one.
 *
 * - **The session is the draft.** The URL carries the session's id alone
 *   (`crypto.randomUUID()`); the message lives in the session's draft
 *   (`draftKey`), its inline images in the blob store — so a reload, or a
 *   back and forward, finds it again. This browser only: the link means
 *   nothing anywhere else.
 * - **One place at a time** (Web Locks): the tab handing a message over
 *   holds the session until its images are stored, the pop-out while it
 *   shows it, a tab taking it back while it does. The pop-out waits for
 *   the lock before it reads the draft.
 * - **News on a BroadcastChannel**, never the message: popping back in
 *   asks every tab; the one that opened it takes it first, any other a
 *   moment later — whichever takes the lock and still finds the draft —
 *   and the pop-out closes. With no tab to take it, the pop-out becomes
 *   the mailbox, the message in a window there.
 *
 * Opened synchronously, in the click: a popup opened after an `await` is
 * a popup the browser blocks.
 */
@Service()
export class PopOuts {
  readonly #window = inject(DOCUMENT).defaultView;
  readonly #injector = inject(Injector);
  readonly #location = inject(LocationStrategy);
  readonly #router = inject(Router);
  readonly #storage = inject(LocalStorage);
  readonly #blobs = inject(BlobStore);

  readonly #channel =
    this.#window && 'BroadcastChannel' in this.#window ? new BroadcastChannel(CHANNEL) : null;

  /** The sessions this tab popped out: it takes them back first, and says
      when one was sent. */
  readonly #opened = new Set<string>();
  /** The pop-in this tab waits to see taken, by session. */
  readonly #waiting = new Map<string, () => void>();
  /** The sessions this tab holds as a pop-out, and how to let each go. */
  readonly #held = new Map<string, () => void>();

  constructor() {
    const channel = this.#channel;
    if (!channel) return;
    channel.onmessage = (event: MessageEvent<PopOutNews>) => void this.#hear(event.data);
    inject(DestroyRef).onDestroy(() => channel.close());
  }

  /**
   * Opens `content` — a new message without it — in a browser window of
   * its own, under a new session, and reports whether the browser let it
   * open. Call it in the click itself: the popup is opened before anything
   * else, synchronously. A message still uploading an attachment keeps it
   * out ({@link draftOf}); its opener should not offer this then.
   */
  open(content: ComposeWindowContent | null): boolean {
    const window = this.#window;
    if (!window) return false;
    const session = crypto.randomUUID();
    const url = this.#location.prepareExternalUrl(`/compose/${session}`);
    const popup = window.open(url, `compose-${session}`, features(window));
    if (!popup) return false;
    const message = content?.message ?? BLANK;
    this.#storage.setItem(draftKey(session), serializeDraft(draftOf(message, BLANK, true)));
    const referenced = new Set(inlineImageCids(message.html));
    const parts = content?.images.filter((part) => referenced.has(part.cid)) ?? [];
    // The pop-out reads the draft once it holds the lock: its images are in
    // the store by then.
    if (parts.length) {
      void this.#hold(session, () => this.#blobs.put(parts.map((p) => [p.cid, p.blob] as const)));
    }
    this.#opened.add(session);
    return true;
  }

  /**
   * Holds the session for the pop-out showing it: `granted` runs once the
   * lock is this window's — at once, unless another window has the session
   * open — with whether the draft is still there. Held until the returned
   * release is called, or {@link popIn} lets it go.
   */
  attach(session: string, granted: (found: boolean) => void): () => void {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let active = true;
    void this.#hold(session, () => {
      if (!active) return Promise.resolve();
      this.#held.set(session, release);
      granted(this.#storage.getItem(draftKey(session)) !== null);
      return held;
    });
    return () => {
      active = false;
      this.#held.delete(session);
      release();
    };
  }

  /**
   * Hands the pop-out's message back — its draft saved and let go first
   * (`Draft.close`): a tab takes it in, in a window on the edge, and this
   * window closes. With no tab to take it, this window becomes the mailbox,
   * the message in a window there.
   */
  async popIn(session: string): Promise<void> {
    this.#held.get(session)?.();
    this.#held.delete(session);
    const adopted = new Promise<boolean>((resolve) => {
      this.#waiting.set(session, () => resolve(true));
      setTimeout(() => resolve(false), ADOPT_TIMEOUT);
    });
    this.#post({ type: 'pop-in', session });
    const taken = await adopted;
    this.#waiting.delete(session);
    if (taken) {
      this.#leave();
      return;
    }
    await this.#router.navigateByUrl('/inbox');
    await this.#adopt(session);
  }

  /** The pop-out is done — sent (the tab that opened it says so), or
      discarded: the window closes. */
  done(session: string, sent: boolean): void {
    this.#held.get(session)?.();
    this.#held.delete(session);
    if (sent) this.#post({ type: 'sent', session });
    this.#leave();
  }

  async #hear(news: PopOutNews): Promise<void> {
    const { type, session } = news;
    if (type === 'adopted') {
      this.#waiting.get(session)?.();
      return;
    }
    const mine = this.#opened.has(session);
    if (type === 'sent') {
      if (mine) {
        const words = this.#injector.get(I18n).t('composeWindow.sent');
        this.#injector.get(MatSnackBar).open(words, undefined, { duration: 4000 });
      }
      this.#opened.delete(session);
      return;
    }
    // A pop-out takes in no other's message: it is a message, not a mailbox.
    if (this.#held.size) return;
    if (!mine) await new Promise((resolve) => setTimeout(resolve, OPENER_FIRST));
    if (await this.#adopt(session)) this.#post({ type: 'adopted', session });
    this.#opened.delete(session);
  }

  /** Takes the session's message into a window on this tab's edge, and
      ends the session — if it is still there for the taking: whoever takes
      the lock first and finds the draft has it. */
  async #adopt(session: string): Promise<boolean> {
    return this.#hold(session, async () => {
      const key = draftKey(session);
      const content = parseDraft(this.#storage.getItem(key));
      if (!content) return false;
      const images = await Promise.all(
        inlineImageCids(content.html).map(async (cid) => ({
          cid,
          blob: await this.#blobs.get(cid),
        })),
      );
      // Its images go with the next sweep, once nothing references them.
      this.#storage.setItem(key, null);
      const uploads = this.#injector.get(AttachmentUploads);
      const message = envelopeOf(content, (attachment) => uploads.adopt(attachment));
      await this.#injector.get(ComposeWindows).open({
        content: {
          message,
          images: images.filter((part): part is InlinePart => part.blob !== undefined),
        },
        focus: 'body',
      });
      return true;
    });
  }

  /** Runs `work` holding the session — where Web Locks exist; elsewhere it
      just runs. */
  #hold<T>(session: string, work: () => Promise<T>): Promise<T> {
    const locks = this.#window?.navigator.locks;
    return locks ? locks.request(lockName(session), work) : work();
  }

  #post(news: PopOutNews): void {
    this.#channel?.postMessage(news);
  }

  /** Closes the pop-out — which only a window a script opened can do; one
      opened from its link goes to the mailbox instead. */
  #leave(): void {
    const window = this.#window;
    window?.close();
    setTimeout(() => {
      if (!window?.closed) void this.#router.navigateByUrl('/inbox');
    }, 100);
  }
}

/** A pop-out's window: as large as {@link POP_OUT_WIDTH} by
    {@link POP_OUT_HEIGHT} allow on this screen, centred on the window
    that opens it. */
function features(window: Window): string {
  const { availWidth, availHeight } = window.screen;
  const width = Math.min(POP_OUT_WIDTH, availWidth - SCREEN_MARGIN * 2);
  const height = Math.min(POP_OUT_HEIGHT, availHeight - SCREEN_MARGIN * 2);
  const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - height) / 2);
  return `popup,width=${width},height=${height},left=${left},top=${top}`;
}
