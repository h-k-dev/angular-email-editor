import { CanMatchFn, Routes } from '@angular/router';
import { DateTime } from 'luxon';

import { parseDay } from '../../../../core/calendar/calendar-dates';
import { calendarPath, isCalendarView } from '../../../../core/calendar/calendar-view';

/** Matches `:view/:date` only for a view the calendar has, on a real day. */
const calendarPlace: CanMatchFn = (_route, segments) =>
  isCalendarView(segments[0]?.path) && !!parseDay(segments[1]?.path);

/**
 * The calendar's places, under `/calendar`: a view and a day, both bound
 * to the page's inputs. The calendar alone, or a view alone, opens on
 * today; a view it does not have, or no real day, is nowhere.
 */
export const CALENDAR_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: () => calendarPath('week', DateTime.now()) },
  {
    path: ':view',
    pathMatch: 'full',
    redirectTo: ({ params }) =>
      calendarPath(isCalendarView(params['view']) ? params['view'] : 'week', DateTime.now()),
  },
  {
    path: ':view/:date',
    canMatch: [calendarPlace],
    loadComponent: () => import('./calendar').then((m) => m.CalendarPage),
  },
];
