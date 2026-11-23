import {
  ApplicationRef,
  DOCUMENT,
  EnvironmentInjector,
  PendingTasks,
  Service,
  Signal,
  createComponent,
  inject,

  // Signals
  computed,
  signal,
} from '@angular/core';

/** Between two places on the bottom edge, and between the first and the
    screen's side, px. */
export const DOCK_GAP = 16;

/** The stack's counter: a pill of its own beside whatever is open on the
    edge, px — all the room the stack takes there (its bars only show
    fanned out, over everything). */
export const STACK_COUNTER_WIDTH = 40;
/** Between the stack's counter and the bar it stands beside when nothing
    is open on the edge, px. */
export const STACK_COUNTER_GAP = 8;

/** How long the stack stays fanned out after the pointer (or the focus)
    leaves it, ms — long enough to cross the gap between two of its bars. */
export const STACK_CLOSE_DELAY = 250;

/** One thing minimized onto the stack — a compose window, a note, whatever
    minimizes onto the edge. The stack keeps its name, its sort and the two
    things its menu can do with it: what it is, is its owner's. */
export interface DockStackEntry {
  /** Its name on the stack — unique across every kind (`compose:3`,
      `note:12`). The element that is the thing itself says the same
      (`DockStackItem`), and names it for the menu. */
  readonly key: string;
  /** What sort of thing it is (`compose`, `note`): the stack counts its
      hidden entries by it ({@link DockStack.hiddenByKind}). */
  readonly kind: string;
  /** Its kind's mark in the stack's menu, where it has one (a Material
      symbol's name). */
  readonly icon?: string;
  /** Brings it back from the stack — its row in the menu, pressed. */
  readonly restore: () => void;
  /** Closes it where it is — the row's close button. */
  readonly close: () => void;
}

/** The edge the stack stands on, as whoever lays it out sees it. */
export interface DockEdge {
  /** Where the stack goes, as px from the right side of the screen: left
      of the leftmost thing open on the edge, or the corner with nothing
      open. */
  readonly place: Signal<number>;
  /** Whether anything is open on the edge. */
  readonly occupied: Signal<boolean>;
}

/**
 * The stack of minimized things on the bottom edge, the way a dock's stack
 * holds its files — and nothing but its state: what is on it, in what
 * order, whether it is fanned out. It knows no compose window: an owner
 * pushes an entry when its thing minimizes and removes it when it comes
 * back or closes, and any number of owners share the one stack and its one
 * counter.
 *
 * - **Folded**, beside something open on the edge, it shows nothing of its
 *   entries: only its counter, saying how many there are. With nothing
 *   open, its top bar — the last thing minimized — stays on the edge, so
 *   the edge is never down to a counter alone, and the counter counts the
 *   ones under it ({@link shown}, {@link hidden}).
 * - **Open** — a pointer over its counter or its menu, or the focus in
 *   them — the entries out of sight show as a menu over the counter
 *   ({@link open}, {@link hiddenEntries}): a list that scrolls, each row
 *   bringing its entry back.
 *
 * Who draws what: the thing itself is its owner's element, marked
 * `DockStackItem` — out of sight while it is on the stack, but for the bar
 * on the edge, which is that element itself (`styles/_dock-stack`) — and
 * the directive names it for the menu. The counter and the menu are
 * `DockStackCounter` and `DockStackMenu`, on a layer the stack mounts
 * itself the first time anything goes onto it.
 */
@Service()
export class DockStack {
  readonly #document = inject(DOCUMENT);
  readonly #app = inject(ApplicationRef);
  readonly #injector = inject(EnvironmentInjector);
  readonly #tasks = inject(PendingTasks);
  #layer = false;

  readonly #entries = signal<readonly DockStackEntry[]>([]);
  /** What is on the stack, top first — the last thing minimized. */
  readonly entries = computed(() => [...this.#entries()].reverse());

  readonly #edge = signal<DockEdge | null>(null);
  /** Where the stack sits, as px from the right side of the screen: where
      the edge's owner says ({@link attach}) — the corner until one does. */
  readonly place = computed(() => this.#edge()?.place() ?? DOCK_GAP);

  /** How many of its bars the edge shows while the stack is folded: the
      top one when nothing is open there; none beside something open, where
      the counter is enough. */
  readonly shown = computed(() => (this.#entries().length && !this.#edge()?.occupied() ? 1 : 0));
  /** The entries the folded stack keeps out of sight, top first — what its
      counter counts, and what its menu lists. */
  readonly hiddenEntries = computed(() => this.entries().slice(this.shown()));
  readonly hidden = computed(() => this.hiddenEntries().length);
  /** The entries out of sight, counted by kind — in the order the kinds
      first come up from the top. One kind is one number; more are what a
      counter breaks its total down by. */
  readonly hiddenByKind = computed(() => {
    const counts = new Map<string, number>();
    for (const entry of this.hiddenEntries()) {
      counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
    }
    return counts;
  });

  readonly #open = signal(false);
  /** Whether the stack is fanned out. With nothing out of sight there is
      nothing to fan. */
  readonly open = computed(() => this.#open() && this.hidden() > 0);
  #timer: ReturnType<typeof setTimeout> | undefined;

  /** What each entry is called, by its key: said by the element that is
      the thing (`DockStackItem.bind`), which knows — a message's subject, a
      note's first line. */
  readonly #labels = signal<ReadonlyMap<string, () => string>>(new Map());

  /** The counter's element, while there is one on the page: where the
      focus goes back to when the stack folds under it. */
  readonly counter = signal<HTMLElement | null>(null);

  /** Whoever lays the edge out says where the stack stands on it, and
      whether anything is open there. */
  attach(edge: DockEdge): void {
    this.#edge.set(edge);
  }

  /** Onto the stack, on top. The stack folds: a pointer is on the thing
      minimizing, not on it. */
  push(entry: DockStackEntry): void {
    this.#mount();
    this.#entries.update((entries) => [...entries.filter((e) => e.key !== entry.key), entry]);
    this.fold(true);
  }

  /** Off the stack — restored, or closed. */
  remove(key: string): void {
    this.#entries.update((entries) => entries.filter((e) => e.key !== key));
  }

  /** Where an entry is on the stack — 0 its top — or -1 off it. */
  indexOf(key: string): number {
    return this.entries().findIndex((e) => e.key === key);
  }

  /** Opens the stack's menu — a pointer came over it, or the focus into it. */
  fan(): void {
    clearTimeout(this.#timer);
    this.#open.set(true);
  }

  /** Names an entry for the menu: what its thing is called, read as a
      signal is. Returns the way to take the name back. */
  describe(key: string, label: () => string): () => void {
    this.#labels.update((labels) => new Map(labels).set(key, label));
    return () =>
      this.#labels.update((labels) => {
        if (labels.get(key) !== label) return labels;
        const rest = new Map(labels);
        rest.delete(key);
        return rest;
      });
  }

  /** What an entry is called — `undefined` where nothing has named it.
      Reactive. */
  labelOf(key: string): string | undefined {
    return this.#labels().get(key)?.();
  }

  /** Folds the stack back — after {@link STACK_CLOSE_DELAY}, so a pointer
      crossing from the counter to the menu keeps it open, or at once. */
  fold(now = false): void {
    clearTimeout(this.#timer);
    if (now) this.#open.set(false);
    else this.#timer = setTimeout(() => this.#open.set(false), STACK_CLOSE_DELAY);
  }

  /** The counter, pressed: a touch has no hover to fan the stack with. */
  toggle(): void {
    if (this.open()) this.fold(true);
    else this.fan();
  }

  /** Puts the stack's own layer — its counter — on the page, once, the
      first time anything goes onto it: whoever's thing that is, the stack
      shows its counter itself, and no page has to host an element for it.
      A pending task, so the app is not stable until the counter is there. */
  #mount(): void {
    if (this.#layer) return;
    this.#layer = true;
    this.#tasks.run(async () => {
      const { DockStackLayer } =
        await import('../../content/partials/shared/dock-stack/dock-stack-layer');
      // The app went meanwhile (a spec's): nothing to mount on.
      if (this.#app.destroyed) return;
      const ref = createComponent(DockStackLayer, { environmentInjector: this.#injector });
      this.#app.attachView(ref.hostView);
      this.#document.body.appendChild(ref.location.nativeElement);
    });
  }
}
