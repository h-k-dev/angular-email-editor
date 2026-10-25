import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import {
  ToggleButtonGroup,
  ToggleButtonGroupIcon,
  ToggleButtonGroupText,
} from '@h-k-dev/angular-email-editor/toggle-button-group';

import { Playground, PlaygroundAction, PlaygroundSubject, knob } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

type Theme = 'light' | 'dark' | 'auto';

/**
 * The toggle group as the settings dialog has it — round icon items and a
 * pill of text side by side, the thumb morphing between them — and a
 * group of text pills of different widths. The knobs are the group's
 * state and the size tokens the demo's menus set.
 */
@Component({
  selector: 'toggle-button-group-playground',
  imports: [
    PlaygroundFrame,
    PlaygroundSubject,
    ToggleButtonGroup,
    ToggleButtonGroupIcon,
    ToggleButtonGroupText,
    MatIcon,
  ],
  templateUrl: './toggle-button-group-playground.html',
  styleUrl: '../playground/playground-stage.scss',
  providers: [Playground],
})
export class ToggleButtonGroupPlayground {
  protected readonly playground = inject(Playground);

  readonly theme = signal<Theme>('auto');
  readonly format = signal('html');
  readonly orientation = signal<'horizontal' | 'vertical'>('horizontal');
  readonly disabled = signal(false);
  readonly readonly = signal(false);
  readonly darkDisabled = signal(false);
  readonly size = signal(36);
  readonly inset = signal(4);

  protected readonly group = viewChild.required<ToggleButtonGroup<Theme>>('themes');

  protected readonly knobs = [
    knob.choice('orientation', this.orientation, ['horizontal', 'vertical']),
    knob.boolean('disabled', this.disabled),
    knob.boolean('readonly', this.readonly),
    knob.boolean('dark item aria-disabled', this.darkDisabled),
    knob.number('--hk-tgb-size (px)', this.size, { min: 20, max: 56, step: 2 }),
    knob.number('--hk-tgb-inset (px)', this.inset, { min: 0, max: 12 }),
  ];

  protected readonly actions: readonly PlaygroundAction[] = [
    { name: 'focus()', run: () => this.group().focus() },
    { name: "select('dark')", run: () => this.group().select('dark') },
  ];

  protected readonly value = computed(() => ({ theme: this.theme(), format: this.format() }));
}
