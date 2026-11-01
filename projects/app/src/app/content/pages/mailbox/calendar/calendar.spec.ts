import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { CalendarEvent } from '../../../../core/calendar/calendar-event';
import { HOLIDAY_SOURCE } from '../../../../core/calendar/holidays';
import { CALENDAR_ROUTES } from './calendar.routes';

const KEY = 'angular-email-editor:calendar-events';

const COFFEE: CalendarEvent = {
  id: 'coffee',
  title: 'Coffee',
  start: '2026-10-28T10:00',
  end: '2026-10-28T11:00',
  allDay: false,
  color: 'peacock',
  location: 'Alexanderplatz',
  description: '',
};

describe('CalendarPage — the events’ context menu', () => {
  let harness: RouterTestingHarness;
  let root: HTMLElement;

  const stored = (): CalendarEvent[] => JSON.parse(localStorage.getItem(KEY) ?? '[]');
  /** A turn for the menu's deferred open, then the page settled. */
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve));
    await harness.fixture.whenStable();
  };
  const chip = () => root.querySelector<HTMLElement>('[data-event-id="coffee"]')!;
  const items = () =>
    [...document.querySelectorAll<HTMLElement>('.toolbar-menu [role="menuitem"]')].map((item) => ({
      item,
      text: item.textContent ?? '',
      disabled: item.getAttribute('aria-disabled') === 'true',
    }));
  const pick = async (name: string) => {
    items()
      .find(({ text }) => text.includes(name))!
      .item.click();
    await settle();
  };
  const rightClick = async (target: Element) => {
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await settle();
  };
  const press = async (target: Element, key: string, init: KeyboardEventInit = {}) => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
    await settle();
  };

  beforeEach(async () => {
    localStorage.setItem(KEY, JSON.stringify([COFFEE]));
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [{ path: 'calendar', children: CALENDAR_ROUTES }],
          withComponentInputBinding(),
        ),
        { provide: HOLIDAY_SOURCE, useValue: { holidays: async () => [] } },
      ],
    });
    harness = await RouterTestingHarness.create('/calendar/r/week/2026/10/28');
    root = harness.fixture.nativeElement as HTMLElement;
    await settle();
  });

  afterEach(() => localStorage.removeItem(KEY));

  it('opens on an event with a right-click: edit, cut, copy, duplicate, delete — each with its keys', async () => {
    await rightClick(chip());
    expect(items().map(({ text }) => text.replace(/\s+/g, ' ').trim())).toEqual([
      expect.stringContaining('Edit'),
      expect.stringContaining('Cut'),
      expect.stringContaining('Copy'),
      expect.stringContaining('Duplicate'),
      expect.stringContaining('Delete'),
    ]);
    const copy = items()[2].item;
    expect(copy.getAttribute('aria-keyshortcuts')).toMatch(/^(Meta|Control)\+C$/);
  });

  it('opens no card on a press — Edit in the menu writes the event in the card', async () => {
    chip().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(document.querySelector('.calendar-card')).toBeNull();

    await rightClick(chip());
    await pick('Edit');
    const editor = document.querySelector('.calendar-card calendar-event-editor');
    expect(editor).not.toBeNull();
    expect(editor!.querySelector<HTMLInputElement>('input')!.value).toBe('Coffee');
  });

  it('duplicates an event where it is', async () => {
    await rightClick(chip());
    await pick('Duplicate');
    const events = stored();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ title: 'Coffee', start: COFFEE.start, end: COFFEE.end });
    expect(events[1].id).not.toBe('coffee');
  });

  it('cuts an event, then pastes it at an empty quarter, as long as it was', async () => {
    await rightClick(chip());
    await pick('Cut');
    expect(stored()).toHaveLength(0);

    // No layout here: the pointer reads as the first day's first quarter.
    await rightClick(root.querySelector('.time-grid__day')!);
    expect(items().map(({ text }) => text)).toEqual([
      expect.stringContaining('New event'),
      expect.stringContaining('Paste'),
    ]);
    await pick('Paste');
    const [pasted] = stored();
    expect(pasted).toMatchObject({ title: 'Coffee', location: 'Alexanderplatz' });
    expect(pasted.start.endsWith('T00:00')).toBe(true);
    expect(pasted.end.endsWith('T01:00')).toBe(true);
  });

  it('offers a new event on an empty slot — Paste there only once something is copied', async () => {
    await rightClick(root.querySelector('.time-grid__day')!);
    expect(items().map(({ text, disabled }) => [text.includes('Paste'), disabled])).toEqual([
      [false, false],
      [true, true],
    ]);

    await pick('New event');
    // The new event's title opens, as for one marked on the grid — not
    // the card.
    expect(document.querySelector('.calendar-quick calendar-quick-title')).not.toBeNull();
    expect(document.querySelector('.calendar-card')).toBeNull();
    expect(stored()).toHaveLength(1);
  });

  it('stores an edited event on Save only — not as it is typed or turned, nor on close', async () => {
    await rightClick(chip());
    await pick('Edit');
    let card = document.querySelector('.calendar-card calendar-event-editor')!;
    let title = card.querySelector<HTMLInputElement>('.event-editor__title')!;
    title.value = 'Tea';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    title.blur();
    await settle();
    card.querySelector<HTMLButtonElement>('.event-editor__more')!.click();
    await settle();
    card.querySelector<HTMLButtonElement>('button[toggleSwitch]')!.click();
    await settle();
    // Typed, left, turned: nothing stored yet.
    expect(stored()[0]).toMatchObject({ title: 'Coffee', allDay: false });

    // Closed without Save: let go.
    await press(document.activeElement!, 'Escape');
    expect(stored()[0]).toMatchObject({ title: 'Coffee', allDay: false });

    // Save: stored, and the card gone.
    await rightClick(chip());
    await pick('Edit');
    card = document.querySelector('.calendar-card calendar-event-editor')!;
    title = card.querySelector<HTMLInputElement>('.event-editor__title')!;
    title.value = 'Tea';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    card.querySelector<HTMLButtonElement>('.event-editor__save')!.click();
    await settle();
    expect(stored()[0].title).toBe('Tea');
    expect(document.querySelector('.calendar-card')).toBeNull();
  });

  it('says which event is being written — aria-current on its chip; selected still once its card is closed', async () => {
    expect(chip().getAttribute('aria-current')).toBeNull();
    await rightClick(chip());
    await pick('Edit');
    expect(chip().getAttribute('aria-current')).toBe('true');

    // Escape closes the card; the event stays selected — a second lets go.
    await press(document.activeElement!, 'Escape');
    expect(document.querySelector('.calendar-card')).toBeNull();
    expect(chip().getAttribute('aria-current')).toBe('true');
    await press(document.body, 'Escape');
    expect(chip().getAttribute('aria-current')).toBeNull();
  });

  it('selects an event on a click — aria-current, no card — and lets go on Escape', async () => {
    chip().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(chip().getAttribute('aria-current')).toBe('true');
    expect(document.querySelector('.calendar-card')).toBeNull();

    await press(document.body, 'Escape');
    expect(chip().getAttribute('aria-current')).toBeNull();
  });

  it('lets go of the pending mark on a right-click there, and offers the slot under it', async () => {
    // A new event written in the card: its mark is drawn in the hours.
    await press(document.body, 'c');
    const mark = root.querySelector('[data-event-id="draft"]')!;
    expect(mark).not.toBeNull();

    await rightClick(mark);
    expect(root.querySelector('[data-event-id="draft"]')).toBeNull();
    expect(document.querySelector('.calendar-card')).toBeNull();
    expect(items().map(({ text }) => text)).toEqual([
      expect.stringContaining('New event'),
      expect.stringContaining('Paste'),
    ]);
  });

  it('deletes from the bar: a kept event goes, a new one is let go unkept', async () => {
    const deleteButton = () =>
      document.querySelector<HTMLButtonElement>('.calendar-card .event-editor__delete')!;

    // A new event, typed in but never left: Delete lets it go.
    await press(document.body, 'c');
    const title = document.querySelector<HTMLInputElement>('.calendar-card .event-editor__title')!;
    title.value = 'Draft';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    deleteButton().click();
    await settle();
    expect(document.querySelector('.calendar-card')).toBeNull();
    expect(stored().map((event) => event.id)).toEqual(['coffee']);

    // A kept one: deleted.
    await rightClick(chip());
    await pick('Edit');
    deleteButton().click();
    await settle();
    expect(stored()).toEqual([]);
  });

  it('leaves nothing behind for a new event opened and closed untouched', async () => {
    await press(document.body, 'c');
    expect(document.querySelector('.calendar-card calendar-event-editor')).not.toBeNull();
    await press(document.activeElement!, 'Escape');
    expect(document.querySelector('.calendar-card')).toBeNull();
    expect(stored()).toHaveLength(1);
  });

  it('leaves the heads to the browser', async () => {
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    root.querySelector('.time-grid__heads')!.dispatchEvent(menu);
    await settle();
    expect(menu.defaultPrevented).toBe(false);
    expect(items()).toEqual([]);
  });

  it('does the same by key on the focused event: duplicate, then delete', async () => {
    chip().focus();
    await press(chip(), 'd', { ctrlKey: true });
    expect(stored()).toHaveLength(2);

    await press(chip(), 'Delete');
    expect(stored().map((event) => event.id)).not.toContain('coffee');
  });

  it('opens the menu under the focused event with Shift+F10, and hands focus back after', async () => {
    chip().focus();
    await press(chip(), 'F10', { shiftKey: true });
    expect(items()).toHaveLength(5);

    await press(document.activeElement!, 'Escape');
    expect(document.activeElement).toBe(chip());
  });
});
