import { Provider, inject } from '@angular/core';
import { MAT_DIALOG_DEFAULT_OPTIONS, MatDialogConfig } from '@angular/material/dialog';

import { Viewport } from './viewport';

/** The overlay's own backdrop, Material's dim — what a dialog shows without
    a blur. */
const STOCK_BACKDROP = 'cdk-overlay-dark-backdrop';

/** What `provideDialogDefaults` takes. */
export interface DialogDefaults {
  /** The page behind every dialog blurred (`.dialog-backdrop-blur`,
      styles.scss) over the stock dim. On by default; off, or without a
      GPU (`Viewport.gpu`), the stock backdrop alone. */
  readonly blur?: boolean;
}

/**
 * Every dialog's defaults, for the app config: the backdrop — the stock
 * dim with a small blur over it where the GPU paints it, the stock dim
 * alone where it would not (no hardware WebGL) or where `blur` is off.
 * Material's own defaults otherwise: these replace them whole, so they
 * start from a `MatDialogConfig`.
 */
export function provideDialogDefaults({ blur = true }: DialogDefaults = {}): Provider {
  return {
    provide: MAT_DIALOG_DEFAULT_OPTIONS,
    useFactory: (): MatDialogConfig => ({
      ...new MatDialogConfig(),
      backdropClass:
        blur && inject(Viewport).gpu() ? [STOCK_BACKDROP, 'dialog-backdrop-blur'] : STOCK_BACKDROP,
    }),
  };
}

/** The frame part of a dialog's config, spread into `MatDialog.open`. */
export type DialogFrame = Pick<
  MatDialogConfig,
  'panelClass' | 'maxWidth' | 'maxHeight' | 'enterAnimationDuration' | 'exitAnimationDuration'
>;

/**
 * A large dialog — the settings' frame, Notion's: one fixed size centred
 * over the page, the whole screen at the compact width (`.dialog-large`,
 * styles.scss) — there at once, gone at once: a frame this big growing out
 * of the middle is motion for nothing. `classes` are the dialog's own pane
 * classes beside it, an identity for its styles or a spec.
 */
export function largeDialog(...classes: string[]): DialogFrame {
  return {
    panelClass: ['dialog-large', ...classes],
    // The frame's own size, never Material's 80vw cap.
    maxWidth: 'none',
    enterAnimationDuration: 0,
    exitAnimationDuration: 0,
  };
}

/**
 * A dialog over the whole screen at every width (`.dialog-fullscreen`,
 * styles.scss) — there at once: a whole screen growing out of the middle,
 * or shrinking back into it, is motion for nothing.
 */
export function fullscreenDialog(...classes: string[]): DialogFrame {
  return {
    panelClass: ['dialog-fullscreen', ...classes],
    maxWidth: 'none',
    maxHeight: 'none',
    enterAnimationDuration: 0,
    exitAnimationDuration: 0,
  };
}
