import { inject } from '@angular/core';
import { Routes, UrlMatcher } from '@angular/router';
import { DateTime } from 'luxon';

import { calendarPath } from '../../../../core/calendar/calendar-view';
import { isViewSegment, segmentView } from '../../../../core/calendar/calendar-view-token';
import { Preferences } from '../../../../core/storages/preferences';

/** A whole number as a path writes it: digits, nothing else. */
const NUMBER = /^\d{1,4}$/;

/**
 * Google Calendar's places: `r/<view>/<year>/<month>/<day>` — `r/day/2027/1/26`
 * — and the year view's `r/year/<year>`. One matcher reads them: a view it
 * knows, numbers that make a real day; the view and the numbers go to the
 * page's inputs as they are (`view`, `y`, `m`, `d`), which builds its date
 * from them directly — nothing to parse.
 */
const calendarPlace: UrlMatcher = (segments) => {
  const [r, view, y, m, d] = segments.map((segment) => segment.path);
  if (r !== 'r' || !isViewSegment(view) || !NUMBER.test(y ?? '')) return null;
  const params = { view: segments[1], y: segments[2] };
  if (view === 'year')
    return segments.length === 3 ? { consumed: segments, posParams: params } : null;
  if (segments.length !== 5 || !NUMBER.test(m) || !NUMBER.test(d)) return null;
  if (!DateTime.local(+y, +m, +d).isValid) return null;
  return { consumed: segments, posParams: { ...params, m: segments[3], d: segments[4] } };
};

/**
 * The calendar's places, under `/calendar`. The calendar alone, or a view
 * alone (`/calendar/r/day`), opens on today — Google's; anything else is
 * nowhere.
 */
export const CALENDAR_ROUTES: Routes = [
  // Today's week, straight from either — a relative hop from the empty
  // path (`redirectTo: 'r'`) left the URL where it was.
  { path: '', pathMatch: 'full', redirectTo: () => calendarPath('week', DateTime.now()) },
  { path: 'r', pathMatch: 'full', redirectTo: () => calendarPath('week', DateTime.now()) },
  {
    path: 'r/:view',
    pathMatch: 'full',
    // A redirect runs in the route's injection context: the custom view's
    // remembered length is at hand.
    redirectTo: ({ params }) =>
      calendarPath(
        segmentView(params['view'], inject(Preferences).calendarCustomView()) ?? 'week',
        DateTime.now(),
      ),
  },
  {
    matcher: calendarPlace,
    loadComponent: () => import('./calendar').then((m) => m.CalendarPage),
  },
];
