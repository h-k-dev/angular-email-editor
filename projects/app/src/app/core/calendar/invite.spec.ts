import { DateTime } from 'luxon';

import { isoMoment } from './calendar-dates';
import { readInvite } from './invite';

/** A calendar part, its lines as a mail carries them. */
const ics = (...lines: string[]) => lines.join('\r\n');

/** A moment written in `zone`, as the local one the calendar keeps. */
const here = (zone: string, hour: number, minute = 0) =>
  isoMoment(
    DateTime.fromObject({ year: 2026, month: 10, day: 28, hour, minute }, { zone }).toLocal(),
  );

/** Google's, shaped as Calendar sends an update: an IANA zone, the Meet
    link in its own property, the organizer among the guests. */
const GOOGLE = ics(
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Berlin:20261028T100000',
  'DTEND;TZID=Europe/Berlin:20261028T103000',
  'UID:4abc@google.com',
  'SEQUENCE:2',
  'SUMMARY:Accounting Modul - Status quo\\, Next Steps',
  'ORGANIZER;CN=Andre Wittwer:mailto:andre@example.com',
  'ATTENDEE;CN=Andre Wittwer;PARTSTAT=ACCEPTED:mailto:andre@example.com',
  'ATTENDEE;CN=Amr Mohamed;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:amr@example.com',
  'ATTENDEE;CN=Hong Knop;PARTSTAT=TENTATIVE;RSVP=TRUE:mailto:hong@example.com',
  'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij',
  'DESCRIPTION:Notes: https://docs.google.com/document/d/1',
  'STATUS:CONFIRMED',
  'END:VEVENT',
  'END:VCALENDAR',
);

describe('readInvite', () => {
  it('reads Google’s invitation: when, what, who, and where to join', () => {
    const invite = readInvite(GOOGLE)!;
    expect(invite.uid).toBe('4abc@google.com');
    expect(invite.sequence).toBe(2);
    expect(invite.method).toBe('REQUEST');
    expect(invite.cancelled).toBe(false);
    expect(invite.title).toBe('Accounting Modul - Status quo, Next Steps');
    expect(invite.start).toBe(here('Europe/Berlin', 10));
    expect(invite.end).toBe(here('Europe/Berlin', 10, 30));
    expect(invite.allDay).toBe(false);
    expect(invite.conference).toBe('https://meet.google.com/abc-defg-hij');
    expect(invite.organizer).toEqual({
      name: 'Andre Wittwer',
      email: 'andre@example.com',
      answer: null,
    });
    expect(invite.attendees.map((guest) => [guest.name, guest.answer])).toEqual([
      ['Andre Wittwer', 'accepted'],
      ['Amr Mohamed', null],
      ['Hong Knop', 'tentative'],
    ]);
  });

  it('reads a zone only the message defines — Outlook’s Windows names', () => {
    const invite = readInvite(
      ics(
        'BEGIN:VCALENDAR',
        'METHOD:REQUEST',
        'BEGIN:VTIMEZONE',
        'TZID:W. Europe Standard Time',
        'BEGIN:STANDARD',
        'DTSTART:16010101T030000',
        'TZOFFSETFROM:+0200',
        'TZOFFSETTO:+0100',
        'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
        'END:STANDARD',
        'BEGIN:DAYLIGHT',
        'DTSTART:16010101T020000',
        'TZOFFSETFROM:+0100',
        'TZOFFSETTO:+0200',
        'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
        'END:DAYLIGHT',
        'END:VTIMEZONE',
        'BEGIN:VEVENT',
        'DTSTART;TZID=W. Europe Standard Time:20261028T100000',
        'DTEND;TZID=W. Europe Standard Time:20261028T110000',
        'UID:outlook-1',
        'SUMMARY:Planning',
        'LOCATION:Microsoft Teams Meeting',
        'DESCRIPTION:Join: https://teams.microsoft.com/l/meetup-join/19%3ameeting',
        'END:VEVENT',
        'END:VCALENDAR',
      ),
    )!;
    // After the last Sunday of October: standard time, +01:00.
    expect(invite.start).toBe(here('UTC+1', 10));
    expect(invite.end).toBe(here('UTC+1', 11));
    expect(invite.conference).toBe('https://teams.microsoft.com/l/meetup-join/19%3ameeting');
  });

  it('knows a cancellation, by the part’s method or the event’s status', () => {
    expect(readInvite(GOOGLE, 'CANCEL')?.cancelled).toBe(true);
    expect(readInvite(GOOGLE.replace('STATUS:CONFIRMED', 'STATUS:CANCELLED'))?.cancelled).toBe(
      true,
    );
  });

  it('reads an all-day event as days', () => {
    const invite = readInvite(
      GOOGLE.replace(
        'DTSTART;TZID=Europe/Berlin:20261028T100000',
        'DTSTART;VALUE=DATE:20261028',
      ).replace('DTEND;TZID=Europe/Berlin:20261028T103000', 'DTEND;VALUE=DATE:20261029'),
    )!;
    expect(invite.allDay).toBe(true);
    expect(invite.start).toBe('2026-10-28T00:00');
    expect(invite.end).toBe('2026-10-29T00:00');
  });

  it('finds none where there is none', () => {
    expect(readInvite('')).toBeNull();
    expect(readInvite('not a calendar')).toBeNull();
    expect(readInvite(ics('BEGIN:VCALENDAR', 'END:VCALENDAR'))).toBeNull();
  });
});
