import { Component, computed, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';

// CDK
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';

// Library
import { BubbleMenuState, selectedImageAlt } from 'angular-email-editor';
import { ActionTrigger } from 'angular-email-editor/actions';
import { Anchor } from 'angular-email-editor/anchor';
import { KeepFocus } from 'angular-email-editor/focus';

import { I18n } from '../../../../services/i18n';
import { FormattingCommands } from '../formatting-commands';
import { FormattingItem, FormattingLayout, layoutEntries } from '../formatting-items';
import { ToolbarKeys } from '../formatting-toolbar/toolbar-keys';

/** The bubble menu's groups: the marks, then what wraps the selection —
    a link, a button link, a quote. */
const LAYOUT: FormattingLayout = [
  ['bold', 'italic', 'underline', 'strike'],
  ['link', 'button-link', 'quote'],
];

/** A selected button: its label's weight and slant (the kit's own toggles,
    which act on the button as a whole), its link (the link editor, on the
    button — which also edits its words), turning it back into text (the
    same toggle, shown on), and where it sits on its line — a call to
    action is usually centred. */
const BUTTON_LAYOUT: FormattingLayout = [
  ['bold', 'italic'],
  ['link', 'button-link'],
  ['align-left', 'align-center', 'align-right'],
];

/** An image alone gets its own tools instead: where it sits on its line
    (the line's alignment — the image is inline), then swapping the file
    and taking it out. The alt text leads, as a text button (see the
    template). */
const IMAGE_LAYOUT: FormattingLayout = [
  ['align-left', 'align-center', 'align-right'],
  ['replace-image', 'remove-image'],
];

/**
 * The bubble menu: the marks you reach for on a selection, floating above
 * it. Opened, closed and placed by the editor's bubble-menu extension —
 * the composer feeds its state in — and acting through the composer's
 * `FormattingCommands`, on the same items as the toolbar.
 *
 * A mousedown never takes focus, so the editor's selection survives the
 * click — which is also what keeps the menu open through it.
 */
@Component({
  selector: 'div[bubble-menu]',
  imports: [
    NgTemplateOutlet,

    // Material
    MatButtonModule,
    MatDividerModule,
    MatIconModule,

    // CDK
    OverlayModule,

    // Library
    ActionTrigger,
    Anchor,
    KeepFocus,

    ToolbarKeys,
  ],
  templateUrl: './bubble-menu.html',
  styleUrl: './bubble-menu.scss',
})
export class BubbleMenu {
  /** The extension's state: whether the menu shows, and the selection's box
      in viewport coordinates, which the anchor takes. */
  readonly state = input.required<BubbleMenuState>();

  readonly #commands = inject(FormattingCommands);

  protected readonly entries = layoutEntries(this.#commands.items, LAYOUT);

  protected readonly imageEntries = layoutEntries(this.#commands.items, IMAGE_LAYOUT);

  protected readonly buttonEntries = layoutEntries(this.#commands.items, BUTTON_LAYOUT);

  protected readonly altItem = this.#commands.items['image-alt'];

  /** The selected image's alt, shown on its button — so a missing one is
      seen, not just editable. */
  protected readonly alt = computed(() => {
    const state = this.#commands.state();
    return state ? selectedImageAlt(state) : null;
  });

  /** The alt button's name when it shows an alt: what the button is, then
      what it says — one translatable phrase, so each language places the
      two (and its own colon). Without an alt, the visible "Add alt text"
      is the name. */
  protected readonly altLabel = computed(() => {
    const alt = this.alt();
    return alt ? this.i18n.t('editor.image.altWithValue', `Alt text: ${alt}`, { alt }) : null;
  });

  protected readonly i18n = inject(I18n);

  protected readonly label = (item: FormattingItem): string => this.#commands.label(item);

  /** The visible editor's actions, which the buttons trigger by id. */
  protected readonly actions = this.#commands.actions;

  protected readonly positions: ConnectedPosition[] = [
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
    // Fallback: no room above, flip below.
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
  ];
}
