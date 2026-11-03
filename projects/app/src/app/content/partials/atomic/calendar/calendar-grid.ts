import { AnchorRect } from '@h-k-dev/angular-email-editor/anchor';

import { IsoDay } from '../../../../core/calendar/calendar-dates';
import { CalendarEventDraft, DRAFT_ID } from '../../../../core/calendar/calendar-event';

/**
 * What the calendar's grids tell the page — the day's hours and the month
 * alike. Each comes with the box on screen it happened at, viewport
 * coordinates, for the card the page opens beside it.
 */

/** Room was marked for a new event (a press, or a drag across hours). */
export interface GridCreate {
  draft: CalendarEventDraft;
  rect: AnchorRect;
}

/** An event was pressed. */
export interface GridOpen {
  id: string;
  rect: AnchorRect;
}

/** The days a grid has drawn, first to last — what it asks the feed for.
    A strip draws more than it shows: an interval either side. */
export interface GridWindow {
  from: IsoDay;
  to: IsoDay;
}

/** A marquee (Shift and a drag), Notion's: where it was pressed and where
    the pointer is, in a strip's own room (px from its first day across,
    from its top down) — it stays where it was drawn while the strip
    scrolls under it. A Shift press on an event that never moves toggles
    that event (`toggles`). An end over the hours' band of all-day events
    (`band`, which holds still over them) takes in the band. */
export interface GridMarquee {
  pointer: number;
  x: number;
  y: number;
  moved: boolean;
  from: GridMarqueePoint;
  to: GridMarqueePoint;
  toggles: string | null;
}

/** An end of a marquee, in its strip's room. */
export interface GridMarqueePoint {
  x: number;
  y: number;
  band?: boolean;
}

/** A marquee's box, in its strip's room. */
export function marqueeBox(marquee: GridMarquee | null) {
  if (!marquee?.moved) return null;
  const { from, to } = marquee;
  return {
    left: Math.min(from.x, to.x),
    top: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/** A place in a grid to put an event: a day at a minute of it, or the
    whole day (`null` — the all-day band, a month's cell). */
export interface GridSlot {
  day: IsoDay;
  minute: number | null;
}

/** How far a press travels before it is a drag, px. */
export const DRAG_THRESHOLD = 4;

/** A press on a grid's own empty room — or on the mark, the room still
    being chosen: a press there marks out anew, as on the room under it. */
export function pressedEmptyOrMark(event: Event): boolean {
  const target = event.target as Element;
  return target === event.currentTarget || !!target.closest?.(`[data-event-id="${DRAFT_ID}"]`);
}

/** How soon a second press counts as a double press, ms. */
const DOUBLE_PRESS = 500;

/**
 * Presses on empty room that did not move: a new event is made only by a
 * drag let go, or by two presses on the same place (`key` — a quarter, a
 * day) soon after each other — a press alone makes nothing. Its own
 * double click, not the browser's: the grids hold the pointer, and a
 * finger's taps count too.
 */
export class DoublePress {
  #last: { key: string; at: number } | null = null;

  /** Whether this press, at `key`, is the second of two. */
  second(key: string, at: number): boolean {
    const last = this.#last;
    const double = !!last && last.key === key && at - last.at <= DOUBLE_PRESS;
    this.#last = double ? null : { key, at };
    return double;
  }
}

/** How near a grid's edge a drag turns it to the interval before or
    after, px — the days' start or end, the month's foot. */
export const TURN_ZONE = 32;
/** How soon a drag held there turns it again, ms. */
const TURN_REPEAT = 820;

/**
 * A drag at a grid's edge, in time — Notion Calendar's, measured on
 * calendar.notion.com: the interval turns as the pointer comes there (in
 * the frame after), and again each `TURN_REPEAT` while it stays.
 *
 * Never sooner the same way: a hand held at an edge wavers across it by a
 * pixel or two, and each coming back would otherwise be a fresh arrival —
 * a turn at once, a month or a week skipped. Back at the edge it turned
 * at, the next turn waits out the rest of `TURN_REPEAT`; the other edge
 * turns at once (going back is meant).
 */
export class EdgeTurns {
  #side: { direction: -1 | 1; since: number } | null = null;
  /** The last turn: which way, and when. */
  #last: { direction: -1 | 1; at: number } | null = null;

  /** The pointer at an edge (`direction`: -1 the start, 1 the end, 0
      none) at `time`: the turn to make now, if any. */
  at(direction: -1 | 0 | 1, time: number): -1 | 1 | null {
    if (!direction) {
      this.#side = null;
      return null;
    }
    if (this.#side?.direction !== direction) {
      const last = this.#last?.direction === direction ? this.#last.at : -Infinity;
      this.#side = { direction, since: last };
    }
    if (time - this.#side.since < TURN_REPEAT) return null;
    this.#side.since = time;
    this.#last = { direction, at: time };
    return direction;
  }

  /** A new drag: nothing turned yet. */
  reset(): void {
    this.#side = null;
    this.#last = null;
  }
}

/** The room a head keeps under its words (`headOf`): what a card hung
    from it may come up over — the event's body, never its words. */
export const HEAD_ROOM = 8;

/**
 * Where an event's card stands against it: its head — the title and the
 * time, not the whole block — so a long event's card comes up by its name,
 * over the rest of it. Down to the last line of words, the block's own top
 * inset again under them, and `HEAD_ROOM` more; never past the block — a
 * short event, a one-line bar, is its head whole.
 *
 * Across, it starts at the event's colour — the middle of its mark (a
 * block's stripe, a month item's dot; where the words start on a chip
 * without one) — so a card can stand its own colour dot right under it;
 * it ends at the event's end. Anything that is not a chip, its box.
 */
export function headOf(element: Element): AnchorRect {
  const { left, top, width, height, right } = element.getBoundingClientRect();
  const lines = element.querySelectorAll('.event-chip__title, .event-chip__time');
  if (!lines.length) return { left, top, width, height };
  let bottom = top;
  lines.forEach((line) => (bottom = Math.max(bottom, line.getBoundingClientRect().bottom)));
  const style = getComputedStyle(element);
  const inset = parseFloat(style.paddingTop) || 0;
  const mark = markOf(element, left, style);
  return {
    left: mark,
    top,
    width: right - mark,
    height: Math.min(height, bottom - top + inset + HEAD_ROOM),
  };
}

/** The middle of a chip's colour mark, across, in the viewport: its dot,
    its stripe (the `::before` a block draws), or — a bar, the mark of a
    new event — where its words start. */
function markOf(element: Element, left: number, style: CSSStyleDeclaration): number {
  const dot = element.querySelector('.event-chip__dot');
  if (dot) {
    const box = dot.getBoundingClientRect();
    return box.left + box.width / 2;
  }
  const stripe = getComputedStyle(element, '::before');
  if (stripe.content && stripe.content !== 'none' && stripe.position === 'absolute') {
    const from = parseFloat(stripe.left) || 0;
    return left + from + (parseFloat(stripe.width) || 0) / 2;
  }
  return left + (parseFloat(style.paddingLeft) || 0);
}

/** A box from an element, for an anchor. */
export function boxOf(element: Element): AnchorRect {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
}
