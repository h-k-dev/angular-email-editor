import {
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  linkedSignal,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { DateTime } from 'luxon';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';

import { MenuTrigger } from '@angular/aria/menu';
import { Anchor, AnchorRect } from '@h-k-dev/angular-email-editor/anchor';
import { TranslatePipe } from '@ngx-translate/core';

import { IsoDay, isoDay } from '../../../../core/calendar/calendar-dates';
import {
  CalendarEvent,
  CalendarEventDraft,
  EventEdit,
  draftAt,
} from '../../../../core/calendar/calendar-event';
import { CalendarEvents } from '../../../../core/calendar/calendar-events';
import { CalendarFormat } from '../../../../core/calendar/calendar-format';
import {
  CalendarView,
  calendarPage,
  calendarPath,
  isCustomView,
  rangeView,
  stepped,
} from '../../../../core/calendar/calendar-view';
import { segmentView } from '../../../../core/calendar/calendar-view-token';
import {
  HOLIDAY_SOURCE,
  Holiday,
  holidayCountry,
  holidayEvents,
} from '../../../../core/calendar/holidays';
import { Preferences } from '../../../../core/storages/preferences';
import { I18n } from '../../../../core/translations/i18n';
import { GridCreate, GridOpen, boxOf } from '../../../partials/atomic/calendar/calendar-grid';
import { EventEditor } from '../../../partials/atomic/calendar/event-editor/event-editor';
import { MonthGrid } from '../../../partials/atomic/calendar/month-grid/month-grid';
import { ScheduleList } from '../../../partials/atomic/calendar/schedule-list/schedule-list';
import { TimeGrid } from '../../../partials/atomic/calendar/time-grid/time-grid';
import { YearGrid } from '../../../partials/atomic/calendar/year-grid/year-grid';
import { MiniMonth } from '../../../partials/common/mini-month/mini-month';
import { PageHeader } from '../../../partials/common/page-header/page-header';
import { EventSummary } from '../../../partials/shared/calendar/event-summary/event-summary';
import {
  ToolbarMenu,
  ToolbarMenuItem,
} from '../../../partials/shared/email/email-compose/formatting-toolbar/toolbar-menu/toolbar-menu';

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

/** Google Calendar's views, in its menu's order, each with its key — the
    custom one (X) at its remembered length. */
const MENU_VIEWS = [
  { id: 'day', key: 'D' },
  { id: 'week', key: 'W' },
  { id: 'month', key: 'M' },
  { id: 'year', key: 'Y' },
  { id: 'schedule', key: 'A' },
  { id: 'custom', key: 'X' },
] as const;

/** What the view menu chooses: a view, or one of its two switches. */
type ViewChoice = (typeof MENU_VIEWS)[number]['id'] | 'weekends' | 'holidays';

/** How often "now" moves on, ms: the red line, and today at midnight. */
const TICK = 30_000;

/**
 * The calendar: Google Calendar's views and paths, Notion Calendar's
 * surface and feel — the mini month on the side, the view beside it. A
 * place per view and day, Google's path (`/calendar/r/week/2026/10/29`),
 * so the browser's back and forward walk the pages, and anything — a
 * message's event, later — can link straight to a day.
 *
 * Google's view menu: Day, Week, Month, Year, Schedule and the custom view
 * — any run of days or weeks dragged across the mini month, remembered:
 * the arrows step by it, a day pressed in the mini month outside it opens
 * it there (one inside narrows it to that day alone), X brings it back. Show weekends leaves Saturday and Sunday out. Month,
 * Year and Schedule are deferred chunks: the hours load alone.
 *
 * Notion's feel: the next week is simply there, nothing slides. Drag
 * across the hours and the time is marked out as you go; let go and a
 * card opens beside the mark to write the event in (`EventEditor`) — a
 * pop-out, not Notion's side panel, and nothing laid over the page: the
 * mark can be dragged on while the card is open, and a press anywhere in
 * the hours marks out the next one at once, the card following it. Press
 * an event for its card (`EventSummary`); drag an event to move it, its
 * foot to stretch it.
 *
 * Google's keys: T today, D W M Y A X a view, J or N next, K or P previous,
 * C a new event; Escape closes the card, Delete deletes the event it
 * shows.
 */
@Component({
  selector: 'app-calendar',
  imports: [
    CdkConnectedOverlay,
    CdkOverlayOrigin,
    MatIconButton,
    MatIcon,
    MatTooltip,
    Anchor,
    MenuTrigger,
    ToolbarMenu,
    TranslatePipe,
    PageHeader,
    MiniMonth,
    TimeGrid,
    MonthGrid,
    YearGrid,
    ScheduleList,
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

  /** The route's, Google's path: the view's segment, and the day's numbers
      (the year view has the year alone). */
  readonly view = input.required<string>();
  readonly y = input.required<string>();
  /** None on the year's path — and the router's input binding sets an
      input its route lacks to undefined, whatever its default. */
  readonly m = input<string | undefined>();
  readonly d = input<string | undefined>();

  readonly #preferences = inject(Preferences);
  /** The custom view's length, remembered — the last drag across the mini
      month's (Google's X). */
  readonly #custom = this.#preferences.calendarCustomView;
  /** Whether Saturdays and Sundays show. */
  protected readonly weekends = this.#preferences.calendarWeekends;
  /** Whether the public holidays show. */
  protected readonly showHolidays = this.#preferences.calendarHolidays;

  /** Now, a tick at a time. */
  protected readonly now = signal(DateTime.now());
  protected readonly today = computed(() => isoDay(this.now()));

  readonly #view = computed<CalendarView>(() => segmentView(this.view(), this.#custom()) ?? 'week');
  /** The day, from the path's numbers as they are — the matcher checked
      them. The year's path has no day: today, in this year — its first of
      January in another — so leaving the year lands somewhere sensible. */
  readonly #day = computed(() => {
    const m = this.m();
    const d = this.d();
    if (m && d) return DateTime.local(+this.y(), +m, +d);
    const today = this.now().startOf('day');
    return today.year === +this.y() ? today : DateTime.local(+this.y(), 1, 1);
  });

  readonly #page = computed(() =>
    calendarPage(this.#view(), this.#day(), this.#formats().weekStart, {
      weekends: this.weekends(),
    }),
  );

  /** What the view shows: its days, or its month's weeks. */
  protected readonly page = this.#page;

  protected readonly day = computed(() => isoDay(this.#day()));

  /** A view's name: "Day", or a custom one's length, "3 weeks". */
  #viewLabel(view: CalendarView): string {
    if (!isCustomView(view)) return this.#i18n.t(`calendar.views.${view}`);
    const count = parseInt(view, 10);
    return this.#i18n.t(view.endsWith('d') ? 'calendar.views.days' : 'calendar.views.weeks', {
      count,
    });
  }

  /** The view menu's trigger says the view: "Week", "3 weeks". */
  protected readonly viewLabel = computed(() => this.#viewLabel(this.#view()));

  /** Google's view menu: the views with their keys, the custom one at its
      length, then Show weekends. */
  protected readonly viewItems = computed<ToolbarMenuItem<ViewChoice>[]>(() => [
    ...MENU_VIEWS.map(({ id, key }) => ({
      value: id,
      label: this.#viewLabel(id === 'custom' ? this.#custom() : id),
      shortcut: key,
    })),
    {
      value: 'weekends',
      label: this.#i18n.t('calendar.showWeekends'),
      kind: 'checkbox',
      checked: this.weekends(),
      separated: true,
    },
    {
      value: 'holidays',
      label: this.#i18n.t('calendar.showHolidays'),
      kind: 'checkbox',
      checked: this.showHolidays(),
    },
  ]);

  protected readonly title = computed(() => {
    const page = this.#page();
    const formats = this.#formats();
    if (page.view === 'day') return formats.longDay(page.from);
    if (page.view === 'year') return String(page.from.year);
    return formats.title(page.from, page.to);
  });

  /** The mini month's month: the page's, until its arrows move it. */
  protected readonly miniMonth = linkedSignal(() => this.day());
  /** What it washes: the days in the hours, a run of weeks' days — or,
      for a month, a year or the schedule, the one day. */
  protected readonly miniSelected = computed(() => {
    const page = this.#page();
    if (page.layout === 'hours') return page.days;
    if (page.layout === 'weeks' && !page.month) return page.weeks.flat();
    return [this.day()];
  });

  // ─── Holidays ───────────────────────────────────────────────────────

  readonly #holidaySource = inject(HOLIDAY_SOURCE);
  readonly #browserLanguage = inject(DOCUMENT).defaultView?.navigator.language ?? '';
  /** Whose holidays: the browser's region, else the app language's. */
  readonly #holidayCountry = computed(() =>
    holidayCountry(this.#browserLanguage, this.#formats().language),
  );

  /** The years the page reaches into — a month's first week can start in
      December. */
  readonly #years = computed(() => {
    const page = this.#page();
    const first = page.days[0] ?? page.weeks[0]?.[0] ?? page.months[0];
    const last = page.days.at(-1) ?? page.weeks.at(-1)?.at(-1) ?? page.to.toISODate()!;
    const from = +first.slice(0, 4);
    const to = +last.slice(0, 4);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  });

  /** The connector's answer for those years — fetched once a country-year
      (the connector keeps them). */
  readonly #holidayRows = resource({
    params: () =>
      this.showHolidays() ? { country: this.#holidayCountry(), years: this.#years() } : undefined,
    loader: async ({ params, abortSignal }) =>
      (
        await Promise.all(
          params.years.map((year) =>
            this.#holidaySource.holidays(year, params.country, abortSignal),
          ),
        )
      ).flat(),
  });

  /** The holidays as events — the last ones held while the next year's
      load, none while switched off or when the connector fails. */
  readonly #holidays = linkedSignal<
    { rows: Holiday[] | undefined; on: boolean; language: string },
    CalendarEvent[]
  >({
    source: () => ({
      rows: this.#holidayRows.hasValue() ? this.#holidayRows.value() : undefined,
      on: this.showHolidays(),
      language: this.#formats().language,
    }),
    computation: ({ rows, on, language }, previous) => {
      if (!on) return [];
      if (rows) {
        return holidayEvents(rows, language, (regions) =>
          this.#i18n.t('calendar.regionalHoliday', { regions }),
        );
      }
      return previous?.value ?? [];
    },
  });

  readonly #holidayById = computed(
    () => new Map(this.#holidays().map((holiday) => [holiday.id, holiday])),
  );

  /** Every event the views lay out: the stored ones and the holidays. */
  protected readonly events = computed(() => [...this.#store.events(), ...this.#holidays()]);

  /** The hours' scroll, kept across a visit to the month. */
  protected readonly hoursScroll = signal<number | null>(null);

  // ─── The card ───────────────────────────────────────────────────────

  /** The event being written — new, or a stored one's edit. */
  protected readonly edit = signal<EventEdit | null>(null);
  /** The stored event whose card is open, by id. */
  readonly #shownId = signal<string | null>(null);
  protected readonly shown = computed(() => {
    const id = this.#shownId();
    return id ? (this.#store.byId().get(id) ?? this.#holidayById().get(id) ?? null) : null;
  });
  /** Whether the shown event is a holiday's — no Edit, no Delete. */
  protected readonly shownReadonly = computed(() => !!this.shown()?.readonly);
  /** Where the card stands beside: the event's box, or the room marked. */
  protected readonly anchor = signal<AnchorRect | null>(null);
  protected readonly cardOpen = computed(() => !!this.edit() || !!this.shown());
  protected readonly cardPositions = CARD_POSITIONS;
  protected readonly editingStored = computed(() => !!this.edit()?.id);

  /** What an event without a title says: "(No title)". */
  protected readonly untitled = computed(() => this.#i18n.t('calendar.untitled'));

  private readonly card = viewChild.required(CdkConnectedOverlay);

  constructor() {
    const tick = setInterval(() => this.now.set(DateTime.now()), TICK);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));

    // An open card follows its anchor — the next mark, the mark dragged —
    // once the anchor stands there.
    afterRenderEffect(() => {
      this.anchor();
      this.card().overlayRef?.updatePosition();
    });
  }

  // ─── Going places ───────────────────────────────────────────────────

  /** To a view and a day. A custom view is remembered first: its path
      (`/r/customweek/…`) names its kind, the length is the setting's. */
  protected go(view: CalendarView, day: IsoDay | DateTime): void {
    if (isCustomView(view)) this.#custom.set(view);
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

  /** A day pressed in the mini month, Google's: one inside the interval
      shown narrows it to that day alone; one outside moves the same view
      there — a custom one at exactly its length. */
  protected pickDay(day: IsoDay): void {
    const inside = this.miniSelected().includes(day);
    this.go(inside ? 'day' : this.#view(), day);
  }

  /** A run dragged across the mini month: the view it asks for — days,
      weeks — which is the custom view from now on. */
  protected pickRange({ from, to }: { from: IsoDay; to: IsoDay }): void {
    const { view, date } = rangeView(from, to, this.#formats().weekStart);
    this.go(view, date);
  }

  /** The view menu: a view, or Show weekends turned over. */
  protected choose(choice: ViewChoice): void {
    if (choice === 'weekends') this.weekends.update((on) => !on);
    else if (choice === 'holidays') this.showHolidays.update((on) => !on);
    else this.switchView(choice === 'custom' ? this.#custom() : choice);
  }

  protected openDay(day: IsoDay): void {
    this.go('day', day);
  }

  // ─── Events ─────────────────────────────────────────────────────────

  /** Time marked out in a grid: a card to write the event in. One open
      already gives way to it — the next mark is a press away, Notion's. */
  protected created({ draft, rect }: GridCreate): void {
    this.#write(draft, rect);
  }

  /** The open mark dragged or stretched: the event takes its times, the
      card follows it. */
  protected draftMoved({ draft, rect }: GridCreate): void {
    const edit = this.edit();
    if (!edit) return;
    this.edit.set({ ...edit, start: draft.start, end: draft.end });
    this.anchor.set(rect);
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
    if (!event || event.readonly) return;
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
    if (edit.id) this.#store.save(edit as CalendarEvent);
    else this.#store.create(edit);
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
    if ((event.target as Element | null)?.closest('.calendar-surface')) return;
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
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        this.shown() &&
        !this.shownReadonly()
      ) {
        event.preventDefault();
        this.removed();
      }
      return;
    }
    const key = event.key.toUpperCase();
    const view = MENU_VIEWS.find((one) => one.key === key);
    if (view) this.choose(view.id);
    else if (key === 'T') this.goToday();
    else if (key === 'J' || key === 'N') this.step(1);
    else if (key === 'K' || key === 'P') this.step(-1);
    else if (key === 'C') {
      const button = this.#host.querySelector('.calendar-new');
      this.#newAt(button ? boxOf(button) : { left: innerWidth / 2, top: 120 });
    } else return;
    event.preventDefault();
  }
}
