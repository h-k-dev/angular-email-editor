import { AnchorRect } from '@h-k-dev/angular-email-editor/anchor';

import { IsoDay } from '../../../../core/calendar/calendar-dates';
import { CalendarEventDraft } from '../../../../core/calendar/calendar-event';

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

/** A box from an element, for an anchor. */
export function boxOf(element: Element): AnchorRect {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
}
