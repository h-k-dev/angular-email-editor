import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { InteractivityChecker } from '@angular/cdk/a11y';

import { provideAppCalendarHost } from '../calendar-host/app-calendar-host';
import { DockStack } from '../dock/dock-stack';
import { ComposeWindows } from '../email/compose-windows';
import { CalendarEvents } from './calendar-events';
import { EventDrafts } from './event-drafts';

beforeEach(() => {
  vi.spyOn(InteractivityChecker.prototype, 'isVisible').mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe('EventDrafts', () => {
  let drafts: EventDrafts;
  let windows: ComposeWindows;
  let stack: DockStack;
  let app: ApplicationRef;

  const frames = () => [...document.querySelectorAll<HTMLElement>('section[compose-window]')];
  const settle = () => app.whenStable();
  const realWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const field = (frame: Element, type: string, index = 0) =>
    frame.querySelectorAll<HTMLInputElement>(`[event-sheet] input[type="${type}"]`)[index];
  const type = async (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideAppCalendarHost()] });
    drafts = TestBed.inject(EventDrafts);
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

  it('a new event opens in the frame a message does, with the rows of an event in it', async () => {
    const id = drafts.add();
    await settle();

    expect(windows.windows().map((w) => [w.kind, w.item, w.mode])).toEqual([
      ['event', id, 'docked'],
    ]);
    const [frame] = frames();
    expect(frame.getAttribute('data-kind')).toBe('event');
    const title = () => frame.querySelector('.compose-window__title')!.textContent!.trim();
    expect(title()).toBe('New event');
    expect(frame.querySelector('.compose-window__kind')!.textContent!.trim()).toBe('event');
    // An hour, from a full hour — and nothing to save before it has a
    // title.
    const draft = drafts.find(id)!;
    expect(draft.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00$/);
    expect(draft.end > draft.start).toBe(true);
    const save = frame.querySelector<HTMLButtonElement>('[event-sheet] button[type="submit"]')!;
    expect(save.disabled).toBe(true);

    await type(field(frame, 'text'), 'Launch review');
    expect(title()).toBe('Launch review');
    expect(save.disabled).toBe(false);
    // An end before its start is no event.
    await type(field(frame, 'datetime-local', 1), '2000-01-01T00:00');
    expect(save.disabled).toBe(true);
  });

  it('minimized it is on the stack with the rest, under its own mark; saved it is in the calendar and its window is gone', async () => {
    const id = drafts.add();
    await windows.open(); // a message beside it
    await settle();
    const [frame] = frames();
    await type(field(frame, 'text'), 'Launch review');
    await type(field(frame, 'datetime-local', 0), '2026-12-01T09:00');
    await type(field(frame, 'datetime-local', 1), '2026-12-01T10:30');
    await type(field(frame, 'text', 1), 'Room 4');

    windows.minimize(windows.windows()[0].id);
    await settle();
    expect(stack.hiddenKinds()).toEqual([{ kind: 'event', icon: 'event' }]);
    expect(stack.labelOf(stack.entries()[0].key)).toBe('Launch review');
    windows.dock(windows.windows()[0].id);
    await settle();

    frame.querySelector<HTMLButtonElement>('[event-sheet] button[type="submit"]')!.click();
    await settle();
    await vi.waitFor(() => expect(drafts.drafts()).toEqual([]));
    await settle();
    expect(TestBed.inject(CalendarEvents).events()).toEqual([
      expect.objectContaining({
        title: 'Launch review',
        start: '2026-12-01T09:00',
        end: '2026-12-01T10:30',
        allDay: false,
        location: 'Room 4',
      }),
    ]);
    expect(windows.windows().map((w) => w.kind)).toEqual(['compose']);
    expect(drafts.find(id)).toBeUndefined();
  });
});
