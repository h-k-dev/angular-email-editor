import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
} from '@angular/core';

// Angular CDK
import { CdkConnectedOverlay } from '@angular/cdk/overlay';

// Library
import { KeepFocus } from '@h-k-dev/angular-email-editor/focus';
import { injectSwatches } from '@h-k-dev/angular-email-editor/palette';
import { TranslatePipe } from '@ngx-translate/core';

import { ColorPalette } from '../color-palette/color-palette';

let nextId = 0;

/**
 * The colour button's pane: the text palette and the background one side by
 * side, each under its name — Gmail's one colour button. When the viewport is
 * too narrow for both, the background palette wraps under the text one.
 *
 * The swatches are the palette in use — the library's unless the app
 * provides its own (`providePalette`).
 * Shows the colours in effect (`color`, `background`) and reports a pick
 * from either; the host applies it and closes the pane. A mousedown never
 * takes focus, so the editor's selection survives the click.
 *
 * In a connected overlay (the toolbar's, the bubble menu's) the pane places
 * itself again as it grows — a custom row opened as the picker — so it
 * keeps clear of the viewport's edge, flipping side where it must.
 */
@Component({
  selector: 'div[color-picker]',
  imports: [TranslatePipe, ColorPalette],
  templateUrl: './color-picker.html',
  styleUrl: './color-picker.scss',
  hostDirectives: [KeepFocus],
  host: { role: 'group' },
})
export class ColorPicker {
  /** The text colour at the selection, or null for automatic. */
  readonly color = input<string | null>(null);
  /** The background at the selection, or null for none. */
  readonly background = input<string | null>(null);

  /** A text colour was picked, or null for automatic. */
  readonly colorPicked = output<string | null>();
  /** A background was picked, or null for none. */
  readonly backgroundPicked = output<string | null>();

  /** The palette in use (`EMAIL_PALETTE`: the library's, or the app's own)
      and the user's custom swatches after it — live, a colour picked shows
      at once. */
  readonly #swatches = injectSwatches();
  protected readonly textPalette = computed(() => this.#swatches().text);
  protected readonly backgroundPalette = computed(() => this.#swatches().background);

  protected readonly id = `color-picker-${nextId++}`;

  constructor() {
    const overlay = inject(CdkConnectedOverlay, { optional: true });
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    if (!overlay || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => overlay.overlayRef?.updatePosition());
    afterNextRender(() => observer.observe(host));
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }
}
