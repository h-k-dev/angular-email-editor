import {
  Injector,
  PendingTasks,
  Service,

  // Signals
  computed,
  inject,
  signal,
} from '@angular/core';

import { ComposeWindow, ComposeWindows } from '../email/compose-windows';

/** A calendar event being written in a window on the edge: what the
    window's form holds until it is saved. Moments are the calendar's own
    (`yyyy-MM-ddTHH:mm`, local) — what a `datetime-local` field reads and
    writes. */
export interface EventDraft {
  readonly id: number;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly location: string;
}

/** A moment as the calendar writes it, `yyyy-MM-ddTHH:mm`, local. */
function moment(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * Events being written, as windows: a third kind of thing in the windows
 * on the edge (`ComposeWindows`, kind `event`), beside messages and notes.
 * A new event opens in the same frame — the same row, the same stack and
 * counter when it minimizes — with a few rows to fill; saved, it goes into
 * the calendar (`CalendarEvents`) and its window closes.
 *
 * The calendar's own code (and Luxon with it) is fetched only when an
 * event is saved: writing one costs nothing of it.
 */
@Service()
export class EventDrafts {
  readonly #windows = inject(ComposeWindows);
  readonly #tasks = inject(PendingTasks);
  readonly #injector = inject(Injector);

  readonly #drafts = signal<readonly EventDraft[]>([]);
  /** Every event being written, oldest first. */
  readonly drafts = this.#drafts.asReadonly();

  /** The windows that hold a draft, by the draft's id. */
  readonly #held = computed(() => {
    const held = new Map<number, ComposeWindow>();
    for (const window of this.#windows.windows()) {
      if (window.kind === 'event' && window.item !== null) held.set(window.item, window);
    }
    return held;
  });

  #nextId = 1;

  /** A new event, in a window of its own on the edge — from the next full
      hour, an hour long. It always opens, as a note does. */
  add(): number {
    const id = this.#nextId++;
    const start = new Date();
    start.setHours(start.getHours() + 1, 0, 0, 0);
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    this.#drafts.update((drafts) => [
      ...drafts,
      { id, title: '', start: moment(start), end: moment(end), location: '' },
    ]);
    void this.#tasks.run(() => this.#windows.open({ kind: 'event', item: id, mobile: 'window' }));
    return id;
  }

  write(id: number, change: Partial<Omit<EventDraft, 'id'>>): void {
    this.#drafts.update((drafts) =>
      drafts.map((draft) => (draft.id === id ? { ...draft, ...change } : draft)),
    );
  }

  find(id: number): EventDraft | undefined {
    return this.#drafts().find((draft) => draft.id === id);
  }

  /** What the draft is called: its title — `undefined` before it has one.
      Reactive. */
  title(id: number): string | undefined {
    return this.find(id)?.title.trim() || undefined;
  }

  /** Whether the draft can be saved: it has a title, and ends after it
      starts. Reactive. */
  valid(id: number): boolean {
    const draft = this.find(id);
    return !!draft && !!draft.title.trim() && !!draft.start && draft.end > draft.start;
  }

  /** Into the calendar, and its window closes. Resolves to whether it was
      saved. */
  async save(id: number): Promise<boolean> {
    const draft = this.find(id);
    if (!draft || !this.valid(id)) return false;
    const [{ CalendarEvents }, { DEFAULT_EVENT_COLOR }] = await Promise.all([
      import('./calendar-events'),
      import('./calendar-event'),
    ]);
    this.#injector.get(CalendarEvents).create({
      title: draft.title.trim(),
      start: draft.start,
      end: draft.end,
      allDay: false,
      color: DEFAULT_EVENT_COLOR,
      location: draft.location.trim(),
      description: '',
    });
    this.remove(id);
    return true;
  }

  /** Throws the draft away, its window with it. */
  remove(id: number): void {
    const window = this.#held().get(id);
    if (window) this.#windows.close(window.id);
    this.#drafts.update((drafts) => drafts.filter((draft) => draft.id !== id));
  }
}
