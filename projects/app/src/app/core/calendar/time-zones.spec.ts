import { DateTime } from 'luxon';

import { matchZones, zoneChoice, zoneChoices } from './time-zones';

describe('time zones', () => {
  const winter = DateTime.fromISO('2026-01-15T12:00', { zone: 'UTC' });
  const summer = DateTime.fromISO('2026-07-15T12:00', { zone: 'UTC' });

  it('says a zone as Notion does — the offset on the day, then the place', () => {
    expect(zoneChoice('Europe/Berlin', winter)).toMatchObject({
      offset: 'GMT+1',
      place: 'Berlin',
      region: 'Europe',
    });
    expect(zoneChoice('Europe/Berlin', summer).offset).toBe('GMT+2');
    expect(zoneChoice('America/New_York', winter)).toMatchObject({
      offset: 'GMT-5',
      place: 'New York',
    });
    expect(zoneChoice('Asia/Kolkata', winter).offset).toBe('GMT+5:30');
    expect(zoneChoice('Africa/Abidjan', winter).offset).toBe('GMT');
  });

  it('lists every zone west to east', () => {
    const zones = zoneChoices(winter);
    expect(zones.length).toBeGreaterThan(300);
    const minutes = zones.map((zone) => zone.minutes);
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
  });

  it('finds zones by every word typed — place, region or offset', () => {
    const zones = zoneChoices(winter);
    expect(matchZones(zones, 'new york').map((zone) => zone.id)).toEqual(['America/New_York']);
    expect(matchZones(zones, 'europe ber').map((zone) => zone.id)).toEqual(['Europe/Berlin']);
    expect(matchZones(zones, 'gmt+5:30').every((zone) => zone.offset === 'GMT+5:30')).toBe(true);
    expect(matchZones(zones, '')).toHaveLength(zones.length);
  });
});
