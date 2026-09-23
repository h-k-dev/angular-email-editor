import { Component, inject, signal, viewChild } from '@angular/core';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

// CDK
import { CdkConnectedOverlay, ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';

// Library
import { Anchor, AnchorRect } from 'angular-email-editor/anchor';
import { ImageAlt } from 'angular-email-editor/image';

import { I18n } from '../../../../services/i18n';
import { FormattingCommands } from '../formatting-commands';
import { dismissOnPressOutside } from '../../dismiss-outside';

/**
 * The alt-text popover: one field over the selected image, opened by the
 * image bubble menu's alt button through `FormattingCommands`. The field is
 * the library's `[emailImageAlt]` — it fills itself, applies on Enter,
 * cancels on Escape and hands the caret back; this component only places
 * the popover and closes it. A press outside leaves the alt as it was.
 */
@Component({
  selector: 'div[alt-text-editor]',
  imports: [
    // Material
    MatButtonModule,
    MatIconModule,

    // CDK
    OverlayModule,

    // Library
    Anchor,
    ImageAlt,
  ],
  templateUrl: './alt-text-editor.html',
  styleUrl: './alt-text-editor.scss',
})
export class AltTextEditor {
  readonly #commands = inject(FormattingCommands);

  protected readonly i18n = inject(I18n);

  protected readonly editor = this.#commands.editor;
  protected readonly open = signal(false);
  protected readonly anchor = signal<AnchorRect | null>(null);

  protected readonly positions: ConnectedPosition[] = [
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
    // Fallback: no room above, flip below.
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
  ];

  // A query cannot be an ES-private field: TypeScript's `private` it is.
  private readonly overlay = viewChild(CdkConnectedOverlay);

  constructor() {
    // A press outside closes it — never the click (on the bubble's alt
    // button) that opened it.
    dismissOnPressOutside(
      this.open,
      () => this.overlay()?.overlayRef?.overlayElement,
      () => this.dismiss(),
    );
  }

  /** Opens the popover over the image's box — the bubble menu's, which
      already stands over the image it was opened for; a no-op without
      one. */
  show(rect: AnchorRect | null): void {
    if (!rect) return;
    this.anchor.set(rect);
    this.open.set(true);
  }

  protected close(): void {
    this.open.set(false);
    this.editor()?.focus();
  }

  /** A press outside closes it too — and is just a press: nothing covers
      the page, so it lands where it was aimed and no other menu (the
      image's bubble) opens in the popover's place. */
  protected dismiss(): void {
    this.open.set(false);
  }

  /** Escape closes from anywhere in the popover — the Apply button too, not
      only the field (whose own Escape the directive has already taken). */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    event.preventDefault();
    this.close();
  }
}
