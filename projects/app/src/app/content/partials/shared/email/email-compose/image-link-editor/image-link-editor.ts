import { Component, TemplateRef, inject, signal, viewChild } from '@angular/core';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

// Library
import { AnchorRect } from '@h-k-dev/angular-email-editor/anchor';
import { ImageSource } from '@h-k-dev/angular-email-editor/image';
import { TranslatePipe } from '@ngx-translate/core';

import { FormattingCommands } from '../formatting-commands';
import { dismissOnPressOutside } from '../../dismiss-outside';
import { POPOVER_ABOVE, Popover } from '../popover/popover';

/**
 * The image-link popover: one field over the selected image — a public
 * picture's address — opened by the image bubble menu's Image link button
 * through `FormattingCommands`. It fills a placeholder (the frame a picture
 * dropped with Inline images off stands in as) or swaps a picture for the
 * one at the address. The field is the library's `[emailImageSource]`: it
 * fills itself, applies on Enter, cancels on Escape, hands the caret back
 * and stays open on an address the rules refuse; this component only opens
 * the panel and closes it — the alt-text popover's twin.
 */
@Component({
  selector: 'div[image-link-editor]',
  imports: [
    TranslatePipe,
    // Material
    MatButtonModule,
    MatIconModule,

    // Library
    ImageSource,
  ],
  templateUrl: './image-link-editor.html',
  styleUrl: './image-link-editor.scss',
})
export class ImageLinkEditor {
  readonly #commands = inject(FormattingCommands);

  readonly #popover = inject(Popover);

  protected readonly editor = this.#commands.editor;
  protected readonly open = signal(false);
  protected readonly anchor = signal<AnchorRect | null>(null);

  // A query cannot be an ES-private field: TypeScript's `private` it is.
  private readonly panel = viewChild<TemplateRef<unknown>>('panel');

  constructor() {
    this.#popover.register({
      layer: 'dialog',
      open: this.open,
      anchor: this.anchor,
      content: this.panel,
      positions: () => POPOVER_ABOVE,
      onKeydown: (event) => this.onKeydown(event),
      close: () => this.close(),
    });
    dismissOnPressOutside(
      this.open,
      () => this.#popover.pane(),
      () => this.open.set(false),
    );
  }

  /** Opens the popover over the image's box — the bubble menu's; a no-op
      without one. */
  show(rect: AnchorRect | null): void {
    if (!rect) return;
    this.anchor.set(rect);
    this.open.set(true);
  }

  protected close(): void {
    this.open.set(false);
    this.editor()?.focus();
  }

  /** Escape closes from anywhere in the popover — the Apply button too. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    event.preventDefault();
    this.close();
  }
}
