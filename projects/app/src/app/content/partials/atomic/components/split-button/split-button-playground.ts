import { Component, computed, inject, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import {
  SplitButton,
  SplitButtonLeading,
  SplitButtonTrailing,
} from '@h-k-dev/angular-email-editor/split-button';

import { Playground, PlaygroundSubject, knob } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

/**
 * The split button as the composer's attach button has it: a paperclip
 * that splits to let a chevron out once there is something to show. The
 * knobs are the morph, each half's `disabled`, and the opt-in tonal
 * container; beside it the same at Material's 48px, to see it follow the
 * icon button's tokens.
 */
@Component({
  selector: 'split-button-playground',
  imports: [
    PlaygroundFrame,
    PlaygroundSubject,
    SplitButton,
    SplitButtonLeading,
    SplitButtonTrailing,
    MatIcon,
  ],
  templateUrl: './split-button-playground.html',
  styleUrls: ['../playground/playground-stage.scss', './split-button-playground.scss'],
  providers: [Playground],
})
export class SplitButtonPlayground {
  protected readonly playground = inject(Playground);

  readonly split = signal(true);
  readonly leadingDisabled = signal(false);
  readonly trailingDisabled = signal(false);
  readonly container = signal<'none' | 'tonal'>('none');
  /** What the chevron toggles, as the composer's shows the strip. */
  readonly open = signal(true);

  protected readonly tonal = computed(() => this.container() === 'tonal');

  protected readonly knobs = [
    knob.boolean('split', this.split),
    knob.boolean('leading disabled', this.leadingDisabled),
    knob.boolean('trailing disabled', this.trailingDisabled),
    knob.choice('container-color', this.container, ['none', 'tonal']),
  ];

  protected leading(): void {
    this.playground.log('leading · click');
  }

  protected trailing(): void {
    this.open.update((open) => !open);
    this.playground.log('trailing · click', { expanded: this.open() });
  }
}
