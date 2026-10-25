import { Component, computed, inject, input } from '@angular/core';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

import { MenuTrigger } from '@angular/aria/menu';
import { TranslatePipe } from '@ngx-translate/core';

import { ComposeWindows } from '../../../../../core/email/compose-windows';
import { BLANK } from '../../../../../core/email/envelope';
import { EmailTemplate } from '../../../../../core/email/templates';
import { I18n } from '../../../../../core/translations/i18n';
import { EmailThumbnail } from '../../../common/email-thumbnail/email-thumbnail';
import { GridSeen } from '../../../common/virtual-grid/virtual-grid';
import {
  ToolbarMenu,
  ToolbarMenuItem,
} from '../../../shared/email/email-compose/formatting-toolbar/toolbar-menu/toolbar-menu';

/** A template as the gallery shows it, worked out once per language. */
export interface TemplateCardModel {
  readonly kind: 'template';
  readonly id: string;
  readonly template: EmailTemplate;
  /** The set it is from, in words — the card's "channel". */
  readonly set: string;
  /** The set's avatar: its initials, on its hue (`core/randomisation`) —
      the hue the card's wash is drawn in too, one colour family. */
  readonly initials: string;
  readonly hue: number;
  /** Its distinct merge tags, counted. */
  readonly mergeTags: number;
  /** Its dialect, in words — the badge on the thumbnail. */
  readonly dialect: string;
}

type TemplateAction = 'use' | 'copy';

/**
 * A template in the gallery, YouTube's video card: the thumbnail (its top,
 * drawn once the card is looked at — `*gridSeen`), with its dialect over the
 * corner as a video's length is; under it the set's avatar, the name, the
 * set and what it holds; ⋮ at the end. The whole card is the press: a new
 * message written on the template. The wash a press lands on reaches 12px
 * past the card, in its avatar's colour, and grows into place on
 * hover — YouTube's touch feedback shape.
 */
@Component({
  selector: 'article[template-card]',
  imports: [TranslatePipe, MatIconButton, MatIcon, MenuTrigger, ToolbarMenu, EmailThumbnail, GridSeen],
  templateUrl: './template-card.html',
  styleUrl: './template-card.scss',
  host: { '[style.--avatar-hue]': 'card().hue' },
})
export class TemplateCard {
  readonly #windows = inject(ComposeWindows);
  readonly #snackBar = inject(MatSnackBar);
  readonly #i18n = inject(I18n);

  readonly card = input.required<TemplateCardModel>();

  /** "1 merge tag", "8 merge tags", "No merge tags". */
  protected readonly mergeTagsKey = computed(() => {
    const count = this.card().mergeTags;
    return count === 0 ? 'templates.noMergeTags' : count === 1 ? 'templates.mergeTag' : 'templates.mergeTags';
  });

  protected readonly moreItems = computed<ToolbarMenuItem<TemplateAction>[]>(() => [
    { value: 'use', label: this.#i18n.t('templates.use'), icon: 'edit' },
    { value: 'copy', label: this.#i18n.t('templates.copy'), icon: 'content_copy' },
  ]);

  protected act(action: TemplateAction): void {
    if (action === 'use') this.use();
    else void this.copy();
  }

  /** A new message, written on the template: its HTML the body, and the
      original the preview draws beside the editor's reading. */
  protected use(): void {
    const { html } = this.card().template;
    void this.#windows.open({ content: { message: { ...BLANK, html, original: html }, images: [] } });
  }

  protected async copy(): Promise<void> {
    await navigator.clipboard?.writeText(this.card().template.html);
    this.#snackBar.open(this.#i18n.t('templates.copied'), undefined, { duration: 3000 });
  }
}
