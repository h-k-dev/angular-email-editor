import {
  Component,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';

// Aria
import { MenuTrigger } from '@angular/aria/menu';

import { TranslatePipe } from '@ngx-translate/core';

import { I18n } from '../../../../services/i18n';
import {
  ToolbarMenu,
  ToolbarMenuItem,
} from '../../email-compose/formatting-toolbar/toolbar-menu/toolbar-menu';
import { EditorView, MessageSheet } from '../message-sheet';
import { MessageSettings } from '../message-settings/message-settings';

/** A pick in the ⋮: the settings dialog, or a View. */
type MessageMenuValue = 'settings' | EditorView;

/**
 * The bar's ⋮ — the bar's one entry to the message's options, as core's
 * writer has it. First Settings… (core's Preferences…): a menu choice, so
 * the menu closes and the settings dialog opens (`MessageSettings`, held
 * here) — the Theme, the Format and the Layout. Then the View, as two check
 * options: the editor, or its HTML in the editor's place. Offered where
 * the frame has a source pane and the message is HTML
 * (`MessageSheet.viewOffered`); elsewhere the options stand disabled,
 * never hidden — the menu keeps its shape. The button and its menu, on
 * either sheet: it reads and sets the sheet it sits on, whichever that is,
 * through DI.
 */
@Component({
  selector: 'message-menu',
  imports: [
    TranslatePipe,
    MatIcon,
    MatIconButton,
    MatTooltip,
    MenuTrigger,
    ToolbarMenu,
    MessageSettings,
  ],
  templateUrl: './message-menu.html',
  host: { style: 'display: contents' },
})
export class MessageMenu {
  protected readonly sheet = inject(MessageSheet);
  readonly #i18n = inject(I18n);
  readonly #injector = inject(Injector);
  private readonly settings = viewChild.required(MessageSettings);

  /** Which way the menu opens from the bar: away from the sheet's edge —
      up from a bar at the foot, down from one heading the sheet. */
  readonly side = input<'above' | 'below'>('above');

  /** Which end of the button it lines up with: the bar's near end. */
  readonly align = input<'start' | 'end'>('start');

  /** Settings…, then the View's two options, the one in effect ticked. */
  protected readonly items = computed<ToolbarMenuItem<MessageMenuValue>[]>(() => {
    this.#i18n.lang();
    const view = this.sheet.editorView();
    const disabled = !this.sheet.viewOffered();
    return [
      { value: 'settings', label: this.#i18n.t('composer.settings.open'), icon: 'settings' },
      ...(['editor', 'html'] as const).map((value, index) => ({
        value,
        label: this.#i18n.t(`composer.view.${value}`),
        kind: 'radio' as const,
        checked: view === value,
        disabled,
        section: index === 0 ? this.#i18n.t('composer.view.title') : undefined,
      })),
    ];
  });

  protected onSelected(value: MessageMenuValue): void {
    if (value !== 'settings') {
      this.sheet.onEditorView(value);
      return;
    }
    // Once the menu has gone and handed focus back to the ⋮: the dialog
    // takes it from there, and gives it back to the ⋮ when it closes.
    afterNextRender({ write: () => this.settings().open() }, { injector: this.#injector });
  }
}
