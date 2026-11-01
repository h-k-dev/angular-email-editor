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
