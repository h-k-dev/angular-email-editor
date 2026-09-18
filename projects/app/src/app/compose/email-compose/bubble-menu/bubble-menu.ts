import { Component, inject, input } from '@angular/core';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';

// CDK
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';

// Library
import { BubbleMenuState } from 'angular-email-editor';
import { ActionTrigger } from 'angular-email-editor/actions';
import { Anchor } from 'angular-email-editor/anchor';
import { KeepFocus } from 'angular-email-editor/focus';

import { I18n } from '../../../../services/i18n';
import { FormattingCommands } from '../formatting-commands';
import { FormattingItem, FormattingLayout, layoutEntries } from '../formatting-items';

/** The bubble menu's groups: the marks, then what wraps the selection. */
const LAYOUT: FormattingLayout = [
  ['bold', 'italic', 'underline', 'strike'],
  ['link', 'quote'],
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
