import { DateTime } from 'luxon';

import { calendarPage, calendarPath, rangeView, stepped } from './calendar-view';
import { segmentView, viewSegment } from './calendar-view-token';

const thursday = DateTime.local(2026, 10, 29);

describe('calendar views', () => {
  it('writes Google Calendar’s paths: numbers without padding, the year alone', () => {
    expect(calendarPath('day', DateTime.local(2027, 1, 26))).toBe('/calendar/r/day/2027/1/26');
    expect(calendarPath('year', thursday)).toBe('/calendar/r/year/2026');
    expect(calendarPath('schedule', thursday)).toBe('/calendar/r/agenda/2026/10/29');
    expect(calendarPath('3w', thursday)).toBe('/calendar/r/customweek/2026/10/29');
    expect(calendarPath('4d', '2026-10-05')).toBe('/calendar/r/customday/2026/10/5');
  });

  it('reads a custom segment at the remembered length, of its own kind', () => {
    expect(segmentView('customday', '5d')).toBe('5d');
    expect(segmentView('customday', '3w')).toBe('4d');
    expect(segmentView('customweek', '3w')).toBe('3w');
    expect(segmentView('agenda', '4d')).toBe('schedule');
    expect(segmentView('schedule', '4d')).toBeNull();
    expect(viewSegment('week')).toBe('week');
  });

  it('turns a mini-month drag into Google’s view: a day, days in a week, or whole weeks', () => {
    const view = (a: string, b: string) => {
      const { view, date } = rangeView(a, b, 7);
      return `${view} ${date.toISODate()}`;
    };
    expect(view('2026-10-29', '2026-10-29')).toBe('day 2026-10-29');
    expect(view('2026-10-29', '2026-10-27')).toBe('3d 2026-10-27');
    expect(view('2026-10-25', '2026-10-31')).toBe('week 2026-10-25');
    // Across rows: whole weeks, from the first one's start.
    expect(view('2026-10-14', '2026-10-29')).toBe('3w 2026-10-11');
    expect(view('2026-09-01', '2026-12-31')).toBe('6w 2026-08-30');
  });

  it('steps a custom view by its own length', () => {
    expect(stepped('4d', thursday, 1).toISODate()).toBe('2026-11-02');
    expect(stepped('3w', thursday, -1).toISODate()).toBe('2026-10-08');
    expect(stepped('month', thursday, 1).toISODate()).toBe('2026-11-29');
    expect(stepped('year', thursday, -1).toISODate()).toBe('2025-10-29');
  });

  it('lays each view out', () => {
    expect(calendarPage('4d', thursday, 7).days).toEqual([
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
    const weeks = calendarPage('3w', thursday, 7);
    expect(weeks.layout).toBe('weeks');
    expect(weeks.weeks.map((week) => week[0])).toEqual(['2026-10-25', '2026-11-01', '2026-11-08']);
    expect(weeks.month).toBeNull();
    expect(calendarPage('year', thursday, 7).months.length).toBe(12);
    expect(calendarPage('schedule', thursday, 7).days.length).toBe(28);
  });

  it('leaves the weekends out when asked — but never a day view’s one day', () => {
    expect(calendarPage('week', thursday, 1, { weekends: false }).days).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
    ]);
    expect(calendarPage('month', thursday, 1, { weekends: false }).weeks[0].length).toBe(5);
    expect(calendarPage('day', DateTime.local(2026, 10, 31), 1, { weekends: false }).days).toEqual([
      '2026-10-31',
    ]);
  });
});
