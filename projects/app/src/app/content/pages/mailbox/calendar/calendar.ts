import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { DateTime } from 'luxon';

// Angular Material
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';

import { Anchor, AnchorRect } from '@h-k-dev/angular-email-editor/anchor';
import {
  ToggleButtonGroup,
  ToggleButtonGroupText,
} from '@h-k-dev/angular-email-editor/toggle-button-group';
import { TranslatePipe } from '@ngx-translate/core';

import { IsoDay, isoDay, parseDay } from '../../../../core/calendar/calendar-dates';
import {
  CalendarEvent,
  CalendarEventDraft,
  EventEdit,
  draftAt,
} from '../../../../core/calendar/calendar-event';
import { CalendarEvents } from '../../../../core/calendar/calendar-events';
import { CalendarFormat } from '../../../../core/calendar/calendar-format';
import {
  CALENDAR_VIEWS,
  CalendarView,
  calendarPage,
  calendarPath,
  isCalendarView,
  stepped,
} from '../../../../core/calendar/calendar-view';
import { I18n } from '../../../../core/translations/i18n';
import { GridCreate, GridOpen, boxOf } from '../../../partials/atomic/calendar/calendar-grid';
import { EventEditor } from '../../../partials/atomic/calendar/event-editor/event-editor';
import { MonthGrid } from '../../../partials/atomic/calendar/month-grid/month-grid';
import { TimeGrid } from '../../../partials/atomic/calendar/time-grid/time-grid';
import { MiniMonth } from '../../../partials/common/mini-month/mini-month';
import { PageHeader } from '../../../partials/common/page-header/page-header';
import { EventSummary } from '../../../partials/shared/calendar/event-summary/event-summary';

/** The card beside an event: at its end, else its start, else under or
    over it — Google's. The ones over it rise out of it (`motion-above`). */
const CARD_POSITIONS: ConnectedPosition[] = [
  { originX: 'end', originY: 'top', overlayX: 'start', overlayY: 'top', offsetX: 8 },
  { originX: 'start', originY: 'top', overlayX: 'end', overlayY: 'top', offsetX: -8 },
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
  {
    originX: 'start',
    originY: 'top',
    overlayX: 'start',
    overlayY: 'bottom',
    offsetY: -8,
    panelClass: 'motion-above',
  },
];

/** Google Calendar's keys: a letter each, no modifier. */
const VIEW_KEYS: Readonly<Record<string, CalendarView>> = { d: 'day', w: 'week', m: 'month' };

/** How often "now" moves on, ms: the red line, and today at midnight. */
const TICK = 30_000;

/**
 * The calendar: Google Calendar, Notion's look, Linear's few controls, and
 * Framer's motion — the mini month on the side, and the day, the week or
 * the month beside it. A place per view and day (`/calendar/week/2026-10-29`),
 * so the browser's back and forward walk the pages, and anything — a
 * message's event, later — can link straight to a day.
 *
 * The page turns: the next week slides in from the end and the last one
 * fades back, on the spring (`motion-turn`); a view switched settles in
 * place. Press an hour, or drag across a few, and a card opens beside the
 * room to write the event in (`EventEditor`), the event shown in the grid
 * as it is typed; press an event for its card (`EventSummary`). Drag an
 * event to move it, its foot to stretch it.
 *
 * Google's keys: T today, D / W / M a view, J or N next, K or P previous,
 * C a new event; Escape closes the card, Delete deletes the event it
 * shows.
 */
@Component({
  selector: 'app-calendar',
  imports: [
    CdkConnectedOverlay,
    CdkOverlayOrigin,
    MatButton,
    MatIconButton,
    MatIcon,
    MatTooltip,
    Anchor,
    ToggleButtonGroup,
    ToggleButtonGroupText,
    TranslatePipe,
    PageHeader,
    MiniMonth,
    TimeGrid,
    MonthGrid,
    EventEditor,
    EventSummary,
  ],
  templateUrl: './calendar.html',
  styleUrl: './calendar.scss',
  host: { '(document:keydown)': 'key($event)' },
})
export class CalendarPage {
  readonly #router = inject(Router);
  readonly #store = inject(CalendarEvents);
  readonly #formats = inject(CalendarFormat).formats;
  readonly #snackBar = inject(MatSnackBar);
  readonly #i18n = inject(I18n);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** The route's: which view, and a day it shows. */
  readonly view = input.required<string>();
  readonly date = input.required<string>();

  /** Now, a tick at a time. */
  protected readonly now = signal(DateTime.now());
  protected readonly today = computed(() => isoDay(this.now()));

  readonly #view = computed<CalendarView>(() =>
    isCalendarView(this.view()) ? (this.view() as CalendarView) : 'week',
  );
  readonly #day = computed(() => parseDay(this.date()) ?? this.now().startOf('day'));

  readonly #page = computed(() =>
    calendarPage(this.#view(), this.#day(), this.#formats().weekStart),
  );

  /** The page, keyed: a new range is a new page, which turns in. */
  protected readonly pages = computed(() => [this.#page()]);

  /** Which way the page turned: 1 on, -1 back, 0 a view switched. Worked
      out from the page before, so the browser's back turns it too. */
  protected readonly turn = linkedSignal<ReturnType<typeof calendarPage>, -1 | 0 | 1>({
    source: this.#page,
    computation: (page, previous) => {
      if (!previous || previous.source.view !== page.view) return 0;
      return Math.sign(page.from.toMillis() - previous.source.from.toMillis()) as -1 | 0 | 1;
    },
  });

  protected readonly views = CALENDAR_VIEWS.map((id) => ({ id, key: `calendar.views.${id}` }));
  protected readonly viewName = this.#view;
  protected readonly day = computed(() => isoDay(this.#day()));

  protected readonly title = computed(() => {
    const page = this.#page();
    const formats = this.#formats();
    return page.view === 'day' ? formats.longDay(page.from) : formats.title(page.from, page.to);
  });

  /** The mini month's month: the page's, until its arrows move it. */
  protected readonly miniMonth = linkedSignal(() => this.day());
  /** What it washes: the days in the hours, or the one day of a month. */
  protected readonly miniSelected = computed(() => {
    const page = this.#page();
    return page.view === 'month' ? [this.day()] : page.days;
  });

  protected readonly events = this.#store.events;

  /** The hours' scroll, kept across turns. */
  protected readonly hoursScroll = signal<number | null>(null);

  // ─── The card ───────────────────────────────────────────────────────

  /** The event being written — new, or a stored one's edit. */
  protected readonly edit = signal<EventEdit | null>(null);
  /** The stored event whose card is open, by id. */
  readonly #shownId = signal<string | null>(null);
  protected readonly shown = computed(() => {
    const id = this.#shownId();
    return id ? (this.#store.byId().get(id) ?? null) : null;
  });
  /** Where the card stands beside: the event's box, or the room marked. */
  protected readonly anchor = signal<AnchorRect | null>(null);
  protected readonly cardOpen = computed(() => !!this.edit() || !!this.shown());
  protected readonly cardPositions = CARD_POSITIONS;
  /** The event just made: it pops in where it was written. */
  protected readonly fresh = signal<string | null>(null);
  protected readonly editingStored = computed(() => !!this.edit()?.id);

  /** What an event without a title says: "(No title)". */
  protected readonly untitled = computed(() => this.#i18n.t('calendar.untitled'));

  constructor() {
    const tick = setInterval(() => this.now.set(DateTime.now()), TICK);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }

  // ─── Going places ───────────────────────────────────────────────────

  protected go(view: CalendarView, day: IsoDay | DateTime): void {
    this.fresh.set(null);
    void this.#router.navigateByUrl(calendarPath(view, day));
  }

  protected step(direction: -1 | 1): void {
    this.go(this.#view(), stepped(this.#view(), this.#day(), direction));
  }

  protected goToday(): void {
    this.go(this.#view(), this.today());
  }

  protected switchView(view: CalendarView): void {
    this.go(view, this.#day());
  }

  protected pickDay(day: IsoDay): void {
    this.go(this.#view(), day);
  }

  protected openDay(day: IsoDay): void {
    this.go('day', day);
  }

  // ─── Events ─────────────────────────────────────────────────────────

  /** Room marked in a grid: a card to write the event in — unless a card
      is open, which the press only closes, as Google's. */
  protected created({ draft, rect }: GridCreate): void {
    if (this.cardOpen()) return this.closeCard();
    this.#write(draft, rect);
  }

  /** A new event from the header: at the next hour of the day shown. */
  protected createHere(event: MouseEvent): void {
    this.#newAt(boxOf(event.currentTarget as Element));
  }

  #newAt(rect: AnchorRect): void {
    const now = this.now();
    const day = this.#day();
    const hour = now.plus({ hours: 1 }).startOf('hour');
    const start = day.hasSame(now, 'day') ? hour : day.set({ hour: 9 });
    this.#write(draftAt(start), rect);
  }

  #write(draft: CalendarEventDraft, rect: AnchorRect): void {
    this.#shownId.set(null);
    this.anchor.set(rect);
    this.edit.set(draft);
  }

  protected opened({ id, rect }: GridOpen): void {
    this.edit.set(null);
    this.anchor.set(rect);
    this.#shownId.set(id);
  }

  /** The card's Edit: the shown event, written. */
  protected editShown(): void {
    const event = this.shown();
    if (!event) return;
    this.#shownId.set(null);
    this.edit.set({ ...event });
  }

  /** Moved or stretched in a grid: stored at once. */
  protected changed(event: CalendarEvent): void {
    this.#store.save(event);
    const edit = this.edit();
    if (edit?.id === event.id) this.edit.set({ ...edit, start: event.start, end: event.end });
  }

  protected saved(edit: EventEdit): void {
    if (edit.id) {
      this.#store.save(edit as CalendarEvent);
      this.fresh.set(null);
    } else {
      this.fresh.set(this.#store.create(edit).id);
    }
    this.closeCard();
  }

  /** Deleted — with a moment to take it back. */
  protected removed(): void {
    const id = this.edit()?.id ?? this.#shownId();
    this.closeCard();
    const gone = id ? this.#store.remove(id) : null;
    if (!gone) return;
    this.#snackBar
      .open(this.#i18n.t('calendar.deleted'), this.#i18n.t('calendar.undo'), { duration: 4000 })
      .onAction()
      .subscribe(() => this.#store.save(gone));
  }

  protected closeCard(): void {
    this.edit.set(null);
    this.#shownId.set(null);
  }

  /** A press outside the card closes it — but not one in a grid, which
      decides itself (another event opens in its place). */
  protected outside(event: MouseEvent): void {
    if ((event.target as Element | null)?.closest('.calendar-page')) return;
    this.closeCard();
  }

  protected cardKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.closeCard();
  }

  // ─── Keys ───────────────────────────────────────────────────────────

  protected key(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
    ) {
      return;
    }
    if (this.cardOpen()) {
      if ((event.key === 'Delete' || event.key === 'Backspace') && this.shown()) {
        event.preventDefault();
        this.removed();
      }
      return;
    }
    const key = event.key.toLowerCase();
    const view = VIEW_KEYS[key];
    if (view) this.switchView(view);
    else if (key === 't') this.goToday();
    else if (key === 'j' || key === 'n') this.step(1);
    else if (key === 'k' || key === 'p') this.step(-1);
    else if (key === 'c') {
      const button = this.#host.querySelector('.calendar-new');
      this.#newAt(button ? boxOf(button) : { left: innerWidth / 2, top: 120 });
    } else return;
    event.preventDefault();
  }
}
