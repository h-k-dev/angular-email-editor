import { Component } from '@angular/core';

// Material
import { MatIconModule } from '@angular/material/icon';

/**
 * The ✕ of a DISMISSIBLE chip — the opt-in browser-tab behaviour. Projecting
 * one into an `m-chip` is the whole opt-in:
 *
 * ```html
 * <div chip>
 *   <button chipAction ngTab …>{{ name }}</button>
 *   <button chipDismiss type="button" [attr.aria-label]="…" (click)="remove()"></button>
 * </div>
 * ```
 *
 * It floats ON TOP of the chip's end rather than taking a slot beside the
 * name; the chip (or its `chipAction`) reserves that end in its label box
 * and fades the name out under it, so a name that fits never sits under the
 * ✕ — only a name clipped at the chip's max size does.
 *
 * Shown like a browser tab's close: on the hovered chip and the active one
 * (read off the same ARIA states the chip paints from), and while it holds
 * keyboard focus itself — it stays a real tab stop. Touch has no hover, so
 * there the active chip is the dismissible one.
 *
 * The consumer owns the element (a `<button>`), its accessible name and the
 * click. The glyph defaults to `close`; project content to replace it.
 *
 * Knobs (never declared, read with fallbacks): `--chip-dismiss-size`
 * (1.375rem), `--chip-dismiss-gap` (edge inset, 0.375rem),
 * `--chip-dismiss-fade` (the fade run before the ✕, 0.5rem).
 */
@Component({
  selector: '[chipDismiss]',
  template: '<ng-content><mat-icon aria-hidden="true">close</mat-icon></ng-content>',
  styleUrl: './chip-dismiss.scss',
  imports: [MatIconModule],
  host: { class: 'm-chip-dismiss' },
})
export class ChipDismiss {}
