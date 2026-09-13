import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

// CDK
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';

// Library
import { linkRangeAt } from 'angular-email-editor';

import { FormattingCommands } from '../formatting-commands';

/**
 * The link popover: a URL field with apply, open and unlink, anchored at
 * the selection in the visible editor. Opened by the composer's link
 * items (toolbar, bubble menu, ⋯ menu) through `FormattingCommands`.
 *
 * The input needs real focus, so no mousedown suppression here — the
 * editor blurs while editing and is refocused on close. In code view the
 * source pane has no link mark to read back: there it is insert-only, on a
 * selection.
 */
@Component({
  selector: 'div[link-editor]',
  imports: [
    // Material
    MatButtonModule,
    MatIconModule,

    // CDK
    OverlayModule,
  ],
  templateUrl: './link-editor.html',
  styleUrl: './link-editor.scss',
})
export class LinkEditor {
  readonly #commands = inject(FormattingCommands);

  protected readonly input = viewChild<ElementRef<HTMLInputElement>>('input');
  protected readonly open = signal(false);
  protected readonly href = signal('');
  /** Whether the caret stood in a link when the editor opened: then it can
      be opened in a tab and removed. */
  protected readonly existing = signal(false);
  protected readonly anchor = signal<{ left: number; top: number; height: number } | null>(null);

  protected readonly positions: ConnectedPosition[] = [
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
    // Fallback: no room above, flip below.
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
  ];

  /** Opens the popover at the selection: prefilled when the caret sits in
      an existing link, a no-op when there is neither selection nor link. */
  show(): void {
    const editor = this.#commands.target();
    if (!editor) return;

    const { from, empty } = editor.state.selection;
    const range = this.#commands.codeView() ? undefined : linkRangeAt(editor.state, from);
    if (empty && !range) {
      editor.focus();
      return;
    }

    this.href.set(range?.attrs.href ?? '');
    this.existing.set(!!range);
    const coords = editor.view.coordsAtPos(from);
    this.anchor.set({ left: coords.left, top: coords.top, height: coords.bottom - coords.top });
    this.open.set(true);
    setTimeout(() => this.input()?.nativeElement.select());
  }

  protected close(): void {
    this.open.set(false);
    this.#commands.focus();
  }

  /** Applies the entered URL; a scheme-less value gets https:// prepended,
      an emptied value unlinks — matching what the field visibly says. */
  protected apply(): void {
    const editor = this.#commands.target();
    const raw = this.href().trim();
    this.open.set(false);
    if (!editor) return;

    if (raw) {
      const href = /^[a-z][\w+.-]*:/i.test(raw) ? raw : `https://${raw}`;
      editor.commands['setLink']({ href });
    } else {
      editor.commands['unsetLink']();
    }
    editor.focus();
  }

  protected remove(): void {
    this.open.set(false);
    const editor = this.#commands.target();
    editor?.commands['unsetLink']();
    editor?.focus();
  }

  protected visit(): void {
    const href = this.href();
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
  }
}
