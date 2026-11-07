import { Component, Injector, inject, signal } from '@angular/core';

// Angular Signal Forms
import { FormField, FormRoot, form, required, validate } from '@angular/forms/signals';

// Angular Material
import { MatButton } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogClose, MatDialogRef } from '@angular/material/dialog';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';

import { TranslatePipe } from '@ngx-translate/core';

import { EmailTemplate, Templates } from '../../../../../core/email/templates';
import { StickerIcon } from '../../../common/sticker-icon/sticker-icon';

/** A set a new template can join: its key, its name, its dialect (if it
    has one) and its tag. */
export interface TemplateAddSet {
  readonly key: string;
  readonly label: string;
  readonly dialect?: EmailTemplate['dialect'];
  readonly tag: string;
}

/** A dialect's token as a set's row shows it: what its templates' merge
    tags look like. */
const DIALECT_SAMPLES: Record<NonNullable<EmailTemplate['dialect']>, string> = {
  angularjs: '{{ name | uppercase }}',
  handlebars: '{{#if name}}…{{/if}}',
};

/** What the dialog offers: the sets, and the one picked to start with. */
export interface TemplateAddData {
  readonly sets: readonly TemplateAddSet[];
  readonly set: string;
}

/**
 * A new template, by its name and its set (the set's dialect is what its
 * tokens are written in): stored as Create is pressed, and handed back —
 * nothing on Cancel. The gallery's +, as core's add dialog.
 */
@Component({
  selector: 'template-add',
  imports: [
    TranslatePipe,
    FormField,
    FormRoot,
    MatButton,
    MatDialogClose,
    MatFormField,
    MatInput,
    MatLabel,
    MatProgressSpinner,
    MatRadioButton,
    MatRadioGroup,
    StickerIcon,
  ],
  templateUrl: './template-add.html',
  styleUrl: './template-add.scss',
})
export class TemplateAdd {
  readonly #ref = inject<MatDialogRef<TemplateAdd, EmailTemplate>>(MatDialogRef);
  readonly #templates = inject(Templates);
  protected readonly data = inject<TemplateAddData>(MAT_DIALOG_DATA);

  /** The dialog's id (`openTemplateAdd`), which names its parts. */
  readonly #id = this.#ref.id;
  protected readonly titleId = `${this.#id}-title`;
  protected readonly setLabelId = `${this.#id}-set`;

  readonly #model = signal({ name: '', set: this.data.set });

  /** The name it must have — required (the field's asterisk), and more
      than spaces; Create (and Enter) stores what passes. */
  protected readonly addForm = form(
    this.#model,
    (p) => {
      required(p.name);
      validate(p.name, ({ value }) => (value().trim() ? null : { kind: 'blank' }));
    },
    {
      name: 'template-add',
      submission: {
        action: async (field) => {
          const { name, set } = field().value();
          const { dialect, tag } = this.data.sets.find((entry) => entry.key === set)!;
          this.#ref.close(await this.#templates.create({ name: name.trim(), set, dialect, tag }));
          return undefined;
        },
        onInvalid: (field) => field().errorSummary()[0]?.fieldTree().focusBoundControl(),
      },
    },
  );

  /** A set's token sample — none for a set without a dialect. */
  protected sampleOf(set: TemplateAddSet): string | null {
    return set.dialect ? DIALECT_SAMPLES[set.dialect] : null;
  }
}

let nextAddId = 0;

/** Opens the add dialog; the template it created, or undefined on Cancel. */
export async function openTemplateAdd(
  injector: Injector,
  data: TemplateAddData,
): Promise<EmailTemplate | undefined> {
  const id = `template-add-${nextAddId++}`;
  const ref = injector
    .get(MatDialog)
    .open<TemplateAdd, TemplateAddData, EmailTemplate>(TemplateAdd, {
      id,
      ariaLabelledBy: `${id}-title`,
      injector,
      data,
      // Material 3's dialog: 560px at most; the screen less 16px a side.
      width: '480px',
      maxWidth: 'calc(100vw - 32px)',
    });
  return new Promise((resolve) => ref.afterClosed().subscribe(resolve));
}
