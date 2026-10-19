import { Component, computed, inject, input } from '@angular/core';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

// Aria
import { MenuTrigger } from '@angular/aria/menu';

import { TranslatePipe } from '@ngx-translate/core';

import { I18n } from '../../../../services/i18n';
import {
  ToolbarMenu,
  ToolbarMenuItem,
} from '../../email-compose/formatting-toolbar/toolbar-menu/toolbar-menu';
import { EditorView, MessageSheet } from '../message-sheet';

/**
 * The bar's ⋮ — the View, as two check options: the editor, or its HTML
 * in the editor's place. Offered where the frame has a source pane and the
 * message is HTML (`MessageSheet.viewOffered`); elsewhere the options stand
 * disabled, never hidden — the menu keeps its shape. The button and its
 * menu, on either sheet: it reads and sets the sheet it sits on, whichever
 * that is, through DI. The rest of the message's settings are the ⚙'s
 * (`MessageSettings`).
 */
@Component({
  selector: 'message-menu',
  imports: [TranslatePipe, MatIcon, MatIconButton, MenuTrigger, ToolbarMenu],
  templateUrl: './message-menu.html',
  host: { style: 'display: contents' },
})
export class MessageMenu {
  protected readonly sheet = inject(MessageSheet);
  readonly #i18n = inject(I18n);

  /** Which way the menu opens from the bar: away from the sheet's edge —
      up from a bar at the foot, down from one heading the sheet. */
  readonly side = input<'above' | 'below'>('above');

  /** Which end of the button it lines up with: the bar's near end. */
  readonly align = input<'start' | 'end'>('start');

  /** The View's two options, the one in effect ticked. */
  protected readonly items = computed<ToolbarMenuItem<EditorView>[]>(() => {
    this.#i18n.lang();
    const view = this.sheet.editorView();
    const disabled = !this.sheet.viewOffered();
    return (['editor', 'html'] as const).map((value, index) => ({
      value,
      label: this.#i18n.t(`composer.view.${value}`),
      kind: 'radio' as const,
      checked: view === value,
      disabled,
      section: index === 0 ? this.#i18n.t('composer.view.title') : undefined,
    }));
  });
}
