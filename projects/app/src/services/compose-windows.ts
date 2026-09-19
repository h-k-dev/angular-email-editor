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

/** How a compose window shows, Gmail's three states:
    - `docked`: a window in its place on the bottom edge of the screen;
    - `minimized`: only its title bar, in that same place;
    - `expanded`: a 16:9 dialog in the middle of the screen, over a scrim —
      one at a time. */
export type ComposeWindowMode = 'docked' | 'minimized' | 'expanded';

/** One open compose window. */
export interface ComposeWindow {
  readonly id: number;
  /** Which place on the edge is this window's, counted from the corner: 0
      is the corner itself, 1 the one beside it, and so on. Taken when the
      window opens and held until it closes — windows never shuffle, so
      nothing on the edge moves when a neighbour opens, minimizes, leaves
      for the dialog or closes. A place given up is free for the next
      window. */
  readonly slot: number;
  readonly mode: ComposeWindowMode;
  /** Where a drag has put the window instead — px from the right side of
      the screen (ProtonMail's sideways drag) — or `null` while it sits in
      its own place. A patch over {@link slotPosition}, and the window
      returns to it after the dialog as it does to its place. */
  readonly pin: number | null;
  /** Where focus was when the window opened: it goes back there when the
      window closes. */
  readonly opener: HTMLElement | null;
}

/** A docked window's width, px: exactly the sheet's own measure — the
    email is designed for 600px, so the window is that wide and never
    squeezed. */
export const DOCKED_WIDTH = 600;
/** A minimized window's width, px: its title bar, in the same place as the
    window it belongs to. */
export const MINIMIZED_WIDTH = 280;
/** Between two places on the edge, and between the first and the screen's
    side, px. */
export const DOCK_GAP = 16;

/** However wide the screen, never more messages open than this: three is
    what anyone keeps track of, and a fourth Compose is far more often the
    message already started than a new one. */
export const MAX_WINDOWS = 3;

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
 * - **A place of its own.** Every window takes a place on the bottom edge
 *   when it opens — the corner first, then leftwards — and keeps it: the
 *   places are worked out from their numbers ({@link slotPosition}), not
 *   from what happens to be open, so nothing ever slides sideways because
 *   a neighbour opened, minimized, went to the dialog or closed. A closed
 *   window's place is free for the next one.
 * - **As many as the edge holds**, and never more than {@link MAX_WINDOWS}:
 *   the screen's width over a window's own 600px says how many places there
 *   are ({@link capacity}). Compose with every place taken hands the oldest
 *   window back instead.
 * - **Minimized** to its title bar, in the same place; the title bar
 *   restores it.
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

  #nextId = 1;
  #seq = 0;
  #dock: Promise<ComponentRef<unknown>> | null = null;

  /**
   * How many places the edge has, right now: how many whole windows the
   * screen's width holds beside each other — its width over 600px and a
   * gap — never more than {@link MAX_WINDOWS} however wide it is, and never
   * fewer than one however narrow.
   */
  capacity(): number {
    const screen = this.#document.defaultView?.innerWidth ?? Infinity;
    const fits = Math.floor((screen - DOCK_GAP) / (DOCKED_WIDTH + DOCK_GAP));
    return Math.min(MAX_WINDOWS, Math.max(1, fits));
  }

  /**
   * Opens a new message in the first free place on the edge and brings it
   * to the front. Resolves to its id once the dock is on the page.
   *
   * With every place taken there is nothing new to open: the oldest window
   * comes back instead — restored if it was minimized, in front, with the
   * caret in it.
   */
  async open(): Promise<number> {
    await this.#mount();
    const open = this.#windows();
    const slot = this.#freeSlot();
    if (slot >= this.capacity()) {
      const oldest = open[0];
      this.reveal(oldest.id);
      return oldest.id;
    }
    const id = this.#nextId++;
    const opener = this.#document.activeElement as HTMLElement | null;
    this.#windows.update((windows) => [
      ...windows,
      { id, slot, mode: 'docked', pin: null, opener },
    ]);
    this.#front.set(id);
    return id;
  }

  /** The place nearest the corner that no window holds. */
  #freeSlot(): number {
    const taken = new Set(this.#windows().map((w) => w.slot));
    let slot = 0;
    while (taken.has(slot)) slot++;
    return slot;
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

  /** Closes the window — its message goes with it — and hands focus back to
      where it was when the window opened. Its place on the edge is free for
      the next window; the windows still open stay where they are. */
  close(id: number): void {
    const closing = this.#find(id);
    if (!closing) return;
    this.#windows.update((windows) => windows.filter((w) => w.id !== id));
    if (this.#front() === id) this.#front.set(this.#windows().at(-1)?.id ?? null);
    if (closing.opener?.isConnected) closing.opener.focus();
  }

  minimize(id: number): void {
    this.#set(id, { mode: 'minimized' });
  }

  /** Back to the edge — from minimized, or from the dialog — which is back
      to its own place, or to where a drag pinned it. */
  dock(id: number): void {
    this.#set(id, { mode: 'docked' });
    this.#front.set(id);
  }

  /** The dialog: any other expanded window goes back to its place first. */
  expand(id: number): void {
    this.#windows.update((windows) =>
      windows.map((w) =>
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
    this.#windows.update((windows) => windows.map((w) => (w.id === id ? { ...w, ...change } : w)));
  }

  /** Puts the dock on the page, once: its code is fetched on the first
      open, and it stays for the next. */
  #mount(): Promise<ComponentRef<unknown>> {
    this.#dock ??= import('../app/compose-window/compose-dock').then(({ ComposeDock }) => {
      const ref = createComponent(ComposeDock, { environmentInjector: this.#injector });
      this.#app.attachView(ref.hostView);
      this.#document.body.appendChild(ref.location.nativeElement);
      return ref;
    });
    return this.#dock;
  }
}
