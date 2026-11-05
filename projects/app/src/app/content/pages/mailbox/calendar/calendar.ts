import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  resource,
  signal,
  untracked,
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

import {
  DAY_MINUTES,
  IsoDay,
  atMinute,
  daysBetween,
  isoDay,
  minuteOfDay,
  parseDay,
} from '../../../../core/calendar/calendar-dates';
import {
  CalendarEvent,
  CalendarEventDraft,
  DRAFT_ID,
  EVENT_COLOR_VALUES,
  EventColor,
  EventEdit,
  draftAt,
  eventSpan,
  movedTo,
} from '../../../../core/calendar/calendar-event';
import { CalendarEvents } from '../../../../core/calendar/calendar-events';
import { CalendarFeed } from '../../../../core/calendar/calendar-feed';
import {
  CalendarFormat,
  eventClipboardLine,
  parseEventClipboardLine,
} from '../../../../core/calendar/calendar-format';
import {
  CalendarView,
  calendarPage,
  calendarPath,
  isCustomView,
  rangeView,
  stepped,
} from '../../../../core/calendar/calendar-view';
import { segmentView } from '../../../../core/calendar/calendar-view-token';
import { HOLIDAY_SOURCE, Holiday, holidayEvents } from '../../../../core/calendar/holidays';
import { Viewport } from '../../../../core/layout/viewport';
import { Preferences } from '../../../../core/storages/preferences';
import { I18n } from '../../../../core/translations/i18n';
import {
  DayFlash,
  GridCreate,
  GridOpen,
  GridSlot,
  GridWindow,
  HEAD_ROOM,
  boxOf,
  headOf,
} from '../../../partials/atomic/calendar/calendar-grid';
import { EventEditor } from '../../../partials/atomic/calendar/event-editor/event-editor';
import { QuickTitle } from '../../../partials/atomic/calendar/quick-title/quick-title';
import { MonthGrid } from '../../../partials/atomic/calendar/month-grid/month-grid';
import { ScheduleList } from '../../../partials/atomic/calendar/schedule-list/schedule-list';
import { TimeGrid } from '../../../partials/atomic/calendar/time-grid/time-grid';
import { YearGrid } from '../../../partials/atomic/calendar/year-grid/year-grid';
import { MiniMonth } from '../../../partials/common/mini-month/mini-month';
import { PageHeader } from '../../../partials/common/page-header/page-header';
import { EventSummary } from '../../../partials/shared/calendar/event-summary/event-summary';
import { ColorMarker } from '../../../partials/shared/calendar/color-marker/color-marker';
import {
  ToolbarMenu,
  ToolbarMenuItem,
} from '../../../partials/shared/email/email-compose/formatting-toolbar/toolbar-menu/toolbar-menu';

/** What the card holds: an event being written, or one shown. */
interface CardContent {
  edit: EventEdit | null;
  shown: CalendarEvent | null;
}

/** What the context menu does — to an event, or at a slot. */
type EventAction = 'edit' | 'cut' | 'copy' | 'duplicate' | 'delete' | 'create' | 'paste';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** A shortcut with the platform's command key: shown (⌘C, Ctrl+C) and
    said to assistive tech (Meta+C, Control+C). */
const withMod = (key: string) => ({
  shortcut: MAC ? `⌘${key}` : `Ctrl+${key}`,
  shortcutKeys: `${MAC ? 'Meta' : 'Control'}+${key}`,
});

/** An event's content, without what makes it that one: its id, and a
    holiday's being read-only — what a copy or a duplicate is made of. */
function contentOf(event: CalendarEvent): CalendarEventDraft {
  const { title, start, end, allDay, color, location, description, timeZone } = event;
  return { title, start, end, allDay, color, location, description, timeZone };
}

/** Where the card's own mark stands across it, from its start — the card
    stands that far before the event's colour mark (`headOf` starts there:
    a block's stripe at 4px, a month item's dot at 12px), mark over colour,
    px. The card's lines are rings, taking no room.
    Showing an event, its colour dot: the summary's 16px inset and the
    dot's half (12px, the colour marker — set flush on the inset). */
const CARD_DOT = 16 + 6;
/** Writing one, its Delete: the editor bar's 6px inset and the button's
    half (its 28px state layer). */
const CARD_DELETE = 6 + 14;
/** How far the card stands out past the event's end, where it lines up
    with that instead (near the screen's end), px. */
const CARD_SHIFT = 16;
/** How far the shown card comes up over its event's head (`headOf`):
    the room the head keeps under its words — over the body of a long
    event, over the bottom edge of a short one — px. */
const CARD_OVERLAP = HEAD_ROOM;
/** The gap under an event being written: its foot — the end's handle —
    stays in reach, the card clear of it, px. */
const CARD_CLEAR = 4;

/**
 * The card under its event, hung from its head (`headOf`): its own mark —
 * the colour dot, or the editor's Delete — right under the event's colour
 * (`mark`: `CARD_DOT`, `CARD_DELETE`), and over the head's
 * bottom a little (`lap`) — a short event mostly in view, the card
 * plainly its own.
 * Near the screen's end it lines up with the event's end instead; with no
 * room under it, over it, rising out of it (`motion-above`).
 */
function cardPositions(lap: number, mark: number): ConnectedPosition[] {
  return [
    {
      originX: 'start',
      originY: 'bottom',
      overlayX: 'start',
      overlayY: 'top',
      offsetX: -mark,
      offsetY: -lap,
    },
    {
      originX: 'end',
      originY: 'bottom',
      overlayX: 'end',
      overlayY: 'top',
      offsetX: CARD_SHIFT,
      offsetY: -lap,
    },
    {
      originX: 'start',
      originY: 'top',
      overlayX: 'start',
      overlayY: 'bottom',
      offsetX: -mark,
      offsetY: lap,
      panelClass: 'motion-above',
    },
    {
      originX: 'end',
      originY: 'top',
      overlayX: 'end',
      overlayY: 'bottom',
      offsetX: CARD_SHIFT,
      offsetY: lap,
      panelClass: 'motion-above',
    },
  ];
}

/** The shown event's card over its edge; the one writing an event clear of
    its foot. */
const SHOWN_CARD = cardPositions(CARD_OVERLAP, CARD_DOT);
const WRITING_CARD = cardPositions(-CARD_CLEAR, CARD_DELETE);
/** The one writing an event on a phone: in the middle of the screen (the
    room over the keyboard) — a 380px card hung from an event has nowhere
    to go there but over the grid anyway. */
const CENTRED_CARD: ConnectedPosition[] = [
  { originX: 'center', originY: 'center', overlayX: 'center', overlayY: 'center' },
];

/** A new event's title: at the surface's foot, in the middle, this far up
    off it, px. */
const QUICK_GAP = 128;
const QUICK_POSITIONS: ConnectedPosition[] = [
  {
    originX: 'center',
    originY: 'bottom',
    overlayX: 'center',
    overlayY: 'bottom',
    offsetY: -QUICK_GAP,
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

/** Where keys and pastes are the words' being written. */
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** Surfaces over the page that are someone else's — a compose window, a
    dialog, an overlay's pane (a hover card, a menu) — and the calendar's
    own among them (its event card, its quick title). A key pressed on a
    button in a compose window is the window's, never a calendar shortcut. */
const ELSEWHERE = '[role="dialog"], [role="alertdialog"], .cdk-overlay-pane';
const OWN_SURFACES = '.calendar-card, .calendar-quick';

/** Whether a key or a paste aimed at `target` is not the calendar's: words
    being written, or anything on a surface that is not its own. */
const notTheCalendars = (target: HTMLElement | null): boolean =>
  !!target?.closest?.(EDITABLE) ||
  (!!target?.closest?.(ELSEWHERE) && !target.closest(OWN_SURFACES));

/** What steers with the arrow keys itself: there they are its own. */
const ARROW_WIDGETS =
  '[role="grid"], [role="menu"], [role="menubar"], [role="listbox"], [role="tablist"], ' +
  '[role="radiogroup"], [role="toolbar"], [role="slider"], [role="tree"]';

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
 * Google's keys: T today, D W M Y A X a view, J or N next, K or P previous
 * (Notion's arrows too, at once — only a drag's turn slides),
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
    QuickTitle,
    EventSummary,
    ColorMarker,
  ],
  templateUrl: './calendar.html',
  styleUrl: './calendar.scss',
  host: { '(document:keydown)': 'key($event)', '(document:paste)': 'pasted($event)' },
})
export class CalendarPage {
  readonly #router = inject(Router);
  readonly #store = inject(CalendarEvents);
  readonly #feed = inject(CalendarFeed);
  readonly #formats = inject(CalendarFormat).formats;
  readonly #snackBar = inject(MatSnackBar);
  readonly #i18n = inject(I18n);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #injector = inject(Injector);
  readonly #viewport = inject(Viewport);

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
  /** Whose holidays: the calendar region's (app settings), whatever
      language the app speaks — the names are the language's. */
  readonly #holidayCountry = computed(() => this.#formats().region);

  /** The days the page reaches over — a month's first week can start in
      December — and, a strip, every day it has drawn. */
  readonly #reach = computed<GridWindow>(() => {
    const page = this.#page();
    const window = this.#window();
    const first = page.days[0] ?? page.weeks[0]?.[0] ?? page.months[0];
    const last = page.days.at(-1) ?? page.weeks.at(-1)?.at(-1) ?? page.to.toISODate()!;
    return window
      ? { from: window.from < first ? window.from : first, to: window.to > last ? window.to : last }
      : { from: first, to: last };
  });

  /** The years the page reaches into. */
  readonly #years = computed(
    () => {
      const { from, to } = this.#reach();
      const first = +from.slice(0, 4);
      return Array.from({ length: +to.slice(0, 4) - first + 1 }, (_, i) => first + i);
    },
    { equal: (a, b) => a.length === b.length && a.every((year, i) => year === b[i]) },
  );

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
    { rows: Holiday[] | undefined; on: boolean; language: string; country: string },
    CalendarEvent[]
  >({
    source: () => ({
      rows: this.#holidayRows.hasValue() ? this.#holidayRows.value() : undefined,
      on: this.showHolidays(),
      language: this.#formats().language,
      country: this.#holidayCountry(),
    }),
    computation: ({ rows, on, language, country }, previous) => {
      if (!on) return [];
      if (rows) {
        return holidayEvents(rows, language, country, (regions) =>
          this.#i18n.t('calendar.regionalHoliday', { regions }),
        );
      }
      return previous?.value ?? [];
    },
  });

  readonly #holidayById = computed(
    () => new Map(this.#holidays().map((holiday) => [holiday.id, holiday])),
  );

  /** Every event the views lay out: the weeks the feed has handed over
      (`CalendarFeed`, the backend's) and the holidays. */
  protected readonly events = computed(() => [...this.#feed.events(), ...this.#holidays()]);

  /** The days a strip has drawn — its buffer either side of the view. */
  readonly #window = signal<GridWindow | null>(null);

  /** A strip drew other days: the feed is asked for them. */
  protected fetch(window: GridWindow): void {
    this.#window.set(window);
  }

  /** Whether the hours' strip holds weekends: as the page says — but a
      day at a time it holds every day, as the day view does. */
  protected readonly stripWeekends = computed(() => this.weekends() || this.#view() === 'day');

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
  /** Whether the event being written was marked on the grid: its title
      alone, at the surface's foot (`QuickTitle`), not the card. */
  readonly #quick = signal(false);
  protected readonly quickOpen = computed(() => !!this.edit() && this.#quick());
  protected readonly quickPositions = QUICK_POSITIONS;
  protected readonly cardOpen = computed(() => (!!this.edit() && !this.#quick()) || !!this.shown());
  /** What the card holds: the event written in it (not one named at the
      foot) or the event shown — held as it stood while the card leaves,
      so it goes as it was instead of turning into what replaced it. */
  protected readonly cardContent = linkedSignal<CardContent, CardContent>({
    source: () => ({ edit: this.#quick() ? null : this.edit(), shown: this.shown() }),
    computation: (now, previous) => (now.edit || now.shown || !previous ? now : previous.value),
  });
  /** The card's tint: the colour of the event in it — its marker's, as it
      is being chosen. */
  protected readonly cardTint = computed(() => {
    const { edit, shown } = this.cardContent();
    const color = edit?.color ?? shown?.color;
    return color ? EVENT_COLOR_VALUES[color] : null;
  });
  /** Whether the card writing an event stands in the middle of the screen
      (`CENTRED_CARD`, a phone) rather than hung from the event. */
  protected readonly cardCentred = computed(
    () => !!this.cardContent().edit && this.#viewport.compact(),
  );
  /** The room the centred card is centred in: the screen over the
      keyboard. */
  protected readonly keyboardInset = this.#viewport.keyboardInset;
  protected readonly cardPositions = computed(() =>
    this.cardCentred() ? CENTRED_CARD : this.cardContent().edit ? WRITING_CARD : SHOWN_CARD,
  );
  /** What an event without a title says: "(No title)". */
  protected readonly untitled = computed(() => this.#i18n.t('calendar.untitled'));

  private readonly card = viewChild.required('card', { read: CdkConnectedOverlay });
  private readonly quickTitle = viewChild(QuickTitle);

  constructor() {
    // The days the page and its strip reach over: the feed is asked for
    // their weeks (those it has are not asked again).
    effect(() => {
      const { from, to } = this.#reach();
      untracked(() => this.#feed.request(from, to));
    });

    const tick = setInterval(() => this.now.set(DateTime.now()), TICK);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));

    // An open card follows its anchor — the next mark, the mark dragged —
    // once the anchor stands there; and takes its new place when it turns
    // from showing an event to writing it (clear of the event's foot).
    // Centred, it follows the keyboard instead.
    afterRenderEffect(() => {
      this.anchor();
      this.cardPositions();
      this.keyboardInset();
      this.card().overlayRef?.updatePosition();
    });
    // Centred, it stays centred as it grows or shrinks — a row brought out,
    // the note written into: the overlay is placed only when asked.
    afterRenderEffect((onCleanup) => {
      const ref = this.cardCentred() ? this.card().overlayRef : null;
      if (!ref) return;
      const observer = new ResizeObserver(() => ref.updatePosition());
      observer.observe(ref.overlayElement);
      onCleanup(() => observer.disconnect());
    });

    // The context menu gone: focus back on the event it was opened on —
    // Aria hands it to the trigger, which is hidden and cannot hold it.
    effect(() => {
      if (this.menuOpener().expanded()) return;
      untracked(() => {
        const back = this.#menuReturn;
        this.#menuReturn = null;
        if (back?.isConnected) back.focus({ preventScroll: true });
      });
    });
  }

  // ─── Going places ───────────────────────────────────────────────────

  /** To a view and a day. A custom view is remembered first: its path
      (`/r/customweek/…`) names its kind, the length is the setting's. */
  protected go(view: CalendarView, day: IsoDay | DateTime, replace = false): void {
    if (isCustomView(view)) this.#custom.set(view);
    void this.#router.navigateByUrl(calendarPath(view, day), { replaceUrl: replace });
  }

  /** The month's strip scrolled to another month (or a run of weeks to
      another first week): the path follows — in place, not a step back
      for each month scrolled past. */
  protected follow(day: IsoDay): void {
    this.go(this.#view(), day, true);
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

  /** The day the grids light up for a moment, and how many were asked. */
  protected readonly flash = signal<DayFlash | null>(null);

  /** Cmd/Ctrl and a click on a day in the mini month, Notion's: the view
      stays what it is, moved there if it must be, and the day lights up
      for a moment — here it is. The day lit last does not light again
      (Notion's, measured): only another day does, and after it, it may. */
  protected revealDay(day: IsoDay): void {
    if (!this.miniSelected().includes(day)) this.go(this.#view(), day);
    this.flash.update((last) => (last?.day === day ? last : { day, id: (last?.id ?? 0) + 1 }));
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

  /** Room marked for a new event on the grid: its title alone, at the
      surface's foot (`QuickTitle`) — the card stays for the rest. One open
      already gives way to it, the title taking focus back; the next mark
      is a press away, Notion's. */
  protected created({ draft, rect }: GridCreate): void {
    this.#select(null);
    this.#write(draft, rect, true);
    afterNextRender(() => this.quickTitle()?.focus(), { injector: this.#injector });
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

  #write(draft: CalendarEventDraft, rect: AnchorRect, quick = false): void {
    this.#shownId.set(null);
    this.#quick.set(quick);
    this.anchor.set(rect);
    this.edit.set(draft);
  }

  /** The event pressed last — selected (`aria-current` on its chip),
      whether or not its card is open. */
  protected readonly selectedId = signal<string | null>(null);
  /** The events a marquee (Shift and a drag) selected, or Shift presses
      added — while there are, the one pressed last is none. */
  readonly #selectedMany = signal<readonly string[]>([]);
  /** Every event selected: the grids light them (`aria-current`). */
  protected readonly selection = computed(() => {
    const many = this.#selectedMany();
    const one = this.selectedId();
    return many.length ? many : one ? [one] : [];
  });

  /** One event selected — or none: whatever a marquee selected goes. */
  #select(id: string | null): void {
    this.#selectedMany.set([]);
    this.selectedId.set(id);
  }

  /** A marquee let go: the events it covered, selected — what is open
      closes. */
  protected selectMany(ids: readonly string[]): void {
    this.closeCard();
    this.selectedId.set(null);
    this.#selectedMany.set(ids);
  }

  /** An event pressed with Shift: added to the selection, or taken out. */
  protected toggleSelected(id: string): void {
    this.closeCard();
    const now = this.selection();
    this.selectedId.set(null);
    this.#selectedMany.set(now.includes(id) ? now.filter((one) => one !== id) : [...now, id]);
  }

  /** The events selected deleted, all at once — with a moment to take
      them all back. A holiday among them stays. */
  #removeSelected(): void {
    const gone = this.#selectedEvents().filter((event) => !event.readonly);
    this.#select(null);
    this.#removeAll(gone, 'calendar.deleted', 'calendar.deletedMany');
  }

  /** Every event selected, as they are — those gone meanwhile left out. */
  #selectedEvents(): CalendarEvent[] {
    return this.selection()
      .map((id) => this.#eventById(id))
      .filter((event): event is CalendarEvent => !!event);
  }

  /** Events taken away — deleted, or cut — saying so, with a moment to
      take them all back at once: one says `said`, more `saidMany`. */
  #removeAll(events: readonly CalendarEvent[], said: string, saidMany: string): void {
    if (events.length < 2) {
      if (events.length) this.#remove(events[0].id, said);
      return;
    }
    const ids = events.map((event) => event.id);
    if (ids.includes(this.#shownId() ?? '') || ids.includes(this.edit()?.id ?? '')) {
      this.closeCard();
    }
    if (ids.includes(this.selectedId() ?? '')) this.#select(null);
    this.#selectedMany.update((many) => many.filter((one) => !ids.includes(one)));
    const gone = ids
      .map((id) => this.#store.remove(id))
      .filter((event): event is CalendarEvent => !!event);
    if (!gone.length) return;
    this.#snackBar
      .open(this.#i18n.t(saidMany, { count: gone.length }), this.#i18n.t('calendar.undo'), {
        duration: 4000,
      })
      .onAction()
      .subscribe(() => gone.forEach((event) => this.#store.save(event)));
  }

  /** An event pressed: selected — no card any more, whatever is open
      closes. It is written from its menu's Edit (`#editEvent`). */
  protected opened({ id }: GridOpen): void {
    this.closeCard();
    this.#select(id);
  }

  /** Empty room pressed once: what is open closes, nothing stays
      selected. */
  protected dismissed(): void {
    this.closeCard();
    this.#select(null);
  }

  /** The menu's Edit: the event written in the card, hung from its head
      (the card stands clear of its foot, `WRITING_CARD`). */
  #editEvent(event: CalendarEvent): void {
    const chip = [...this.#host.querySelectorAll<HTMLElement>('[data-event-id]')].find(
      (one) => one.dataset['eventId'] === event.id,
    );
    // The editor takes focus; the menu must not hand it back to the event.
    this.#menuReturn = null;
    this.#shownId.set(null);
    this.#quick.set(false);
    if (chip) this.anchor.set(headOf(chip));
    this.#select(event.id);
    this.edit.set({ ...event });
  }

  /** The card's Edit: the shown event, written. */
  protected editShown(): void {
    const event = this.shown();
    if (!event || event.readonly) return;
    this.#shownId.set(null);
    this.#quick.set(false);
    this.edit.set({ ...event });
  }

  /** The shown event's colour changed at its card's head: stored at once,
      the card staying open on it. */
  protected recolor(color: EventColor): void {
    const event = this.shown();
    if (!event || event.readonly) return;
    this.#store.save({ ...event, color });
  }

  /** Moved or stretched in a grid: stored at once. */
  protected changed(event: CalendarEvent): void {
    this.#store.save(event);
    const edit = this.edit();
    if (edit?.id === event.id) this.edit.set({ ...edit, start: event.start, end: event.end });
    // Its card goes with it, to where it was dropped (the hours, or the
    // band it moved into).
    if (edit?.id === event.id || this.#shownId() === event.id) this.#anchorOn(event.id);
  }

  /** Stands the card's anchor on the event with this id (`draft` for the
      mark) once the next render has drawn it there. The anchor is moved by
      its bindings in the render after that — the card is placed against it
      then, not in this pass, where it still stands where it was. */
  #anchorOn(id: string): void {
    afterNextRender(
      {
        earlyRead: () => {
          const chip = this.#host.querySelector(`[data-event-id="${CSS.escape(id)}"]`);
          return chip ? headOf(chip) : null;
        },
        write: (box) => {
          if (!box) return;
          this.anchor.set(box);
          afterNextRender(
            { read: () => this.card().overlayRef?.updatePosition() },
            { injector: this.#injector },
          );
        },
      },
      { injector: this.#injector },
    );
  }

  /** Saved — the card's Save (or Enter in its title), or Enter in the
      title at the foot (`QuickTitle`): stored, and the card gone. */
  protected saved(edit: EventEdit): void {
    if (edit.id) this.#store.save(edit as CalendarEvent);
    else this.#store.create(edit);
    this.closeCard();
  }

  /** Deleted — with a moment to take it back. */
  protected removed(): void {
    const id = this.edit()?.id ?? this.#shownId();
    this.closeCard();
    if (id) this.#remove(id, 'calendar.deleted');
  }

  /** Takes an event away — deleted, or cut — saying so, with a moment to
      take it back; its card goes with it. */
  #remove(id: string, said: string): void {
    if (this.#shownId() === id || this.edit()?.id === id) this.closeCard();
    if (this.selectedId() === id) this.#select(null);
    this.#selectedMany.update((many) => many.filter((one) => one !== id));
    const gone = this.#store.remove(id);
    if (!gone) return;
    this.#snackBar
      .open(this.#i18n.t(said), this.#i18n.t('calendar.undo'), { duration: 4000 })
      .onAction()
      .subscribe(() => this.#store.save(gone));
  }

  // ─── Cut, copy, paste ───────────────────────────────────────────────

  /** What was copied or cut: events' content, earliest first, to be
      pasted as new ones. */
  readonly #clipboard = signal<readonly CalendarEventDraft[]>([]);
  /** What the context menu is about: events (the one pressed, or every
      one selected with it), or a slot to paste at. */
  readonly #menuFor = signal<{ events: readonly CalendarEvent[] } | { slot: GridSlot } | null>(
    null,
  );
  /** Where the menu's hidden trigger stands. */
  protected readonly menuAt = signal({ x: 0, y: 0 });
  /** Where focus goes back to once the menu is gone. */
  #menuReturn: HTMLElement | null = null;
  private readonly menuOpener = viewChild.required<MenuTrigger<EventAction>>('contextTrigger');
  private readonly timeGrid = viewChild(TimeGrid);
  private readonly monthGrid = viewChild(MonthGrid);

  /** The menu's rows: an event's five (a holiday's own can be copied and
      duplicated, not edited, cut or deleted), or a slot's: a new event there, and
      the copied one pasted there — there once something is copied. */
  protected readonly menuItems = computed<ToolbarMenuItem<EventAction>[]>(() => {
    const about = this.#menuFor();
    if (!about) return [];
    const t = (key: string) => this.#i18n.t(key);
    if ('slot' in about) {
      return [
        { value: 'create', label: t('calendar.new'), icon: 'add', shortcut: 'C' },
        {
          value: 'paste',
          label: t('calendar.paste'),
          icon: 'content_paste',
          ...withMod('V'),
          disabled: !this.#clipboard().length,
        },
      ];
    }
    // Many: cut and deleted are those of their own, Edit is one's alone.
    const fixed = about.events.every((event) => event.readonly);
    return [
      {
        value: 'edit',
        label: t('calendar.edit'),
        icon: 'edit',
        disabled: fixed || about.events.length > 1,
      },
      {
        value: 'cut',
        label: t('calendar.cut'),
        icon: 'content_cut',
        ...withMod('X'),
        disabled: fixed,
        separated: true,
      },
      { value: 'copy', label: t('calendar.copy'), icon: 'content_copy', ...withMod('C') },
      { value: 'duplicate', label: t('calendar.duplicate'), icon: 'library_add', ...withMod('D') },
      {
        value: 'delete',
        label: t('calendar.delete'),
        icon: 'delete',
        shortcut: MAC ? '⌫' : 'Del',
        shortcutKeys: 'Delete Backspace',
        disabled: fixed,
        separated: true,
      },
    ];
  });

  /** A right-click in the views: on an event, its menu (and it selected);
      on an empty slot a new event there, or what was copied pasted there —
      on the mark too, the room still being chosen, let go first: the slot
      under it is empty room. Anywhere else (the heads, the corner), the
      browser's. */
  protected contextMenu(event: MouseEvent): void {
    const at = { x: event.clientX, y: event.clientY };
    const chip = (event.target as Element).closest<HTMLElement>('[data-event-id]');
    if (chip?.dataset['eventId'] === DRAFT_ID) {
      this.closeCard();
    } else if (chip) {
      const pressed = this.#eventById(chip.dataset['eventId'] ?? '');
      if (!pressed) return;
      event.preventDefault();
      // One of many selected: the menu is about them all.
      const selected = this.#selectedEvents();
      if (selected.length > 1 && selected.some((one) => one.id === pressed.id)) {
        return this.#openMenu(at, { events: selected }, chip);
      }
      this.#select(pressed.id);
      return this.#openMenu(at, { events: [pressed] }, chip);
    }
    const slot = this.timeGrid()?.slotAt(event) ?? this.monthGrid()?.slotAt(event);
    if (!slot) return;
    event.preventDefault();
    this.#openMenu(at, { slot }, null);
  }

  #openMenu(
    at: { x: number; y: number },
    about: { events: readonly CalendarEvent[] } | { slot: GridSlot },
    returnTo: HTMLElement | null,
  ): void {
    this.menuAt.set(at);
    this.#menuFor.set(about);
    // After this event has gone round: the CDK closes an open menu on a
    // right-click outside it — this one's — so a second right-click moves
    // the menu rather than shutting it.
    setTimeout(() => {
      this.#menuReturn = returnTo;
      this.menuOpener().open();
    });
  }

  protected menuPicked(action: EventAction): void {
    const about = this.#menuFor();
    if (!about) return;
    if ('slot' in about) {
      if (action === 'create') this.#createAt(about.slot);
      else if (action === 'paste') this.#paste(about.slot);
      return;
    }
    this.#act(action, about.events);
  }

  /** Does `action` to events — one, or every one selected. A holiday is
      never edited, cut or deleted: among others, it is left where it is;
      Edit is one event's alone. */
  #act(action: EventAction, events: readonly CalendarEvent[]): void {
    if (action === 'copy') return this.#copy(events);
    if (action === 'duplicate') {
      for (const event of events) this.#store.create(contentOf(event));
      return;
    }
    const own = events.filter((event) => !event.readonly);
    if (!own.length) return;
    if (action === 'edit') {
      if (events.length === 1) this.#editEvent(own[0]);
    } else if (action === 'cut') {
      this.#copy(own);
      this.#removeAll(own, 'calendar.cutDone', 'calendar.cutMany');
    } else if (action === 'delete') {
      this.#removeAll(own, 'calendar.deleted', 'calendar.deletedMany');
    }
  }

  /** Kept to be pasted — and, for anywhere else, as Notion Calendar's
      lines, one an event: its title and when it is
      (`eventClipboardLine`), earliest first. */
  #copy(events: readonly CalendarEvent[]): void {
    if (!events.length) return;
    const drafts = events.map(contentOf).sort((a, b) => +eventSpan(a).start - +eventSpan(b).start);
    this.#clipboard.set(drafts);
    // Each ended by a line break, as Notion's one is.
    const text = drafts
      .map((draft) => `${eventClipboardLine(draft, draft.title.trim() || this.untitled())}\n`)
      .join('');
    this.#copiedText = text.trim();
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  /** The lines the last copy wrote: while the clipboard still says them,
      a paste is those events whole — colour, place and note too. */
  #copiedText: string | null = null;

  /**
   * ⌘/Ctrl V, as the browser's paste — whose words need no permission to
   * read: the events copied here, while the clipboard still holds their
   * lines (or nothing could be written there); else the events Notion
   * Calendar's lines name (`parseEventClipboardLine`), copied there or
   * here. At the quarter the pointer rests on, else at their own time on
   * the day in view. Any other words are the browser's.
   */
  protected pasted(event: ClipboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (event.defaultPrevented || this.edit() || notTheCalendars(target)) return;
    const text = event.clipboardData?.getData('text/plain').trim() ?? '';
    const copied = this.#clipboard();
    const content =
      copied.length && (!text || text === this.#copiedText) ? copied : this.#fromLines(text);
    if (!content.length) return;
    event.preventDefault();
    this.#paste(this.timeGrid()?.hoveredSlot() ?? { day: this.day(), minute: null }, content);
  }

  /** The events copied lines name — every line one, or none at all:
      their titles and times, the rest a new one's. */
  #fromLines(text: string): CalendarEventDraft[] {
    const named = text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map(parseEventClipboardLine);
    if (!named.length || named.some((one) => !one)) return [];
    const blank = draftAt(DateTime.now());
    return named.map((one) => ({ ...blank, ...one! }));
  }

  /** A new event at a slot: an hour from the quarter in the hours — the
      whole day on the all-day band or a month's day, as a press there
      makes — named as one marked there is (`created`). */
  #createAt(slot: GridSlot): void {
    const day = parseDay(slot.day);
    if (!day) return;
    const draft =
      slot.minute === null ? draftAt(day, { allDay: true }) : draftAt(atMinute(day, slot.minute));
    const { x, y } = this.menuAt();
    this.created({ draft, rect: { left: x, top: y, width: 0, height: 0 } });
  }

  /** The copied events, new, at a slot — earliest first, as far apart as
      they were: the first on the slot's day, a timed one at the slot's
      minute — or at its own time of day on a whole day; an all-day one
      that whole day. Each as long as it was; the pasted ones selected. */
  #paste(slot: GridSlot, copied = this.#clipboard()): void {
    const day = parseDay(slot.day);
    if (!copied.length || !day) return;
    const starts = copied.map((draft) => eventSpan(draft).start);
    const firstTimed = copied.findIndex((draft) => !draft.allDay);
    const days = daysBetween(starts[0], day);
    const minutes =
      firstTimed < 0 || slot.minute === null ? 0 : slot.minute - minuteOfDay(starts[firstTimed]);
    // On the clock, not in elapsed time: across a clock change a 10:00
    // stays 10:00.
    const moved = (start: DateTime, allDay: boolean) => {
      const minute = minuteOfDay(start) + (allDay ? 0 : minutes);
      const overDays = Math.floor(minute / DAY_MINUTES);
      return atMinute(start.plus({ days: days + overDays }), minute - overDays * DAY_MINUTES);
    };
    const pasted = copied.map((draft, i) =>
      this.#store.create(movedTo(draft, moved(starts[i], draft.allDay))),
    );
    if (pasted.length > 1) this.selectMany(pasted.map((event) => event.id));
    else this.#select(pasted[0].id);
  }

  #eventById(id: string): CalendarEvent | null {
    return this.#store.byId().get(id) ?? this.#holidayById().get(id) ?? null;
  }

  /**
   * The menu's keys, without the menu — on the focused event, else on the
   * event whose card is open, else on the one selected (a press selects
   * without focusing): ⌘/Ctrl C, X, D, Delete (⌘/Ctrl V is the paste's,
   * `pasted`). Shift+F10 and the menu key open the menu under the focused event. A
   * selection of words is the browser's to copy.
   */
  #shortcut(event: KeyboardEvent): boolean {
    const focused = (event.target as Element | null)?.closest?.<HTMLElement>('[data-event-id]');
    const selected = this.selectedId();
    const focusedEvent = focused ? this.#eventById(focused.dataset['eventId'] ?? '') : null;
    const subject = focused
      ? focusedEvent
      : this.edit()
        ? null
        : (this.shown() ?? (selected ? this.#eventById(selected) : null));
    if (
      focused &&
      subject &&
      (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
    ) {
      const box = focused.getBoundingClientRect();
      this.#openMenu({ x: box.left, y: box.bottom }, { events: [subject] }, focused);
      return true;
    }
    const mod = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    if (mod) {
      const key = event.key.toLowerCase();
      // ⌘/Ctrl V is left to the browser: its paste reads the clipboard
      // (`pasted`).
      // Many selected (a marquee's) — and none focused outside them: the
      // keys are theirs, all of them.
      const many = this.#selectedMany().length && !this.edit() ? this.#selectedEvents() : [];
      const subjects =
        many.length && (!focusedEvent || many.includes(focusedEvent))
          ? many
          : subject
            ? [subject]
            : [];
      if (!subjects.length) return false;
      if (key === 'c') {
        if (getSelection()?.isCollapsed === false) return false;
        this.#act('copy', subjects);
        return true;
      }
      if (key === 'x' && subjects.some((one) => !one.readonly)) {
        this.#act('cut', subjects);
        return true;
      }
      if (key === 'd') {
        this.#act('duplicate', subjects);
        return true;
      }
      return false;
    }
    if (
      (focused || selected) &&
      subject &&
      !subject.readonly &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      (event.key === 'Delete' || event.key === 'Backspace')
    ) {
      this.#act('delete', [subject]);
      return true;
    }
    return false;
  }

  /** The card closed without Save — Escape, a press away, its ×: what it
      held is let go; the stored event stays as it was. */
  protected closeCard(): void {
    this.edit.set(null);
    this.#quick.set(false);
    this.#shownId.set(null);
  }

  /** An overlay taken down: closed only if it went by itself. Closed
      because the other one took over — the card for a title at the foot,
      or back — it closes nothing: that would drop what replaced it. */
  protected cardDetached(): void {
    if (this.cardOpen()) this.closeCard();
  }

  protected quickDetached(): void {
    if (this.quickOpen()) this.closeCard();
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
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    if (notTheCalendars(target)) return;
    // Many selected (a marquee's): Delete takes them all.
    if (
      this.#selectedMany().length &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      (event.key === 'Delete' || event.key === 'Backspace')
    ) {
      event.preventDefault();
      this.#removeSelected();
      return;
    }
    if (this.#shortcut(event)) {
      event.preventDefault();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // Escape with nothing open lets go of what is selected.
    if (
      event.key === 'Escape' &&
      !this.cardOpen() &&
      !this.quickOpen() &&
      this.selection().length
    ) {
      event.preventDefault();
      this.#select(null);
      return;
    }
    if (this.cardOpen() || this.quickOpen()) {
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
    // Notion's arrows: the interval before or after, at once — not where
    // a widget steers with them (the mini month, a menu, a list).
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.shiftKey) {
      if (target?.closest(ARROW_WIDGETS)) return;
      const rtl = getComputedStyle(this.#host).direction === 'rtl';
      event.preventDefault();
      this.step((event.key === 'ArrowRight') !== rtl ? 1 : -1);
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
