import {
  ApplicationRef,
  ComponentRef,
  DOCUMENT,
  EnvironmentInjector,
  Service,
  createComponent,
  inject,

  // Signals
  computed,
  signal,
} from '@angular/core';

import type { Envelope } from './envelope';
import type { MessageSheetKind } from '../../content/partials/shared/email/message-form/message-sheet';
import { Viewport } from '../layout/viewport';
import { Preferences } from '../storages/preferences';
import { PopOuts } from './pop-outs';
import { DOCK_GAP, DockStack, STACK_COUNTER_WIDTH } from '../dock/dock-stack';

export { DOCK_GAP };

/** How a compose window shows, Gmail's three states:
    - `docked`: a window in its place on the bottom edge of the screen;
    - `minimized`: on the stack (`DockStack`) — its place
      given up, its title bar shown when the stack fans out (and, the top
      one, while no window is open);
    - `expanded`: a 16:9 dialog in the middle of the screen, over a scrim —
      one at a time. */
export type ComposeWindowMode = 'docked' | 'minimized' | 'expanded';

/** How a new message opens on a desk — the settings' Open mode:
    - `window`: docked, in its place on the bottom edge;
    - `zoom`: expanded, the dialog over the page (any other dialog goes
      back to its place, as {@link ComposeWindows.expand} does);
    - `pop-out`: a browser window of its own ({@link PopOuts}) — a window
      on the edge where the browser blocks it.
    A phone's window is the screen either way. */
export type ComposeOpenMode = 'window' | 'zoom' | 'pop-out';

/** What a window on the edge holds — the frame is the same, the content
    is its kind's:
    - `compose`: a message being written, on its sheet;
    - `note`: a note (`Notes`);
    - `event`: a calendar event being written (`EventDrafts`).
    The last two are named by {@link ComposeWindow.item}. */
export type ComposeWindowKind = 'compose' | 'note' | 'event';

/** A kind's mark — in a window's title bar, in the dock stack's menu and
    on its counter (a Material symbol's name). */
export const WINDOW_KIND_ICONS: Readonly<Record<ComposeWindowKind, string>> = {
  compose: 'mail',
  note: 'sticky_note_2',
  event: 'event',
};

/** What a new window opens with — see {@link ComposeWindows.open}. */
export interface ComposeOptions {
  /** What it holds: a message, unless it says otherwise. */
  readonly kind?: ComposeWindowKind;
  /** What a window that is not a message's holds — the note, the event
      draft — by its id. */
  readonly item?: number;
  readonly mobile?: ComposeWindowMobile;
  readonly content?: ComposeWindowContent;
  readonly focus?: ComposeWindowFocus;
}

/** How a window shows on a phone, where it is the whole screen either way:
    - `page`: as the page itself — no title bar, and no control of its own
      to leave by, the way Gmail and ProtonMail open a message on a phone.
      The phone's back button is the way out, as it is out of any other
      page there, and its forward button brings the message back (see
      BackButton); Discard is still on the message's bar.
    - `window`: with its title bar, as on a desk. For a host that wants
      the same chrome everywhere. */
export type ComposeWindowMobile = 'page' | 'window';

/** Where the caret goes when a window opens:
    - `to`: the To row, where a new message starts;
    - `body`: the editor, above the quoted history — a reply's To and
      subject are already filled (and a subject is often better left to a
      suggestion from what is written), so the user starts with the text.
      The sheet marks the editor `cdkFocusInitial`, and the caret goes
      where the CDK's initial focus puts it. */
export type ComposeWindowFocus = 'to' | 'body';

/** An inline part of a message being put back: its Content-ID and its
    bytes. The registry a window holds goes with the window (its object URLs
    are revoked with it), so the bytes come back to the new one under the
    same ids and every `cid:` in the HTML resolves again. */
export interface InlinePart {
  readonly cid: string;
  readonly blob: Blob;
}

/** What was written in a window that closed, kept whole so it can come
    back: the message as the sheet held it, and the inline parts its HTML
    names. */
export interface ComposeWindowContent {
  readonly message: Envelope;
  readonly images: readonly InlinePart[];
}

/** One open window on the edge. */
export interface ComposeWindow {
  readonly id: number;
  /** What it holds. Everything about its place — the row, the stack, the
      dialog — is the same whatever that is. */
  readonly kind: ComposeWindowKind;
  /** What it holds, by its id — the note, the event draft — where it is
      not a message's window. */
  readonly item: number | null;
  /** Which place on the edge is this window's, counted from the corner: 0
      is the corner itself, 1 the one beside it, and so on. Never chosen and
      never remembered: the open windows — on the edge or in the dialog —
      stand from the corner out in the order they were opened, with no gap
      between them, so a window's place is how many open ones are older than
      it. It moves in when an older one minimizes or closes, and back out
      when one is restored. Minimized, the window holds no place, and this
      is only the last one it had. */
  readonly slot: number;
  readonly mode: ComposeWindowMode;
  /** Where a drag has put the window instead — px from the right side of
      the screen (ProtonMail's sideways drag) — or `null` while it sits in
      its own place. A patch over {@link slotPosition}, and the window
      returns to it after the dialog as it does to its place. */
  readonly pin: number | null;
  /** How this window shows on a phone. */
  readonly mobile: ComposeWindowMobile;
  /** The sheet its message is written on: the phone's where it opened on a
      phone, the desktop's anywhere else — chosen as it opens, and kept for
      its life (a forward-button return included), so a screen that turns
      or widens never swaps the editor out from under the message. */
  readonly sheet: MessageSheetKind;
  /** What the window opens with, where it is not a new message: a reply
      or a forward its opener prepared, or — a window the forward button put
      back — what was written in it. The sheet starts from it. */
  readonly restored: ComposeWindowContent | null;
  /** Where the caret goes as the window opens. */
  readonly focus: ComposeWindowFocus;
  /** The history entry the window's way out sits on, where it has one (a
      phone's back button, see BackButton): a window put back comes back on
      the very entry it was closed from, and its new guard takes that over
      rather than adding another. */
  readonly guard: number | null;
}

/** A docked window's width, px: exactly the sheet's own measure — the
    email is designed for 600px, so the window is that wide and never
    squeezed. */
export const DOCKED_WIDTH = 600;
/** A minimized window's width, px: its title bar, in the same place as the
    window it belongs to. */
export const MINIMIZED_WIDTH = 280;
/** However wide the screen, never more messages open on the edge than
    this: three is what anyone keeps track of side by side. */
export const MAX_WINDOWS = 3;

/** However many are minimized, never more messages at all than this —
    open and stacked together: a Compose past it is far more often the
    message already started than a new one. Messages only: there is no end
    to the notes. */
export const MAX_MESSAGES = 6;

/** A window's name on the dock's stack (`DockStack`): its kind — its sort
    there, what the stack's counter counts it under — and its id. */
export function windowStackKey(window: Pick<ComposeWindow, 'id' | 'kind'>): string {
  return `${window.kind}:${window.id}`;
}

/** Where a window's place on the edge is, as px from the right side of the
    screen — every place worked out once, from its number. */
export function slotPosition(slot: number): number {
  return DOCK_GAP + slot * (DOCKED_WIDTH + DOCK_GAP);
}

/**
 * Compose windows, the way Gmail and ProtonMail do them: any page can open
 * a message in a window of its own — `open()` — and keep reading while it
 * is written; each is its own message, sent or discarded on its own.
 *
 * The windows are not only a message's: a window has a kind
 * ({@link ComposeWindowKind}) — a note opens in the very same frame, in
 * the same row, onto the same stack — and nothing below cares which.
 *
 * - **In a row from the corner, in order.** The open windows stand on the
 *   bottom edge from the right corner leftwards, oldest first, with no gap
 *   between them: only their order is kept, never a place. A window that
 *   minimizes or closes lets the newer ones move in towards the corner; one
 *   restored goes back between the same neighbours, and the newer ones
 *   move out again. The dialog keeps its window's place in the row.
 * - **As many as the edge holds**, and never more than {@link MAX_WINDOWS}:
 *   the screen's width over a window's own 600px says how many places there
 *   are ({@link capacity}). Compose with every place taken by messages —
 *   or with {@link MAX_MESSAGES} of them open and stacked — hands the
 *   oldest message back instead. A note always opens: with no place free
 *   the last note on the edge goes onto the stack for it.
 * - **Minimized** into a stack, the way a dock's stack holds its files:
 *   the window gives its place up, and its title bar goes on the stack.
 *   Beside an open window the edge shows only a counter — how many are
 *   minimized — left of the leftmost one. With none open it shows the
 *   stack's top bar, the last window minimized, in the corner, and the
 *   counter to its left counts the ones under it. Hovering (or pressing)
 *   the counter fans the bars out of sight upwards over everything, each
 *   restoring its window. Restored, a window goes
 *   back into the row where its age puts it; with no place free, the
 *   oldest open window goes onto the stack in its stead.
 * - **Expanded** into a centred 16:9 dialog over a scrim — one at a time:
 *   expanding another returns the first to its place, which is still there.
 * - **Dragged sideways** by its title bar (ProtonMail): the drag patches
 *   the window's position, and that patch outlives a trip to the dialog
 *   too.
 *
 * The windows are drawn by a dock this service mounts into the page the
 * first time one opens — a lazy chunk, so the editor costs nothing until a
 * window needs it, and no page has to host an element for it.
 */
@Service()
export class ComposeWindows {
  readonly #document = inject(DOCUMENT);
  readonly #viewport = inject(Viewport);
  readonly #preferences = inject(Preferences);
  readonly #popOuts = inject(PopOuts);
  readonly #app = inject(ApplicationRef);
  readonly #injector = inject(EnvironmentInjector);

  readonly #windows = signal<readonly ComposeWindow[]>([]);
  /** The open windows, oldest first. */
  readonly windows = this.#windows.asReadonly();

  readonly #front = signal<number | null>(null);
  /** The window drawn over the others — the one last opened, pressed or
      focused. */
  readonly front = this.#front.asReadonly();

  /** The window shown as the dialog, if one is. */
  readonly expanded = computed(() => this.#windows().find((w) => w.mode === 'expanded') ?? null);

  readonly #wanted = signal<{ id: number; seq: number } | null>(null);
  /** The window asked to take the caret, and the ask it came with — a new
      one every time, so asking twice for the same window is two asks. The
      window itself does the focusing (it owns its sheet). */
  readonly wanted = this.#wanted.asReadonly();

  /** The dock's stack: where a minimized window's bar goes — with whatever
      else minimizes onto the edge — and what says how it shows. */
  readonly #stack = inject(DockStack);
  /** The minimized windows, top of the stack first — the one minimized
      last. */
  readonly minimized = computed(() => {
    const windows = this.#windows();
    return this.#stack
      .entries()
      .map((entry) => windows.find((w) => windowStackKey(w) === entry.key))
      .filter((w): w is ComposeWindow => w !== undefined);
  });

  #nextId = 1;
  #seq = 0;
  #dock: Promise<ComponentRef<unknown>> | null = null;

  constructor() {
    // The edge is the windows' row: the stack stands left of the leftmost
    // open one — the place after the row's last — or in the corner with
    // none open, where it leaves its top bar on the edge.
    this.#stack.attach({
      place: computed(() => slotPosition(this.#held().length)),
      occupied: computed(() => this.#held().length > 0),
    });
  }

  /**
   * How many places the edge has, right now: how many whole windows the
   * screen's width holds beside each other — its width over 600px and a
   * gap — never more than {@link MAX_WINDOWS} however wide it is, and never
   * fewer than one however narrow. While anything is on the dock's stack
   * (`stacked`, the stack as it is by default) its counter's room
   * ({@link STACK_COUNTER_WIDTH}) comes off first.
   */
  capacity(stacked = this.#stack.entries().length > 0): number {
    const screen = this.#document.defaultView?.innerWidth ?? Infinity;
    const room = stacked ? STACK_COUNTER_WIDTH + DOCK_GAP : 0;
    const fits = Math.floor((screen - DOCK_GAP - room) / (DOCKED_WIDTH + DOCK_GAP));
    return Math.min(MAX_WINDOWS, Math.max(1, fits));
  }

  /**
   * Compose: a new message the way the settings' Open mode says — popped
   * out (`popOut`, Shift and a click: Gmail's) whatever it says. Call it in
   * the click: a pop-out's browser window opens synchronously, and where
   * the browser blocks it, or on a phone, the message opens here
   * ({@link open}) instead.
   */
  compose(options?: ComposeOptions & { readonly popOut?: boolean }): void {
    const popOut = options?.popOut || this.#preferences.composeOpenMode() === 'pop-out';
    if (popOut && !this.#viewport.compact() && this.#popOuts.open(options?.content ?? null)) {
      return;
    }
    void this.open(options);
  }

  /**
   * Opens a new message at the end of the row on the edge — the newest
   * window, so the leftmost — and brings it to the front. Resolves to its id once the dock is on the page.
   *
   * `mobile` says how it shows on a phone, where it is the screen: as the
   * page itself (the default — no title bar; the back button closes it) or
   * as a window with its own bar.
   *
   * `content` is the message it starts with — a reply's recipients,
   * subject and quoted history (`replyEnvelope`, `replyQuote`) — and
   * `focus` where the caret starts: To by default, the editor for a reply
   * whose rows are already filled.
   *
   * Zoomed, where the settings' Open mode says so — a window on the edge
   * otherwise, pop-out included: this is the message in this tab
   * ({@link compose} pops it out).
   *
   * A message with every place taken by messages — minimized windows hold
   * none — or with {@link MAX_MESSAGES} messages open and stacked, has
   * nothing new to open: the oldest message comes back instead — restored
   * if it was minimized, in front, with the caret in it.
   *
   * A note always opens, however many there are: a note is a line jotted
   * down, not a message to keep track of. With no place free it takes the
   * place of the last note opened on the edge, which goes onto the stack
   * (the last window, where no note is there). A note on the edge gives
   * way to a new message the same way.
   */
  async open(options?: ComposeOptions): Promise<number> {
    await this.#mount();
    const kind = options?.kind ?? 'compose';
    const messages = this.#windows().filter((w) => w.kind === 'compose');
    const full = () => this.#held().length >= this.capacity();
    if (
      kind === 'compose' &&
      (messages.length >= MAX_MESSAGES ||
        (full() && messages.length > 0 && !this.#held().some((w) => w.kind !== 'compose')))
    ) {
      const oldest = messages[0];
      this.reveal(oldest.id);
      return oldest.id;
    }
    // Room for it: the newest note on the edge goes onto the stack — the
    // newest window, for a note among messages only — until there is a
    // place (the stack's counter may take one too).
    while (full()) {
      const held = [...this.#held()].reverse();
      const last =
        held.find((w) => w.kind !== 'compose' && w.mode === 'docked') ??
        held.find((w) => w.mode === 'docked') ??
        held[0];
      this.minimize(last.id);
    }
    const open = this.#windows();
    const id = this.#nextId++;
    const sheet = this.#viewport.compact() ? 'mobile' : 'desktop';
    // Zoomed (the settings' Open mode): the dialog, one at a time — any
    // other goes back to its place.
    const zoom =
      kind === 'compose' && sheet === 'desktop' && this.#preferences.composeOpenMode() === 'zoom';
    this.#commit([
      ...(zoom
        ? open.map((w) => (w.mode === 'expanded' ? { ...w, mode: 'docked' as const } : w))
        : open),
      {
        id,
        kind,
        item: options?.item ?? null,
        slot: 0,
        mode: zoom ? 'expanded' : 'docked',
        pin: null,
        mobile: options?.mobile ?? 'page',
        sheet,
        restored: options?.content ?? null,
        focus: options?.focus ?? 'to',
        guard: null,
      },
    ]);
    this.#front.set(id);
    return id;
  }

  /**
   * Puts a closed window back as it was — its message, the inline parts its
   * HTML names and the id it went by — which is what the browser's forward
   * button does after a back press closed it (see BackButton). Back into
   * the row where its age puts it; with every place taken there is nowhere
   * to put it back, and the press does nothing rather than push a window
   * off the edge.
   *
   * Never minimized, whatever it was: a window the browser is handing back
   * is one the user is being shown again.
   */
  reopen(window: ComposeWindow): void {
    if (this.#find(window.id)) return;
    if (this.#held().length >= this.capacity()) return;
    const mode = window.mode === 'minimized' ? 'docked' : window.mode;
    this.#commit([...this.#windows(), { ...window, mode }]);
    this.#front.set(window.id);
  }

  /** The windows holding a place on the edge — every one not minimized
      (the dialog keeps its place for coming back to), oldest first. */
  #held(): ComposeWindow[] {
    return this.#windows().filter((w) => w.mode !== 'minimized');
  }

  /** The windows as they are from now on: oldest first (ids are handed out
      in opening order — a window put back goes where its id says), and the
      open ones placed from the corner out in that order, no gap between
      them. A window whose place has not changed is left the object it was,
      so nothing that reads it sees a change. */
  #commit(windows: readonly ComposeWindow[]): void {
    let slot = 0;
    this.#windows.set(
      [...windows]
        .sort((a, b) => a.id - b.id)
        .map((w) => {
          if (w.mode === 'minimized') return w;
          const place = slot++;
          return w.slot === place ? w : { ...w, slot: place };
        }),
    );
  }

  /** Takes a minimized window off the stack, back into the row on the edge
      (`mode`: docked, or the dialog). With no place free beside what is
      left on the stack, the oldest open window goes onto it first — a
      docked one before the dialog. */
  #unstack(id: number, mode: 'docked' | 'expanded'): void {
    const key = windowStackKey(this.#find(id)!);
    const stacked = () => this.#stack.entries().some((entry) => entry.key !== key);
    for (;;) {
      const held = this.#held();
      if (held.length < this.capacity(stacked())) break;
      const oldest = held.find((w) => w.mode === 'docked') ?? held[0];
      this.minimize(oldest.id);
    }
    this.#stack.remove(key);
    this.#set(id, { mode });
  }

  /** Brings a window back: on the edge (never left minimized), in front,
      and holding the caret. */
  reveal(id: number): void {
    const window = this.#find(id);
    if (!window) return;
    if (window.mode === 'minimized') this.dock(id);
    this.#front.set(id);
    this.#wanted.set({ id, seq: ++this.#seq });
  }

  /** Closes the window — its message goes with it, unless something took a
      copy of it first ({@link reopen}). Focus goes back to where it was when
      the window opened — the window's focus trap hands it back as it goes.
      The newer windows on the edge move in over its place. */
  close(id: number): void {
    const closing = this.#find(id);
    if (!closing) return;
    this.#stack.remove(windowStackKey(closing));
    this.#commit(this.#windows().filter((w) => w.id !== id));
    if (this.#front() === id) this.#front.set(this.#windows().at(-1)?.id ?? null);
  }

  /** Closes every window, those on the stack with them — what is in them
      goes. For a host whose windows belong to what is being left. */
  closeAll(): void {
    for (const window of this.#windows()) this.close(window.id);
  }

  /** Onto the stack, on top: the window gives its place on the edge up,
      and the newer ones move in over it. The stack folds — a pointer is on the window minimizing, not on it. */
  minimize(id: number): void {
    const window = this.#find(id);
    if (!window || window.mode === 'minimized') return;
    this.#set(id, { mode: 'minimized' });
    this.#stack.push({
      key: windowStackKey(window),
      kind: window.kind,
      icon: WINDOW_KIND_ICONS[window.kind],
      restore: () => this.dock(id),
      close: () => this.close(id),
    });
  }

  /** Back to the edge — from the stack, into the row where its age puts it
      (see {@link #unstack}), or from the dialog, whose place the row kept —
      or to where a drag pinned it. */
  dock(id: number): void {
    const window = this.#find(id);
    if (!window) return;
    if (window.mode === 'minimized') this.#unstack(id, 'docked');
    else this.#set(id, { mode: 'docked' });
    this.#front.set(id);
  }

  /** The dialog: any other expanded window goes back to its place first;
      a minimized one comes off the stack for it. */
  expand(id: number): void {
    if (this.#find(id)?.mode === 'minimized') this.#unstack(id, 'expanded');
    this.#commit(
      this.#windows().map((w) =>
        w.id === id
          ? { ...w, mode: 'expanded' }
          : w.mode === 'expanded'
            ? { ...w, mode: 'docked' }
            : w,
      ),
    );
    this.#front.set(id);
  }

  /** The dialog, if there is one, back to its place. */
  collapse(): void {
    const dialog = this.expanded();
    if (dialog) this.dock(dialog.id);
  }

  /** Pins the window where a drag has put it: px from the right side of
      the screen, in place of its own. */
  pinTo(id: number, pin: number): void {
    this.#set(id, { pin });
  }

  /** Draws the window over the others. */
  raise(id: number): void {
    if (this.#find(id)) this.#front.set(id);
  }

  #find(id: number): ComposeWindow | undefined {
    return this.#windows().find((w) => w.id === id);
  }

  #set(id: number, change: Partial<Pick<ComposeWindow, 'mode' | 'pin'>>): void {
    this.#commit(this.#windows().map((w) => (w.id === id ? { ...w, ...change } : w)));
  }

  /** Puts the dock on the page, once: its code is fetched on the first
      open, and it stays for the next. */
  #mount(): Promise<ComponentRef<unknown>> {
    this.#dock ??= import('../../content/partials/shared/compose-window/compose-dock').then(
      ({ ComposeDock }) => {
        const ref = createComponent(ComposeDock, { environmentInjector: this.#injector });
        this.#app.attachView(ref.hostView);
        this.#document.body.appendChild(ref.location.nativeElement);
        return ref;
      },
    );
    return this.#dock;
  }
}
