import { DateTime } from 'luxon';

/**
 * The zones an event can be written in, Notion Calendar's way of saying
 * one: the offset (GMT+1, GMT-4:30, GMT) and the place (Berlin, New York) —
 * every IANA zone the browser knows, its offset taken on the event's day,
 * summer time counted.
 */

/** A zone as the picker shows it. */
export interface TimeZoneChoice {
  /** The IANA name, `America/New_York`. */
  id: string;
  /** Its offset on the day asked about, `GMT-4`. */
  offset: string;
  /** Minutes off UTC that day — what the list is sorted by. */
  minutes: number;
  /** The place, `New York`; the region before it, `America`. */
  place: string;
  region: string;
}

/** The browser's zone. */
export function localZone(): string {
  return DateTime.local().zoneName ?? 'UTC';
}

/** `id` as the picker says it, on the day of `at`. */
export function zoneChoice(id: string, at: DateTime): TimeZoneChoice {
  const there = at.setZone(id);
  const parts = id.split('/');
  return {
    id,
    offset: there.offset ? `GMT${there.toFormat('Z')}` : 'GMT',
    minutes: there.offset,
    place: (parts.at(-1) ?? id).replaceAll('_', ' '),
    region: parts.length > 1 ? parts.slice(0, -1).join('/').replaceAll('_', ' ') : '',
  };
}

/** Every zone the browser knows, west to east, on the day of `at` — the
    browser's own among them, whatever it is called. */
export function zoneChoices(at: DateTime): TimeZoneChoice[] {
  const ids = new Set(Intl.supportedValuesOf('timeZone'));
  ids.add(localZone());
  return [...ids]
    .map((id) => zoneChoice(id, at))
    .filter((zone) => at.setZone(zone.id).isValid)
    .sort((a, b) => a.minutes - b.minutes || a.place.localeCompare(b.place));
}

/** The zones whose place, region, offset or name hold every word typed —
    "new york", "gmt-4", "europe ber". */
export function matchZones(zones: readonly TimeZoneChoice[], query: string): TimeZoneChoice[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...zones];
  return zones.filter((zone) => {
    const text = `${zone.place} ${zone.region} ${zone.offset} ${zone.id}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
