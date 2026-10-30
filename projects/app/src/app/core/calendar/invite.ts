import ICAL from 'ical.js';
import { DateTime } from 'luxon';

import { IsoMoment, isoMoment } from './calendar-dates';
import { InviteAnswer } from './calendar-event';

/** Someone an invitation names: the organizer, or a guest with their
    answer so far. */
export interface InvitePerson {
  readonly name: string;
  readonly email: string;
  /** What they said — none while they have not (`NEEDS-ACTION`). */
  readonly answer: InviteAnswer | null;
}

/**
 * An invitation, as the message carries it: its `text/calendar` part
 * (iCalendar, RFC 5545), sent by mail (iMIP, RFC 6047) with an iTIP method
 * (RFC 5546) — `REQUEST` to invite or update, `CANCEL` to call it off.
 * Everything Gmail's card above a message shows, but what your own calendar
 * says beside it.
 */
export interface Invite {
  /** One event across every message about it: an update has the same. */
  readonly uid: string;
  /** How often the organizer changed it: an update counts up. */
  readonly sequence: number;
  readonly method: string;
  /** Called off: the method, or the event's own `STATUS`. */
  readonly cancelled: boolean;
  readonly title: string;
  /** Local moments, in this browser's zone — the calendar's floating ones. */
  readonly start: IsoMoment;
  readonly end: IsoMoment;
  readonly allDay: boolean;
  readonly recurring: boolean;
  readonly location: string;
  readonly description: string;
  /** Where to join: Meet, Teams, Zoom — none where it is in person. */
  readonly conference: string | null;
  readonly organizer: InvitePerson | null;
  readonly attendees: readonly InvitePerson[];
}

/** iCalendar's `PARTSTAT` as an answer. */
const ANSWERS: Readonly<Record<string, InviteAnswer>> = {
  ACCEPTED: 'accepted',
  TENTATIVE: 'tentative',
  DECLINED: 'declined',
};

/** A meeting link in free text: the services invitations come from. */
const CONFERENCE =
  /https:\/\/(?:meet\.google\.com\/[\w-]+|teams\.microsoft\.com\/l\/meetup-join\/\S+|[\w.-]*zoom\.us\/j\/\S+)/;

/** A time as it was written — in its own zone, the message's (`TZID`, an
    IANA name or one its `VTIMEZONE` defines), UTC, or floating — as the
    local moment it is here. */
function local(time: ICAL.Time, tzid: string | null): DateTime {
  const { year, month, day, hour, minute, second } = time;
  if (time.isDate) return DateTime.fromObject({ year, month, day });
  const parts = { year, month, day, hour, minute, second };
  if (time.zone === ICAL.Timezone.utcTimezone) {
    return DateTime.fromObject(parts, { zone: 'utc' }).toLocal();
  }
  if (tzid) {
    const named = DateTime.fromObject(parts, { zone: tzid });
    return named.isValid ? named.toLocal() : DateTime.fromJSDate(time.toJSDate());
  }
  return DateTime.fromObject(parts);
}

/** A person property — `ORGANIZER`, `ATTENDEE` — as a person. */
function person(property: ICAL.Property): InvitePerson {
  const email = String(property.getFirstValue() ?? '').replace(/^mailto:/i, '');
  const name = String(property.getParameter('cn') ?? '');
  const answer = ANSWERS[String(property.getParameter('partstat') ?? '').toUpperCase()] ?? null;
  return { name: name || email, email, answer };
}

/**
 * The invitation in a message's `text/calendar` part — its first event —
 * or null where there is none to read. `method` is the part's own (the
 * parser has it from `Content-Type`), the calendar's `METHOD` otherwise.
 */
export function readInvite(ics: string, method?: string): Invite | null {
  try {
    const root = new ICAL.Component(ICAL.parse(ics));
    // The message's own zones, for a TZID that names none of IANA's
    // (Outlook's "W. Europe Standard Time").
    for (const zone of root.getAllSubcomponents('vtimezone')) {
      const tzid = String(zone.getFirstPropertyValue('tzid') ?? '');
      if (tzid && !ICAL.TimezoneService.has(tzid)) ICAL.TimezoneService.register(zone);
    }
    const vevent = root.getFirstSubcomponent('vevent');
    if (!vevent) return null;
    const event = new ICAL.Event(vevent);
    const tzid = (name: string) =>
      (vevent.getFirstProperty(name)?.getParameter('tzid') as string | undefined) ?? null;
    const start = local(event.startDate, tzid('dtstart'));
    const end = event.endDate ? local(event.endDate, tzid('dtend') ?? tzid('dtstart')) : start;
    const verb = (
      method ?? String(root.getFirstPropertyValue('method') ?? 'PUBLISH')
    ).toUpperCase();
    const status = String(vevent.getFirstPropertyValue('status') ?? '').toUpperCase();
    const location = event.location ?? '';
    const description = event.description ?? '';
    const organizer = vevent.getFirstProperty('organizer');
    return {
      uid: event.uid,
      sequence: event.sequence ?? 0,
      method: verb,
      cancelled: verb === 'CANCEL' || status === 'CANCELLED',
      title: event.summary ?? '',
      start: isoMoment(start),
      end: isoMoment(end),
      allDay: event.startDate.isDate,
      recurring: event.isRecurring(),
      location,
      description,
      conference:
        String(vevent.getFirstPropertyValue('x-google-conference') ?? '') ||
        CONFERENCE.exec(`${location}\n${description}`)?.[0] ||
        null,
      organizer: organizer ? person(organizer) : null,
      attendees: vevent.getAllProperties('attendee').map(person),
    };
  } catch {
    return null;
  }
}
