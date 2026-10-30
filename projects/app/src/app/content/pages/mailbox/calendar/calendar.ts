import {
  Component,
  DOCUMENT,
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
  IsoDay,
  atMinute,
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
import {
  GridCreate,
  GridOpen,
  GridSlot,
  HEAD_ROOM,
  boxOf,
  headOf,
} from '../../../partials/atomic/calendar/calendar-grid';
import { EventEditor } from '../../../partials/atomic/calendar/event-editor/event-editor';
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

/** What the context menu does — to an event, or at a slot. */
type EventAction = 'cut' | 'copy' | 'duplicate' | 'delete' | 'create' | 'paste';

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
  const { title, start, end, allDay, color, location, description } = event;
  return { title, start, end, allDay, color, location, description };
}

/** Where the card's colour dot stands across it, from its start: the
    card's inset (16px, calendar.scss — its lines are rings, taking no
    room) and the dot's half (12px, the colour marker — set flush on the
    inset). The card stands that far before the event's colour mark
    (`headOf` starts there: a block's stripe at 4px, a month item's dot at
    12px), dot over colour, px. */
const CARD_DOT = 16 + 6;
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
 * The card under its event, hung from its head (`headOf`): its own colour
 * dot right under the event's colour (`CARD_DOT`), and over the head's
 * bottom a little (`lap`) — a short event mostly in view, the card
 * plainly its own.
 * Near the screen's end it lines up with the event's end instead; with no
 * room under it, over it, rising out of it (`motion-above`).
 */
function cardPositions(lap: number): ConnectedPosition[] {
  return [
    {
      originX: 'start',
      originY: 'bottom',
      overlayX: 'start',
      overlayY: 'top',
      offsetX: -CARD_DOT,
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
      offsetX: -CARD_DOT,
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
const SHOWN_CARD = cardPositions(CARD_OVERLAP);
const WRITING_CARD = cardPositions(-CARD_CLEAR);

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
    ColorMarker,
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
  readonly #injector = inject(Injector);

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
  /** The card's tint: the colour of the event in it — its marker's, as it
      is being chosen. */
  protected readonly cardTint = computed(() => {
    const color = this.edit()?.color ?? this.shown()?.color;
    return color ? EVENT_COLOR_VALUES[color] : null;
  });
  protected readonly cardPositions = computed(() => (this.edit() ? WRITING_CARD : SHOWN_CARD));
  protected readonly editingStored = computed(() => !!this.edit()?.id);

  /** What an event without a title says: "(No title)". */
  protected readonly untitled = computed(() => this.#i18n.t('calendar.untitled'));

  private readonly card = viewChild.required(CdkConnectedOverlay);

  constructor() {
    const tick = setInterval(() => this.now.set(DateTime.now()), TICK);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));

    // An open card follows its anchor — the next mark, the mark dragged —
    // once the anchor stands there; and takes its new place when it turns
    // from showing an event to writing it (clear of the event's foot).
    afterRenderEffect(() => {
      this.anchor();
      this.cardPositions();
      this.card().overlayRef?.updatePosition();
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
  /** Room marked for a new event: its card, first where the grid says
      the mark stands, then on the mark's head once it is drawn. */
  protected created({ draft, rect }: GridCreate): void {
    this.#write(draft, rect);
    this.#anchorOn(DRAFT_ID);
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
    const gone = this.#store.remove(id);
    if (!gone) return;
    this.#snackBar
      .open(this.#i18n.t(said), this.#i18n.t('calendar.undo'), { duration: 4000 })
      .onAction()
      .subscribe(() => this.#store.save(gone));
  }

  // ─── Cut, copy, paste ───────────────────────────────────────────────

  /** What was copied or cut: an event's content, to be pasted as a new
      one. */
  readonly #clipboard = signal<CalendarEventDraft | null>(null);
  /** What the context menu is about: an event, or a slot to paste at. */
  readonly #menuFor = signal<{ event: CalendarEvent } | { slot: GridSlot } | null>(null);
  /** Where the menu's hidden trigger stands. */
  protected readonly menuAt = signal({ x: 0, y: 0 });
  /** Where focus goes back to once the menu is gone. */
  #menuReturn: HTMLElement | null = null;
  private readonly menuOpener = viewChild.required<MenuTrigger<EventAction>>('contextTrigger');
  private readonly timeGrid = viewChild(TimeGrid);
  private readonly monthGrid = viewChild(MonthGrid);

  /** The menu's rows: an event's four (a holiday's own can be copied and
      duplicated, not cut or deleted), or a slot's: a new event there, and
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
          disabled: !this.#clipboard(),
        },
      ];
    }
    const fixed = !!about.event.readonly;
    return [
      {
        value: 'cut',
        label: t('calendar.cut'),
        icon: 'content_cut',
        ...withMod('X'),
        disabled: fixed,
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

  /** A right-click in the views: on an event, its menu; on an empty slot
      a new event there, or what was copied pasted there — anywhere else
      (the heads, the corner), the browser's. */
  protected contextMenu(event: MouseEvent): void {
    const at = { x: event.clientX, y: event.clientY };
    const chip = (event.target as Element).closest<HTMLElement>('[data-event-id]');
    if (chip) {
      const pressed = this.#eventById(chip.dataset['eventId'] ?? '');
      if (!pressed) return;
      event.preventDefault();
      return this.#openMenu(at, { event: pressed }, chip);
    }
    const slot = this.timeGrid()?.slotAt(event) ?? this.monthGrid()?.slotAt(event);
    if (!slot) return;
    event.preventDefault();
    this.#openMenu(at, { slot }, null);
  }

  #openMenu(
    at: { x: number; y: number },
    about: { event: CalendarEvent } | { slot: GridSlot },
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
    this.#act(action, about.event);
  }

  /** Does `action` to an event — a holiday is never cut or deleted. */
  #act(action: EventAction, event: CalendarEvent): void {
    if (action === 'copy') return this.#copy(event);
    if (action === 'duplicate') {
      this.#store.create(contentOf(event));
      return;
    }
    if (event.readonly) return;
    if (action === 'cut') {
      this.#copy(event);
      this.#remove(event.id, 'calendar.cutDone');
    } else if (action === 'delete') {
      this.#remove(event.id, 'calendar.deleted');
    }
  }

  /** Kept to be pasted — and, for anywhere else, as words: its title and
      when it is. */
  #copy(event: CalendarEvent): void {
    this.#clipboard.set(contentOf(event));
    const words = [
      event.title.trim() || this.untitled(),
      this.#formats().when(event),
      event.location.trim(),
    ].filter(Boolean);
    void navigator.clipboard?.writeText(words.join('\n')).catch(() => undefined);
  }

  /** A new event at a slot: an hour from the quarter in the hours — the
      whole day on the all-day band or a month's day, as a press there
      makes. Its card stands at the pointer until the mark is drawn, then
      hangs from the mark as every card hangs from its event (`created`). */
  #createAt(slot: GridSlot): void {
    const day = parseDay(slot.day);
    if (!day) return;
    const draft =
      slot.minute === null ? draftAt(day, { allDay: true }) : draftAt(atMinute(day, slot.minute));
    const { x, y } = this.menuAt();
    this.created({ draft, rect: { left: x, top: y, width: 0, height: 0 } });
  }

  /** The copied event, new, at a slot: a timed one at the slot's minute —
      or at its own time of day on a whole day; an all-day one on the
      slot's day. As long as it was. */
  #paste(slot: GridSlot): void {
    const copied = this.#clipboard();
    const day = parseDay(slot.day);
    if (!copied || !day) return;
    const start = copied.allDay
      ? day
      : atMinute(day, slot.minute ?? minuteOfDay(eventSpan(copied).start));
    this.#store.create(movedTo(copied, start));
  }

  #eventById(id: string): CalendarEvent | null {
    return this.#store.byId().get(id) ?? this.#holidayById().get(id) ?? null;
  }

  /**
   * The menu's keys, without the menu — on the focused event, else on the
   * event whose card is open: ⌘/Ctrl C, X, D, Delete; ⌘/Ctrl V pastes at
   * the quarter the pointer rests on, else at its own time on the day in
   * view. Shift+F10 and the menu key open the menu under the focused
   * event. A selection of words is the browser's to copy.
   */
  #shortcut(event: KeyboardEvent): boolean {
    const focused = (event.target as Element | null)?.closest?.<HTMLElement>('[data-event-id]');
    const subject = focused
      ? this.#eventById(focused.dataset['eventId'] ?? '')
      : this.edit()
        ? null
        : this.shown();
    if (
      focused &&
      subject &&
      (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
    ) {
      const box = focused.getBoundingClientRect();
      this.#openMenu({ x: box.left, y: box.bottom }, { event: subject }, focused);
      return true;
    }
    const mod = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    if (mod) {
      const key = event.key.toLowerCase();
      if (key === 'v') {
        if (!this.#clipboard() || this.edit()) return false;
        this.#paste(this.timeGrid()?.hoveredSlot() ?? { day: this.day(), minute: null });
        return true;
      }
      if (!subject) return false;
      if (key === 'c') {
        if (getSelection()?.isCollapsed === false) return false;
        this.#act('copy', subject);
        return true;
      }
      if (key === 'x' && !subject.readonly) {
        this.#act('cut', subject);
        return true;
      }
      if (key === 'd') {
        this.#act('duplicate', subject);
        return true;
      }
      return false;
    }
    if (
      focused &&
      subject &&
      !subject.readonly &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      (event.key === 'Delete' || event.key === 'Backspace')
    ) {
      this.#act('delete', subject);
      return true;
    }
    return false;
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
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
    ) {
      return;
    }
    if (this.#shortcut(event)) {
      event.preventDefault();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
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
