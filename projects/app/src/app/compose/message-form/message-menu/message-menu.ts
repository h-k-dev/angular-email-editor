import { Component, inject, input } from '@angular/core';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

// Aria
import { MenuTrigger } from '@angular/aria/menu';

// Angular Email Editor
import {
  ToggleButtonGroup,
  ToggleButtonGroupIcon,
  ToggleButtonGroupText,
} from '@h-k-dev/angular-email-editor/toggle-button-group';
import { TranslatePipe } from '@ngx-translate/core';

import {
  ToolbarMenu,
  ToolbarMenuRow,
} from '../../email-compose/formatting-toolbar/toolbar-menu/toolbar-menu';
import { MessageSheet } from '../message-sheet';

/** Tells the menus on one page apart: each row's label needs an id of its
    own for its toggle. */
let nextMenuId = 0;

/**
 * The bar's ⋮ — more options for the message: the Format, the View (where
 * the frame has a source pane, `MessageSheet.viewOffered`) and the
 * editor's Appearance. The button and its menu, on either sheet: it reads
 * and sets the sheet it sits on, whichever that is, through DI.
 */
@Component({
  selector: 'message-menu',
  imports: [
    TranslatePipe,
    MatIcon,
    MatIconButton,
    MenuTrigger,
    ToolbarMenu,
    ToolbarMenuRow,
    ToggleButtonGroup,
    ToggleButtonGroupIcon,
    ToggleButtonGroupText,
  ],
  templateUrl: './message-menu.html',
  styleUrl: './message-menu.scss',
  host: { style: 'display: contents' },
})
export class MessageMenu {
  protected readonly sheet = inject(MessageSheet);

  /** Which way the menu opens from the bar: away from the sheet's edge —
      up from a bar at the foot, down from one heading the sheet. */
  readonly side = input<'above' | 'below'>('above');

  /** Which end of the button it lines up with: the bar's near end. */
  readonly align = input<'start' | 'end'>('start');

  protected readonly formatLabelId = `message-format-${nextMenuId}`;
  protected readonly viewLabelId = `message-view-${nextMenuId}`;
  protected readonly themeLabelId = `message-theme-${nextMenuId++}`;
}
