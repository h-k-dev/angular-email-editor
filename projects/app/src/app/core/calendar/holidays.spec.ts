import { TestBed } from '@angular/core/testing';

import { HOLIDAY_SOURCE, NagerHolidays, holidayEvents } from './holidays';

/** Two rows as Nager.Date answers them: one nationwide, one regional. */
const ROWS = [
  {
    date: '2026-10-03',
    localName: 'Tag der Deutschen Einheit',
    name: 'German Unity Day',
    countryCode: 'DE',
    global: true,
    counties: null,
    types: ['Public'],
  },
  {
    date: '2026-10-31',
    localName: 'Reformationstag',
    name: 'Reformation Day',
    countryCode: 'DE',
    global: false,
    counties: ['DE-BB'],
    types: ['Public'],
  },
];

describe('holidays', () => {
  let fetch: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify(ROWS)));
  });

  afterEach(() => fetch.mockRestore());

  it('connects to Nager.Date by default', () => {
    expect(TestBed.inject(HOLIDAY_SOURCE)).toBe(TestBed.inject(NagerHolidays));
  });

  it('asks Nager.Date for a country-year once — nationwide and regional holidays', async () => {
    const source = TestBed.inject(NagerHolidays);
    const holidays = await source.holidays(2026, 'de');
    expect(fetch).toHaveBeenCalledWith('https://date.nager.at/api/v3/PublicHolidays/2026/DE');
    expect(holidays).toEqual([
      {
        date: '2026-10-03',
        name: 'German Unity Day',
        localName: 'Tag der Deutschen Einheit',
        regions: null,
      },
      {
        date: '2026-10-31',
        name: 'Reformation Day',
        localName: 'Reformationstag',
        regions: ['DE-BB'],
      },
    ]);
    await source.holidays(2026, 'DE');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('asks again after a failure — a failed year is not kept', async () => {
    fetch.mockImplementationOnce(async () => new Response('', { status: 503 }));
    const source = TestBed.inject(NagerHolidays);
    await expect(source.holidays(2027, 'DE')).rejects.toThrow('503');
    expect((await source.holidays(2027, 'DE')).length).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shows holidays as read-only all-day events, named in the calendar’s language', () => {
    const [unity, reformation] = holidayEvents(
      [
        {
          date: '2026-10-03',
          name: 'German Unity Day',
          localName: 'Tag der Deutschen Einheit',
          regions: null,
        },
        {
          date: '2026-10-31',
          name: 'Reformation Day',
          localName: 'Reformationstag',
          regions: ['DE-BB', 'DE-HB'],
        },
      ],
      'de',
      'DE',
      (regions) => `Regional: ${regions}`,
    );
    // A regional one says where, by the regions' short codes.
    expect(reformation.description).toBe('Regional: BB, HB');
    expect(unity.description).toBe('');
    expect(unity).toEqual(
      expect.objectContaining({
        title: 'Tag der Deutschen Einheit',
        start: '2026-10-03T00:00',
        end: '2026-10-04T00:00',
        allDay: true,
        readonly: true,
      }),
    );
    expect(
      holidayEvents(
        [{ date: '2026-10-03', name: 'German Unity Day', localName: 'x', regions: null }],
        'en',
        'DE',
      )[0].title,
    ).toBe('German Unity Day');
    // Another country's, in a language not its own: English, never its words.
    const culture = {
      date: '2026-11-03',
      name: 'Culture Day',
      localName: '文化の日',
      regions: null,
    };
    expect(holidayEvents([culture], 'de', 'JP')[0].title).toBe('Culture Day');
    expect(holidayEvents([culture], 'ja', 'JP')[0].title).toBe('文化の日');
  });
});
