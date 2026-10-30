/**
 * A calendar view's name as the URL and storage write it — kept apart from
 * `calendar-view.ts` (and Luxon) so the app-wide `Preferences` can read
 * one without pulling the calendar into the first chunk.
 *
 * Google Calendar's fixed views, and its custom one: a run of days (`4d`,
 * 2–7, within a week) or of whole weeks (`3w`, 2–6) — what a drag across
 * the mini month asks for.
 */
export const FIXED_VIEWS = ['day', 'week', 'month', 'year', 'schedule'] as const;

export type FixedView = (typeof FIXED_VIEWS)[number];

/** A run of days or weeks: `4d`, `3w`. */
export type CustomView = `${number}d` | `${number}w`;

export type CalendarView = FixedView | CustomView;

/** The custom views there are: 2–7 days, 2–6 weeks. */
export const CUSTOM_VIEW = /^(?:[2-7]d|[2-6]w)$/;

/** The custom view before one is chosen — Google's: four days. */
export const DEFAULT_CUSTOM_VIEW: CustomView = '4d';

export function isCustomView(value: unknown): value is CustomView {
  return typeof value === 'string' && CUSTOM_VIEW.test(value);
}

export function isCalendarView(value: unknown): value is CalendarView {
  return FIXED_VIEWS.includes(value as FixedView) || isCustomView(value);
}

/**
 * A view's segment in Google Calendar's path, `/r/<segment>/2027/1/26`:
 * the fixed views by name — Schedule is Google's `agenda` — and the custom
 * view as `customday` or `customweek`, its length the remembered one
 * (Google keeps it in its settings, not in the URL).
 */
export type ViewSegment = Exclude<FixedView, 'schedule'> | 'agenda' | 'customday' | 'customweek';

export function viewSegment(view: CalendarView): ViewSegment {
  if (isCustomView(view)) return view.endsWith('d') ? 'customday' : 'customweek';
  return view === 'schedule' ? 'agenda' : view;
}

/** The view a path segment names — a custom one at the remembered length,
    or the default length of its kind where the remembered one is the
    other kind. Null for a segment that is no view. */
export function segmentView(segment: string, custom: CustomView): CalendarView | null {
  if (segment === 'agenda') return 'schedule';
  if (segment === 'customday') return custom.endsWith('d') ? custom : DEFAULT_CUSTOM_VIEW;
  if (segment === 'customweek') return custom.endsWith('w') ? custom : '2w';
  return FIXED_VIEWS.includes(segment as FixedView) && segment !== 'schedule'
    ? (segment as FixedView)
    : null;
}

/** Whether a segment names a view. */
export function isViewSegment(segment: string | undefined): segment is ViewSegment {
  return !!segment && segmentView(segment, DEFAULT_CUSTOM_VIEW) !== null;
}
