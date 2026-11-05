import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { CalendarEvent } from '../../../../core/calendar/calendar-event';
import { CalendarEvents } from '../../../../core/calendar/calendar-events';
import { CALENDAR_FEED_LATENCY } from '../../../../core/calendar/calendar-feed';
import { HOLIDAY_SOURCE } from '../../../../core/calendar/holidays';
import { TimeGrid } from '../../../partials/atomic/calendar/time-grid/time-grid';
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
        // The feed answers at once: the events are there as the page is.
        { provide: CALENDAR_FEED_LATENCY, useValue: 0 },
      ],
    });
    harness = await RouterTestingHarness.create('/calendar/r/week/2026/10/28');
    root = harness.fixture.nativeElement as HTMLElement;
    await settle();
  });

  afterEach(() => localStorage.removeItem(KEY));

  it('deletes what a marquee selected, all at once — one undo brings them all back', async () => {
    const tea: CalendarEvent = {
      ...COFFEE,
      id: 'tea',
      title: 'Tea',
      start: '2026-10-29T15:00',
      end: '2026-10-29T16:00',
    };
    TestBed.inject(CalendarEvents).save(tea);
    await harness.navigateByUrl('/calendar/r/week/2026/10/27');
    await settle();
    const grid = harness.fixture.debugElement.query(By.directive(TimeGrid))
      .componentInstance as TimeGrid;
    grid.selectMany.emit(['coffee', 'tea']);
    await settle();
    const current = () =>
      [...root.querySelectorAll('[aria-current="true"][data-event-id]')]
        .map((one) => one.getAttribute('data-event-id'))
        .sort();
    expect(current()).toEqual(['coffee', 'tea']);

    await press(document.body, 'Delete');
    expect(stored()).toEqual([]);
    const said = document.querySelector('.mat-mdc-snack-bar-container')!;
    expect(said.textContent).toContain('2 events deleted');
    said.querySelector<HTMLButtonElement>('button')!.click();
    await settle();
    expect(
      stored()
        .map((event) => event.id)
        .sort(),
    ).toEqual(['coffee', 'tea']);
  });

  it('lets go of a marquee’s selection with Escape', async () => {
    const grid = harness.fixture.debugElement.query(By.directive(TimeGrid))
      .componentInstance as TimeGrid;
    grid.selectMany.emit(['coffee']);
    await settle();
    expect(chip().getAttribute('aria-current')).toBe('true');
    await press(document.body, 'Escape');
    expect(chip().getAttribute('aria-current')).toBeNull();
  });

  it('pages with the arrow keys, at once — but not where the mini month steers with them', async () => {
    const router = TestBed.inject(Router);
    await press(document.body, 'ArrowRight');
    expect(router.url).toBe('/calendar/r/week/2026/11/4');
    await press(document.body, 'ArrowLeft');
    await press(document.body, 'ArrowLeft');
    expect(router.url).toBe('/calendar/r/week/2026/10/21');

    const day = root.querySelector('[role="grid"] [role="gridcell"], [role="grid"] button')!;
    await press(day, 'ArrowRight');
    expect(router.url).toBe('/calendar/r/week/2026/10/21');
  });

  it('a key on another surface — a compose window’s button — is that surface’s, never a calendar shortcut', async () => {
    const router = TestBed.inject(Router);
    const start = router.url;
    // A compose window over the page, as the mailbox shell draws one: a
    // dialog of its own, outside the calendar, its title bar a button.
    const window = document.createElement('section');
    window.setAttribute('role', 'dialog');
    const title = document.createElement('button');
    window.append(title);
    document.body.append(window);
    try {
      for (const key of ['d', 'w', 'a', 't', 'ArrowRight']) await press(title, key);
      expect(router.url).toBe(start);
    } finally {
      window.remove();
    }
    // On the page itself, the same keys are the calendar's.
    await press(document.body, 'd');
    expect(router.url).toBe(start.replace('/week/', '/day/'));
  });

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

  /** The browser's paste, the clipboard saying `text`. */
  const paste = async (text: string, target: Element = document.body) => {
    const pasted = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasted, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    });
    target.dispatchEvent(pasted);
    await settle();
    return pasted;
  };

  it('copies the event pressed with Ctrl+C — Notion Calendar’s line — and pastes it whole', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });
    chip().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    // Selected, not focused: the keys reach the document.
    await press(document.body, 'c', { ctrlKey: true });
    expect(written).toEqual(['Coffee on Oct 28, 2026 at 10:00 AM - 11:00 AM\n']);

    // Ctrl+V is the browser's paste; its line is the event copied, whole.
    const keyed = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, cancelable: true });
    document.body.dispatchEvent(keyed);
    expect(keyed.defaultPrevented).toBe(false);
    expect((await paste(written[0])).defaultPrevented).toBe(true);
    expect(stored()).toHaveLength(2);
    expect(stored()[1]).toMatchObject({ title: 'Coffee', location: 'Alexanderplatz' });
  });

  it('pastes an event Notion Calendar copied — its title and times — and leaves other words', async () => {
    await paste('Standup on Nov 3, 2026 at 6:45 AM - 9:15 AM');
    // No pointer over the hours: its own time, on the day in view.
    expect(stored()[1]).toMatchObject({
      title: 'Standup',
      start: '2026-10-28T06:45',
      end: '2026-10-28T09:15',
      allDay: false,
      location: '',
    });

    expect((await paste('just some words')).defaultPrevented).toBe(false);
    const field = document.createElement('input');
    root.appendChild(field);
    expect((await paste('Tea on Nov 3, 2026', field)).defaultPrevented).toBe(false);
    expect(stored()).toHaveLength(2);
  });

  describe('a marquee’s many', () => {
    const tea: CalendarEvent = {
      ...COFFEE,
      id: 'tea',
      title: 'Tea',
      start: '2026-10-29T15:00',
      end: '2026-10-29T16:00',
      color: 'tomato',
    };
    let written: string[];

    beforeEach(async () => {
      written = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text: string) => void written.push(text) },
      });
      TestBed.inject(CalendarEvents).save(tea);
      await harness.navigateByUrl('/calendar/r/week/2026/10/27');
      await settle();
      const grid = harness.fixture.debugElement.query(By.directive(TimeGrid))
        .componentInstance as TimeGrid;
      grid.selectMany.emit(['coffee', 'tea']);
      await settle();
    });

    it('cuts them all with Ctrl+X — one line each — and pastes them back as far apart', async () => {
      await press(document.body, 'x', { ctrlKey: true });
      expect(stored()).toEqual([]);
      expect(document.querySelector('.mat-mdc-snack-bar-container')!.textContent).toContain(
        '2 events cut',
      );
      expect(written).toEqual([
        'Coffee on Oct 28, 2026 at 10:00 AM - 11:00 AM\nTea on Oct 29, 2026 at 3:00 PM - 4:00 PM\n',
      ]);

      // No pointer over the hours: the first on the day in view, at its own
      // time; the other a day and five hours on, as it was.
      await paste(written[0]);
      expect(stored()).toEqual([
        expect.objectContaining({ title: 'Coffee', start: '2026-10-27T10:00', color: 'peacock' }),
        expect.objectContaining({ title: 'Tea', start: '2026-10-28T15:00', color: 'tomato' }),
      ]);
      // The pasted ones, selected.
      expect(root.querySelectorAll('[aria-current="true"][data-event-id]')).toHaveLength(2);
    });

    it('copies and duplicates them all by key', async () => {
      await press(document.body, 'c', { ctrlKey: true });
      expect(written[0].trim().split('\n')).toHaveLength(2);
      await press(document.body, 'd', { ctrlKey: true });
      expect(stored()).toHaveLength(4);
    });

    it('acts on them all from the menu of one of them', async () => {
      await rightClick(chip());
      expect(items()[0].disabled).toBe(true); // Edit: one event's alone.
      await pick('Cut');
      expect(stored()).toEqual([]);
    });

    it('pastes the events many Notion lines name — or none, if one is not', async () => {
      await paste('Lunch on Nov 3, 2026 at 12:00 PM - 1:00 PM\nwords');
      expect(stored()).toHaveLength(2);
      await paste(
        'Lunch on Nov 3, 2026 at 12:00 PM - 1:00 PM\nDinner on Nov 3, 2026 at 7:00 PM - 8:00 PM\n',
      );
      expect(stored().map((event) => event.title)).toEqual(['Coffee', 'Tea', 'Lunch', 'Dinner']);
    });
  });

  it('deletes the event pressed with Delete', async () => {
    chip().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    await press(document.body, 'Delete');
    expect(stored()).toEqual([]);
  });

  it('opens the menu under the focused event with Shift+F10, and hands focus back after', async () => {
    chip().focus();
    await press(chip(), 'F10', { shiftKey: true });
    expect(items()).toHaveLength(5);

    await press(document.activeElement!, 'Escape');
    expect(document.activeElement).toBe(chip());
  });
});
