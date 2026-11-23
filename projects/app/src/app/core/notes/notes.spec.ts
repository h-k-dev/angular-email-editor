import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { InteractivityChecker } from '@angular/cdk/a11y';

import { DockStack } from '../dock/dock-stack';
import { ComposeWindows } from '../email/compose-windows';
import { EMAIL_SEND_LATENCY } from '../email/email-send';
import { Notes } from './notes';

// jsdom lacks what a message's editor needs at mount (see
// compose-windows.spec.ts): a note shares the edge with messages.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
HTMLCanvasElement.prototype.getContext = (() => ({
  font: '',
  measureText: (text: string) => ({ width: text.length * 7 }),
})) as never;

beforeEach(() => {
  vi.spyOn(InteractivityChecker.prototype, 'isVisible').mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe('Notes', () => {
  let notes: Notes;
  let windows: ComposeWindows;
  let stack: DockStack;
  let app: ApplicationRef;

  const frames = () => [...document.querySelectorAll<HTMLElement>('section[compose-window]')];
  const counter = () => document.querySelector<HTMLButtonElement>('[dock-stack-counter]');
  const titleOf = (frame: Element) =>
    frame.querySelector<HTMLButtonElement>('.compose-window__title')!;
  const settle = () => app.whenStable();

  const realWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: EMAIL_SEND_LATENCY, useValue: 0 }],
    });
    notes = TestBed.inject(Notes);
    windows = TestBed.inject(ComposeWindows);
    stack = TestBed.inject(DockStack);
    app = TestBed.inject(ApplicationRef);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 2000 });
  });

  afterEach(() => {
    document.querySelector('[compose-dock]')?.remove();
    document.querySelector('[dock-stack-layer]')?.remove();
    if (realWidth) Object.defineProperty(window, 'innerWidth', realWidth);
  });

  it('a note opens in the frame a message does — a window in the same row — with its own content', async () => {
    await windows.open();
    const id = notes.add();
    await settle();

    // One row: the message in the corner, the note beside it.
    expect(windows.windows().map((w) => [w.kind, w.note, w.mode, w.slot])).toEqual([
      ['compose', null, 'docked', 0],
      ['note', id, 'docked', 1],
    ]);
    const [message, note] = frames();
    expect(note.getAttribute('data-kind')).toBe('note');
    expect(note.getAttribute('role')).toBe('dialog');
    // The same title bar: its name, minimize, full screen, close — and no
    // pop-out, which is a message's.
    expect(titleOf(note).textContent!.trim()).toBe('Note 1');
    expect(note.querySelector('.compose-window__kind')).not.toBeNull();
    expect(message.querySelector('.compose-window__kind')).toBeNull();
    const controls = (frame: Element) =>
      [...frame.querySelectorAll('[data-slot="controls"] button')].map((button) =>
        button.getAttribute('aria-label'),
      );
    expect(controls(message)).toEqual(['Pop out', 'Minimize', 'Full screen', 'Close']);
    expect(controls(note)).toEqual(['Minimize', 'Full screen', 'Close']);
    // Its own content: the note, and no message form.
    expect(note.querySelector('[note-sheet] textarea')).not.toBeNull();
    expect(note.querySelector('[message-form]')).toBeNull();
    expect(message.querySelector('[message-form]')).not.toBeNull();

    // What is written is the note's, and names its window.
    const text = note.querySelector<HTMLTextAreaElement>('textarea')!;
    text.value = 'Call Ada\nabout the launch';
    text.dispatchEvent(new Event('input'));
    await settle();
    expect(notes.find(id)!.text).toBe('Call Ada\nabout the launch');
    expect(titleOf(note).textContent!.trim()).toBe('Call Ada');
  });

  it('minimized, it goes onto the same stack as a message, under one counter with a bubble a kind', async () => {
    const message = await windows.open();
    const first = notes.add();
    const second = notes.add();
    await settle();
    expect(notes.state(first)).toBe('open');

    windows.minimize(message);
    windows.minimize(windows.windows().find((w) => w.note === first)!.id);
    await settle();
    expect(notes.state(first)).toBe('minimized');
    expect(stack.entries().map((entry) => entry.kind)).toEqual(['note', 'compose']);
    // The second note is still open: only the counter shows, counting both.
    expect(counter()!.firstChild!.textContent!.trim()).toBe('2');
    expect(
      [...counter()!.querySelectorAll<HTMLElement>('.dock-stack-counter__kind')].map((bubble) => [
        bubble.dataset['kind'],
        bubble.textContent!.trim(),
      ]),
    ).toEqual([
      ['note', '1'],
      ['compose', '1'],
    ]);
    expect(notes.state(second)).toBe('open');

    // Its row in the stack's menu restores it, as a message's does.
    stack.fan();
    await settle();
    const row = document.querySelector<HTMLElement>('.dock-stack-menu__row')!;
    expect(row.dataset['kind']).toBe('note');
    expect(row.querySelector('mat-icon')!.textContent!.trim()).toBe('sticky_note_2');
    const name = row.querySelector<HTMLButtonElement>('.dock-stack-menu__name')!;
    expect(name.textContent!.trim()).toBe('Note 1');
    name.click();
    await settle();
    expect(notes.state(first)).toBe('open');
  });

  it("a new note always opens: on a full edge it takes the last note's place, which goes onto the stack", async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 }); // two places
    const message = await windows.open();
    const first = notes.add();
    await settle();
    const edge = () =>
      windows
        .windows()
        .filter((w) => w.mode !== 'minimized')
        .map((w) => [w.kind, w.note, w.slot]);
    expect(edge()).toEqual([
      ['compose', null, 0],
      ['note', first, 1],
    ]);

    // No place free: the note on the edge makes room — the message stays.
    const second = notes.add();
    await settle();
    expect(edge()).toEqual([
      ['compose', null, 0],
      ['note', second, 1],
    ]);
    expect(notes.state(first)).toBe('minimized');

    // And again, as often as asked: there is no end to the notes.
    const more = Array.from({ length: 8 }, () => notes.add());
    await settle();
    expect(notes.notes()).toHaveLength(10);
    expect(edge()).toEqual([
      ['compose', null, 0],
      ['note', more.at(-1), 1],
    ]);
    expect(stack.entries().map((entry) => entry.kind)).toEqual(Array(9).fill('note'));
    expect(windows.windows().find((w) => w.id === message)!.mode).toBe('docked');
  });

  it("among messages only, a new note takes the last window's place; a new message takes a note's", async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 });
    const first = await windows.open();
    const second = await windows.open();
    await settle();

    // Messages hold both places: the newer one goes onto the stack.
    const note = notes.add();
    await settle();
    const modeOf = (id: number) => windows.windows().find((w) => w.id === id)!.mode;
    expect([modeOf(first), modeOf(second), notes.state(note)]).toEqual([
      'docked',
      'minimized',
      'open',
    ]);

    // A message with a note on the edge: the note gives way…
    const third = await windows.open();
    await settle();
    expect(third).not.toBe(first);
    expect([modeOf(first), modeOf(third), notes.state(note)]).toEqual([
      'docked',
      'docked',
      'minimized',
    ]);

    // …but with messages in every place, Compose is the oldest message, as
    // it always was.
    expect(await windows.open()).toBe(first);
  });

  it('closing its window keeps the note; opening it again gives it a new one, and removing it takes both', async () => {
    const id = notes.add();
    await settle();
    notes.write(id, 'Kept');
    frames()[0].querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click();
    await settle();
    expect(notes.state(id)).toBe('closed');
    expect(notes.find(id)!.text).toBe('Kept');
    expect(frames()).toEqual([]);

    notes.open(id);
    await settle();
    expect(notes.state(id)).toBe('open');
    expect(frames()[0].querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Kept');
    // Asked for again, it is the same window — in front, not another.
    notes.open(id);
    await settle();
    expect(frames()).toHaveLength(1);

    notes.remove(id);
    await settle();
    expect(notes.notes()).toEqual([]);
    expect(frames()).toEqual([]);
  });
});
