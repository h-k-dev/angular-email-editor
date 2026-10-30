import { DateTime } from 'luxon';

import { CalendarEvent } from './calendar-event';
import { laneCount, placeInDay, placeInLanes } from './calendar-layout';
import { dayRange } from './calendar-dates';

let next = 0;
const event = (start: string, end: string, allDay = false): CalendarEvent => ({
  id: `e${next++}`,
  title: '',
  start,
  end,
  allDay,
  color: 'peacock',
  location: '',
  description: '',
});

describe('calendar layout', () => {
  describe('a day’s hours', () => {
    it('places a timed event by its minutes', () => {
      const [one] = placeInDay([event('2026-10-29T09:30', '2026-10-29T11:00')], '2026-10-29');
      expect(one).toEqual(expect.objectContaining({ top: 570, length: 90, column: 0, columns: 1 }));
    });

    it('shares the width between events that overlap, as few columns as needed', () => {
      const placed = placeInDay(
        [
          event('2026-10-29T09:00', '2026-10-29T11:00'),
          event('2026-10-29T09:30', '2026-10-29T10:00'),
          event('2026-10-29T10:00', '2026-10-29T10:30'),
          event('2026-10-29T13:00', '2026-10-29T14:00'),
        ],
        '2026-10-29',
      );
      expect(placed.map(({ column, columns }) => [column, columns])).toEqual([
        [0, 2],
        [1, 2],
        // Free again by 10:00: back in the second column.
        [1, 2],
        // Overlaps nothing: the whole width.
        [0, 1],
      ]);
    });

    it('counts a short event as long as it shows', () => {
      const placed = placeInDay(
        [
          event('2026-10-29T09:00', '2026-10-29T09:05'),
          event('2026-10-29T09:10', '2026-10-29T09:30'),
        ],
        '2026-10-29',
      );
      expect(placed[0].length).toBe(20);
      expect(placed.map(({ columns }) => columns)).toEqual([2, 2]);
    });

    it('leaves the band’s events to the band', () => {
      expect(
        placeInDay(
          [
            event('2026-10-29T00:00', '2026-10-30T00:00', true),
            event('2026-10-29T22:00', '2026-10-30T02:00'),
          ],
          '2026-10-29',
        ),
      ).toEqual([]);
      // Ending at midnight is ending the day it started.
      expect(
        placeInDay([event('2026-10-29T22:00', '2026-10-30T00:00')], '2026-10-29')[0].length,
      ).toBe(120);
    });
  });

  describe('a mark across days', () => {
    it('shows in each day it covers, cut at the midnights', () => {
      const mark = event('2026-10-27T15:00', '2026-10-29T10:30');
      const spanning = { spanning: true };
      expect(placeInDay([mark], '2026-10-27', spanning)[0]).toEqual(
        expect.objectContaining({ top: 900, length: 540, cutStart: false, cutEnd: true }),
      );
      expect(placeInDay([mark], '2026-10-28', spanning)[0]).toEqual(
        expect.objectContaining({ top: 0, length: 1440, cutStart: true, cutEnd: true }),
      );
      expect(placeInDay([mark], '2026-10-29', spanning)[0]).toEqual(
        expect.objectContaining({ top: 0, length: 630, cutStart: true, cutEnd: false }),
      );
      // Not asked to, it leaves it to the band; an all-day one always.
      expect(placeInDay([mark], '2026-10-28')).toEqual([]);
      expect(
        placeInDay([event('2026-10-28T00:00', '2026-10-29T00:00', true)], '2026-10-28', spanning),
      ).toEqual([]);
    });
  });

  describe('a run of days', () => {
    const week = dayRange(DateTime.local(2026, 10, 25), 7);

    it('lays bars on the first lane where they fit', () => {
      const placed = placeInLanes(
        [
          event('2026-10-26T00:00', '2026-10-29T00:00', true),
          event('2026-10-27T00:00', '2026-10-28T00:00', true),
          event('2026-10-29T00:00', '2026-10-30T00:00', true),
        ],
        week,
      );
      expect(placed.map(({ from, span, lane }) => [from, span, lane])).toEqual([
        [1, 3, 0],
        [2, 1, 1],
        [4, 1, 0],
      ]);
      expect(laneCount(placed)).toBe(2);
    });

    it('closes the gaps of a run without its weekends', () => {
      const weekdays = ['2026-10-23', '2026-10-26', '2026-10-27'];
      const [one] = placeInLanes([event('2026-10-23T00:00', '2026-10-27T00:00', true)], weekdays);
      expect(one).toEqual(
        expect.objectContaining({ from: 0, span: 2, before: false, after: false }),
      );
      expect(placeInLanes([event('2026-10-24T00:00', '2026-10-26T00:00', true)], weekdays)).toEqual(
        [],
      );
    });

    it('cuts a bar at the run’s ends and says it goes on', () => {
      const [one] = placeInLanes([event('2026-10-20T00:00', '2026-11-03T00:00', true)], week);
      expect(one).toEqual(expect.objectContaining({ from: 0, span: 7, before: true, after: true }));
    });

    it('puts a month’s timed events on their day, after its bars', () => {
      const timed = event('2026-10-29T09:00', '2026-10-29T10:00');
      const allDay = event('2026-10-29T00:00', '2026-10-30T00:00', true);
      expect(placeInLanes([timed, allDay], week)).toEqual([
        expect.objectContaining({ event: allDay }),
      ]);
      const placed = placeInLanes([timed, allDay], week, 'all');
      expect(placed.map(({ event, lane }) => [event.id, lane])).toEqual([
        [allDay.id, 0],
        [timed.id, 1],
      ]);
    });
  });
});
