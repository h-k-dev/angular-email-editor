import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  Injector,
  input,
  linkedSignal,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import type { FormValueControl } from '@angular/forms/signals';
import { DateTime } from 'luxon';

import { IsoDay, isoDay, parseDay } from '../../../../core/calendar/calendar-dates';
import { CalendarFormat } from '../../../../core/calendar/calendar-format';
import { MiniMonth } from '../mini-month/mini-month';
import { QuietField } from '../quiet-field/quiet-field';

/** Under the field, lined up with its start — over it where there is no
    room below (`motion-above`: it rises out of the field). */
const POSITIONS: ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
  {
    originX: 'start',
    originY: 'top',
    overlayX: 'start',
    overlayY: 'bottom',
    offsetY: -4,
    panelClass: 'motion-above',
  },
];

/**
 * A day, picked on the app's own calendar: a quiet field showing the day
 * ("Fri, Oct 30, 2026"), which opens the mini month under it — the one
 * the calendar's side shows, so a date picked in a form looks like every
 * other in the app. The browser's own date picker cannot be styled; this
 * one is ours.
 *
 *     <date-field [formField]="form.startDay" fieldLabel="Starts" />
 *     <date-field [(value)]="day" />
 *
 * A signal-forms control (`FormValueControl`): the value is a day,
 * `yyyy-MM-dd` (empty for none), and `[formField]` drives it both ways,
 * pushes `invalid` (the field says so, `aria-invalid`) and hears `touch`
 * when the picker closes; `focus()` puts the caret on the field, as a form
 * sends you to its first error.
 *
 * The picker: a press on the field opens it, the keyboard on the picked
 * day (the mini month's arrows, Page Up / Down, Enter); a day picked, an
 * Escape or a press outside closes it, focus back on the field.
 */
@Component({
  selector: 'date-field',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, MiniMonth, QuietField],
  template: `
    <button
      #trigger
      type="button"
      quietField
      class="date-field__trigger"
      cdkOverlayOrigin
      #origin="cdkOverlayOrigin"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="fieldLabel() ? fieldLabel() + ': ' + label() : null"
      [attr.aria-invalid]="invalid() || null"
      (click)="toggle()"
    >
      {{ label() }}
    </button>

    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="origin"
      [cdkConnectedOverlayOpen]="open()"
      [cdkConnectedOverlayPositions]="positions"
      [cdkConnectedOverlayPush]="true"
      [cdkConnectedOverlayViewportMargin]="8"
      (attach)="attached()"
      (overlayOutsideClick)="outside($event)"
      (overlayKeydown)="key($event)"
      (detach)="close(false)"
    >
      <div
        #panel
        class="date-field__panel"
        role="dialog"
        [attr.aria-label]="fieldLabel() || label()"
        animate.enter="motion-enter"
        animate.leave="motion-leave"
      >
        <mini-month
          [(month)]="shown"
          [selected]="selected()"
          [today]="today"
          (pick)="choose($event)"
        />
      </div>
    </ng-template>
  `,
  styles: `
    :host {
      display: inline-flex;
      min-inline-size: 0;
    }

    .date-field__trigger {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    // The mini month on a card of its own, a surface above whatever it
    // opens from (often a card itself).
    .date-field__panel {
      inline-size: 248px;
      padding: 8px 12px 12px;
      box-sizing: border-box;
      border-radius: var(--mat-sys-corner-large);
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-on-surface);
      box-shadow: var(--mat-sys-level3);
    }
  `,
})
export class DateField implements FormValueControl<string> {
  readonly #formats = inject(CalendarFormat).formats;
  readonly #injector = inject(Injector);

  /** The day, `yyyy-MM-dd` — empty for none. */
  readonly value = model<string>('');
  /** Whether the form says the day is wrong (an end before its start). */
  readonly invalid = input(false);
  /** What the field is, for assistive tech ("Starts"): said before the day. (Not `name`: signal forms sets
      that on its control.) */
  readonly fieldLabel = input<string>('');
  /** The picker closed: the field was visited. */
  readonly touch = output<void>();

  protected readonly positions = POSITIONS;
  protected readonly open = signal(false);
  protected readonly today: IsoDay = isoDay(DateTime.now());

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  readonly #day = computed(() => parseDay(this.value()));

  /** "Fri, Oct 30, 2026" — or nothing yet. */
  protected readonly label = computed(() => {
    const day = this.#day();
    if (!day) return '';
    return day.toLocaleString(
      { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' },
      { locale: this.#formats().language },
    );
  });

  protected readonly selected = computed(() => (this.#day() ? [this.value()] : []));

  /** The month the picker shows: the day's, until its arrows move it. */
  protected readonly shown = linkedSignal(() => (this.#day() ? this.value() : this.today));

  /** Puts the caret on the field — where a form sends you to its error. */
  focus(): void {
    this.trigger().nativeElement.focus();
  }

  protected toggle(): void {
    if (this.open()) this.close(true);
    else this.open.set(true);
  }

  /** Opened: the keyboard on the picked day (the mini month's one tab stop). */
  protected attached(): void {
    afterNextRender(
      () => this.panel()?.nativeElement.querySelector<HTMLElement>('[tabindex="0"]')?.focus(),
      { injector: this.#injector },
    );
  }

  protected choose(day: IsoDay): void {
    this.value.set(day);
    this.close(true);
  }

  /** A press outside the picker closes it — but not the press on the field
      itself: the click that opened it arrives here too (the field is
      outside the picker), and the field's own click toggles. */
  protected outside(event: MouseEvent): void {
    if (this.trigger().nativeElement.contains(event.target as Node | null)) return;
    this.close(false);
  }

  protected key(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.close(true);
  }

  /** Closed — focus back on the field when it was in the picker (a pick, an
      Escape); a press outside leaves it where it went. */
  protected close(refocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    this.touch.emit();
    if (refocus) this.focus();
  }
}
