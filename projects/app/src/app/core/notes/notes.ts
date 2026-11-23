import {
  PendingTasks,
  Service,

  // Signals
  computed,
  inject,
  signal,
} from '@angular/core';

import { ComposeWindow, ComposeWindows } from '../email/compose-windows';

/** One note: a few lines kept beside the mail. */
export interface Note {
  readonly id: number;
  readonly text: string;
}

/** Where a note is: in a window on the edge, minimized onto the dock's
    stack, or closed — kept, with no window. */
export type NoteState = 'open' | 'minimized' | 'closed';

/**
 * Notes: a second kind of thing in the windows on the edge
 * (`ComposeWindows`, kind `note`). A note opens in the same frame a message
 * does — the same row, the same dialog, the same stack and counter when it
 * minimizes — with its own content in it. This only keeps what is written;
 * where a note's window is, is the windows'.
 *
 * Kept for the session only.
 */
@Service()
export class Notes {
  readonly #windows = inject(ComposeWindows);
  readonly #tasks = inject(PendingTasks);

  readonly #notes = signal<readonly Note[]>([]);
  /** Every note, oldest first. */
  readonly notes = this.#notes.asReadonly();

  /** The windows that hold a note, by the note's id. */
  readonly #held = computed(() => {
    const held = new Map<number, ComposeWindow>();
    for (const window of this.#windows.windows()) {
      if (window.kind === 'note' && window.item !== null) held.set(window.item, window);
    }
    return held;
  });

  #nextId = 1;

  /** A new note, in a window of its own on the edge — always: with no
      place free there it takes the last note's, which goes onto the stack
      (`ComposeWindows.open`). Add as many as you like. */
  add(): number {
    const id = this.#nextId++;
    this.#notes.update((notes) => [...notes, { id, text: '' }]);
    this.#show(id);
    return id;
  }

  /** Shows a note: its window back on the edge, in front — or a new one
      for a note that has none. */
  open(id: number): void {
    if (!this.find(id)) return;
    const window = this.#held().get(id);
    if (window) this.#windows.reveal(window.id);
    else this.#show(id);
  }

  /** Throws the note away, its window with it. */
  remove(id: number): void {
    const window = this.#held().get(id);
    if (window) this.#windows.close(window.id);
    this.#notes.update((notes) => notes.filter((note) => note.id !== id));
  }

  /** A window for the note — a pending task, so the app is not stable
      until it is on the edge (the dock's code is fetched on the first). */
  #show(id: number): void {
    void this.#tasks.run(() => this.#windows.open({ kind: 'note', item: id, mobile: 'window' }));
  }

  write(id: number, text: string): void {
    this.#notes.update((notes) => notes.map((note) => (note.id === id ? { ...note, text } : note)));
  }

  find(id: number): Note | undefined {
    return this.#notes().find((note) => note.id === id);
  }

  /** Where the note is. Reactive. */
  state(id: number): NoteState {
    const window = this.#held().get(id);
    if (!window) return 'closed';
    return window.mode === 'minimized' ? 'minimized' : 'open';
  }

  /** What the note is called: its first line — `undefined` before it has
      one, for whoever names an unnamed note. Reactive. */
  title(id: number): string | undefined {
    return this.find(id)?.text.trim().split('\n')[0] || undefined;
  }
}
