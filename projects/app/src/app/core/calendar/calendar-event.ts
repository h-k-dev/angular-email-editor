import { DateTime } from 'luxon';

import { IsoMoment, daysBetween, isoMoment, parseMoment } from './calendar-dates';

/**
 * An event's colour: Google Calendar's eleven, by Google's names — the
 * palette an invitation from Google carries (`colorId` 1–11), so an event
 * keeps its colour on its way into an email and back.
 */
export const EVENT_COLORS = [
  'tomato',
  'flamingo',
  'tangerine',
  'banana',
  'sage',
  'basil',
  'peacock',
  'blueberry',
  'lavender',
  'grape',
  'graphite',
] as const;

export type EventColor = (typeof EVENT_COLORS)[number];

/** Each colour's ink, Google's own. */
export const EVENT_COLOR_VALUES: Readonly<Record<EventColor, string>> = {
  tomato: '#d50000',
  flamingo: '#e67c73',
  tangerine: '#f4511e',
  banana: '#f6bf26',
  sage: '#33b679',
  basil: '#0b8043',
  peacock: '#039be5',
  blueberry: '#3f51b5',
  lavender: '#7986cb',
  grape: '#8e24aa',
  graphite: '#616161',
};

/** A new event's colour, Google's default. */
export const DEFAULT_EVENT_COLOR: EventColor = 'peacock';

/** How long a new event lasts, minutes — Google's default hour. */
export const DEFAULT_EVENT_MINUTES = 60;

/**
 * An event, shaped as iCalendar's `VEVENT` is (RFC 5545): what an
 * invitation carries, so the calendar and an email speak of one thing —
 * `SUMMARY` the title, `DTSTART` / `DTEND` the two moments, `LOCATION`,
 * `DESCRIPTION`. Moments are local and floating (`calendar-dates.ts`);
 * the end is exclusive, as `DTEND` is: an all-day event on the 29th runs
 * `2026-10-29T00:00` → `2026-10-30T00:00`.
 */
export interface CalendarEvent {
  id: string;
  title: string;
  start: IsoMoment;
  end: IsoMoment;
  /** A day (or days) with no time of its own — always from midnight to
      midnight. */
  allDay: boolean;
  color: EventColor;
  location: string;
  description: string;
}

/** An event as written, before the store has given it an id. */
export type CalendarEventDraft = Omit<CalendarEvent, 'id'>;

/** An event being written: a new one (no id), or a stored one's edit. */
export type EventEdit = CalendarEventDraft & { id?: string };

/** The id a new event shows under while it is written — never a stored
    one's (those are UUIDs). */
export const DRAFT_ID = 'draft';

/** The edit as an event a grid can lay out. */
export function editAsEvent(edit: EventEdit): CalendarEvent {
  return { ...edit, id: edit.id ?? DRAFT_ID };
}

/** An event's two moments. A broken one (storage edited by hand) lasts no
    time at all, at its start or at the epoch. */
export interface EventSpan {
  start: DateTime;
  end: DateTime;
}

export function eventSpan(event: Pick<CalendarEvent, 'start' | 'end'>): EventSpan {
  const start = parseMoment(event.start) ?? DateTime.fromMillis(0);
  const end = parseMoment(event.end) ?? start;
  return { start, end: end < start ? start : end };
}

/** Whether the event sits in the band over the days rather than in their
    hours — all day, or across a midnight, as Google lays one out. */
export function inBand(event: CalendarEvent): boolean {
  if (event.allDay) return true;
  const { start, end } = eventSpan(event);
  // The last minute it holds, not its exclusive end: 10:00 → 00:00 ends
  // the day it starts.
  return daysBetween(start, DateTime.max(start, end.minus({ minutes: 1 }))) > 0;
}

/** A draft from `start`, `minutes` long — or, all day, the day `start` is
    in, `days` of them. */
export function draftAt(
  start: DateTime,
  { minutes = DEFAULT_EVENT_MINUTES, allDay = false, days = 1 } = {},
): CalendarEventDraft {
  const from = allDay ? start.startOf('day') : start;
  const to = allDay ? from.plus({ days }) : from.plus({ minutes });
  return {
    title: '',
    start: isoMoment(from),
    end: isoMoment(to),
    allDay,
    color: DEFAULT_EVENT_COLOR,
    location: '',
    description: '',
  };
}

/** Moves an event to start at `start`, keeping how long it lasts. */
export function movedTo<T extends CalendarEventDraft>(event: T, start: DateTime): T {
  const span = eventSpan(event);
  return {
    ...event,
    start: isoMoment(start),
    end: isoMoment(start.plus(span.end.diff(span.start))),
  };
}

/** Whether `value` is an event as this version stores one. */
export function isCalendarEvent(value: unknown): value is CalendarEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event['id'] === 'string' &&
    typeof event['title'] === 'string' &&
    !!parseMoment(event['start'] as string) &&
    !!parseMoment(event['end'] as string) &&
    typeof event['allDay'] === 'boolean' &&
    EVENT_COLORS.includes(event['color'] as EventColor) &&
    typeof event['location'] === 'string' &&
    typeof event['description'] === 'string'
  );
}
