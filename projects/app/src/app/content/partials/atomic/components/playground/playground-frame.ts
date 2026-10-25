import {
  Component,
  ElementRef,
  InjectionToken,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import {
  ToggleButtonGroup,
  ToggleButtonGroupIcon,
  ToggleButtonGroupText,
} from '@h-k-dev/angular-email-editor/toggle-button-group';
import { TranslatePipe } from '@ngx-translate/core';

import { Knob, Playground, PlaygroundAction, describe } from './playground';

/** Where a playground is shown: on its component's page, or alone — and
    the way to the other. Provided by whichever page hosts it. */
export interface PlaygroundPlace {
  readonly alone: boolean;
  /** The other place: `/playground/<entry>` from the page, the page from
      alone. */
  readonly link: string;
}

export const PLAYGROUND_PLACE = new InjectionToken<PlaygroundPlace>('PLAYGROUND_PLACE');

/** Nothing to show as the value: the stage holds no control. */
export const NO_VALUE: unique symbol = Symbol('no value');

/** The stage's light or dark — the app's, or one of its own. */
type StageScheme = 'auto' | 'light' | 'dark';

/** The attributes the state panel shows: the state hooks a component
    reflects — never Angular's own, a class list or a style. */
const STATE_ATTRIBUTE = /^(data-|aria-)|^(role|hidden|disabled|inert|draggable|tabindex|title)$/;

interface SubjectState {
  readonly label: string;
  readonly attributes: readonly { readonly name: string; readonly value: string }[];
}

/**
 * A component on a bench of its own: the stage it stands on — its width
 * dragged at the corner, light or dark whatever the app is — and around it
 * what debugging it needs: its inputs as knobs, what can be done to it,
 * the state it reflects on its elements (`[playgroundSubject]`) and its
 * value, live, and everything it emitted, newest first.
 *
 *     <playground-frame [knobs]="knobs" [actions]="actions" [value]="value()">
 *       <div email-chat-input playgroundSubject="input" …></div>
 *     </playground-frame>
 *
 * The playground provides `Playground` and writes its outputs there; the
 * frame reads it. Narrow (a reference page's column) the panels go under
 * the stage; with the room (alone, `/playground/…`) beside it.
 */
@Component({
  selector: 'playground-frame',
  imports: [
    RouterLink,
    TranslatePipe,
    MatButton,
    MatIcon,
    MatSlideToggle,
    ToggleButtonGroup,
    ToggleButtonGroupIcon,
    ToggleButtonGroupText,
  ],
  templateUrl: './playground-frame.html',
  styleUrl: './playground-frame.scss',
})
export class PlaygroundFrame {
  readonly knobs = input<readonly Knob[]>([]);
  readonly actions = input<readonly PlaygroundAction[]>([]);
  /** The stage's value — a control's, a form field's state. */
  readonly value = input<unknown>(NO_VALUE);

  protected readonly playground = inject(Playground);
  protected readonly place = inject(PLAYGROUND_PLACE, { optional: true });

  protected readonly scheme = signal<StageScheme>('auto');
  protected readonly colorScheme = computed(() =>
    this.scheme() === 'auto' ? null : this.scheme(),
  );

  protected readonly hasValue = computed(() => this.value() !== NO_VALUE);
  protected readonly valueText = computed(() => {
    const value = this.value();
    if (value === NO_VALUE) return '';
    try {
      return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      return describe(value);
    }
  });

  // ── The stage's width, dragged at its corner ──────────────────────────
  protected readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  protected readonly width = signal(0);
  protected readonly resized = signal(false);

  /** Back to the room it has. */
  protected resetWidth(): void {
    this.stage().nativeElement.style.removeProperty('width');
    this.resized.set(false);
  }

  // ── The state panel: each subject's attributes, as they change ─────────
  readonly #states = signal<readonly SubjectState[]>([]);
  protected readonly states = this.#states.asReadonly();

  constructor() {
    effect((onCleanup) => {
      const element = this.stage().nativeElement;
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(([entry]) => {
        this.width.set(Math.round(entry.borderBoxSize[0]?.inlineSize ?? element.offsetWidth));
        // A width written on the element is the user's drag.
        if (element.style.width) this.resized.set(true);
      });
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    });

    effect((onCleanup) => {
      // An empty label watches nothing: one row of a list can be the one.
      const subjects = this.playground.subjects().filter((subject) => subject.label);
      const labels = subjects.map((subject) => subject.label);
      const read = () =>
        this.#states.set(
          subjects.map((subject, index) => ({
            label: labels[index],
            attributes: Array.from(subject.element.attributes)
              .filter((attribute) => STATE_ATTRIBUTE.test(attribute.name))
              .map(({ name, value }) => ({ name, value }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          })),
        );
      read();
      const observer = new MutationObserver(read);
      for (const subject of subjects) observer.observe(subject.element, { attributes: true });
      onCleanup(() => observer.disconnect());
    });
  }

  // ── Knobs ─────────────────────────────────────────────────────────────
  protected setText(knob: Knob, event: Event): void {
    if (knob.kind === 'text') knob.value.set((event.target as HTMLInputElement).value);
  }

  protected setNumber(knob: Knob, event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (knob.kind === 'number' && !Number.isNaN(value)) knob.value.set(value);
  }

  protected setBoolean(knob: Knob, checked: boolean): void {
    if (knob.kind === 'boolean') knob.value.set(checked);
  }

  protected setChoice(knob: Knob, value: string): void {
    if (knob.kind === 'choice') knob.value.set(value);
  }

  protected run(action: PlaygroundAction): void {
    action.run();
  }

  protected clear(): void {
    this.playground.clear();
  }
}
