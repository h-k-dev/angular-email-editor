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

  it('opens on an event with a right-click: cut, copy, duplicate, delete — each with its keys', async () => {
    await rightClick(chip());
    expect(items().map(({ text }) => text.replace(/\s+/g, ' ').trim())).toEqual([
      expect.stringContaining('Cut'),
      expect.stringContaining('Copy'),
      expect.stringContaining('Duplicate'),
      expect.stringContaining('Delete'),
    ]);
    const copy = items()[1].item;
    expect(copy.getAttribute('aria-keyshortcuts')).toMatch(/^(Meta|Control)\+C$/);
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
    // The card opens on the new event, an hour from the slot's quarter.
    const card = document.querySelector('.calendar-card calendar-event-editor');
    expect(card).not.toBeNull();
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
    expect(items()).toHaveLength(4);

    await press(document.activeElement!, 'Escape');
    expect(document.activeElement).toBe(chip());
  });
});
