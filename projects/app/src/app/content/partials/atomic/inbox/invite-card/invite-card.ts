import { Component, computed, effect, inject, input, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

// Angular Material
import { MatIcon } from '@angular/material/icon';

// Angular Email Editor
import {
  ToggleButtonGroup,
  ToggleButtonGroupText,
} from '@h-k-dev/angular-email-editor/toggle-button-group';
import { TranslatePipe } from '@ngx-translate/core';

import {
  EVENT_COLOR_VALUES,
  InviteAnswer,
  eventSpan,
} from '../../../../../core/calendar/calendar-event';
import { CalendarEvents } from '../../../../../core/calendar/calendar-events';
import { CalendarFormat } from '../../../../../core/calendar/calendar-format';
import { calendarPath } from '../../../../../core/calendar/calendar-view';
import { Invite } from '../../../../../core/calendar/invite';
import { I18n } from '../../../../../core/translations/i18n';

/** What your calendar holds beside the invitation, the card's side
    column: what it clashes with, else what comes just before or after it
    that day — the event, its time and its colour, under what it is to
    this one. */
interface Beside {
  readonly kind: 'conflict' | 'previous' | 'next';
  readonly key: string;
  readonly title: string;
  readonly time: string;
  readonly color: string;
}

/** The answers, in Gmail's order, and the words on their buttons. */
const ANSWERS: readonly { readonly answer: InviteAnswer; readonly key: string }[] = [
  { answer: 'accepted', key: 'inbox.invite.yes' },
  { answer: 'declined', key: 'inbox.invite.no' },
  { answer: 'tentative', key: 'inbox.invite.maybe' },
];

/**
 * An invitation's card above the message, Gmail's: when, what, who — the
 * organizer and the guests — where to join, and Yes / No / Maybe; beside
 * it what your own calendar holds then. All of it but that is the
 * message's (`Invite`, its `text/calendar` part); the answer and the
 * neighbours are the calendar's (`CalendarEvents`), kept in this browser.
 *
 * Shown, it brings an event you answered before up to this message — a
 * newer version moves it, a cancellation takes it off — as Gmail does when
 * an update comes in.
 */
@Component({
  selector: 'app-invite-card',
  imports: [TranslatePipe, MatIcon, RouterLink, ToggleButtonGroup, ToggleButtonGroupText],
  templateUrl: './invite-card.html',
  styleUrl: './invite-card.scss',
})
export class InviteCard {
  readonly #calendar = inject(CalendarEvents);
  readonly #formats = inject(CalendarFormat).formats;
  readonly #i18n = inject(I18n);

  /** The invitation the message carries. */
  readonly invite = input.required<Invite>();

  protected readonly answers = ANSWERS;

  /** "Wednesday, October 28 · 10:00 – 10:30 AM". */
  protected readonly when = computed(() => this.#formats().when(this.invite()));

  /** What you said to it so far — none before you have. */
  protected readonly response = computed(
    () => this.#calendar.byUid().get(this.invite().uid)?.response ?? null,
  );

  /** The organizer has changed it since it was first sent. */
  protected readonly updated = computed(() => this.invite().sequence > 0);

  /** The guests but the organizer, as a sentence: "Amr, Valentin and Oliver". */
  protected readonly guests = computed(() => {
    const { organizer, attendees } = this.invite();
    const names = attendees
      .filter((guest) => guest.email !== organizer?.email)
      .map((guest) => guest.name);
    return new Intl.ListFormat(this.#i18n.lang(), { type: 'conjunction' }).format(names);
  });

  /** Its day in the calendar. */
  protected readonly dayLink = computed(() => {
    const { start } = eventSpan(this.invite());
    return calendarPath('day', start);
  });

  /** What your calendar holds beside it, that day — none where it is free. */
  protected readonly beside = computed<Beside | null>(() => {
    const invite = this.invite();
    const formats = this.#formats();
    const { start, end } = eventSpan(invite);
    const sameDay = this.#calendar
      .events()
      .filter((event) => event.uid !== invite.uid && !event.allDay)
      .map((event) => ({ event, ...eventSpan(event) }))
      .filter((one) => one.start.hasSame(start, 'day'));
    const say = (kind: Beside['kind'], one: (typeof sameDay)[number]): Beside => ({
      kind,
      key: `inbox.invite.${kind}`,
      title: one.event.title,
      time: formats.timeRange(one.start, one.end),
      color: EVENT_COLOR_VALUES[one.event.color],
    });
    const conflict = sameDay.find((one) => one.start < end && one.end > start);
    if (conflict) return say('conflict', conflict);
    const previous = sameDay
      .filter((one) => one.end <= start)
      .sort((a, b) => b.end.toMillis() - a.end.toMillis())[0];
    if (previous) return say('previous', previous);
    const next = sameDay
      .filter((one) => one.start >= end)
      .sort((a, b) => a.start.toMillis() - b.start.toMillis())[0];
    return next ? say('next', next) : null;
  });

  constructor() {
    // An event answered before, brought up to this message.
    effect(() => {
      const invite = this.invite();
      untracked(() => this.#calendar.follow(invite));
    });
  }

  /** Yes, No or Maybe picked: into the calendar, or off it. */
  protected answer(answer: InviteAnswer | null): void {
    if (answer) this.#calendar.answer(this.invite(), answer);
  }
}
