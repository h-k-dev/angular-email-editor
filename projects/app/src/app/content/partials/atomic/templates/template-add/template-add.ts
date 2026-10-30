import { Component, Injector, inject, signal } from '@angular/core';

// Angular Signal Forms
import { FormField, FormRoot, form, validate } from '@angular/forms/signals';

// Angular Material
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';

// Angular Email Editor
import {
  ToggleButtonGroup,
  ToggleButtonGroupText,
} from '@h-k-dev/angular-email-editor/toggle-button-group';
import { TranslatePipe } from '@ngx-translate/core';

import { EmailTemplate, Templates } from '../../../../../core/email/templates';

/** A set a new template can join: its key, its name, its dialect. */
export interface TemplateAddSet {
  readonly key: string;
  readonly label: string;
  readonly dialect: EmailTemplate['dialect'];
}

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
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatError,
    MatFormField,
    MatInput,
    MatLabel,
    MatProgressSpinner,
    ToggleButtonGroup,
    ToggleButtonGroupText,
  ],
  templateUrl: './template-add.html',
  styleUrl: './template-add.scss',
})
export class TemplateAdd {
  readonly #ref = inject<MatDialogRef<TemplateAdd, EmailTemplate>>(MatDialogRef);
  readonly #templates = inject(Templates);
  protected readonly data = inject<TemplateAddData>(MAT_DIALOG_DATA);

  readonly #model = signal({ name: '', set: this.data.set });

  /** The name it must have; Create (and Enter) stores what passes. */
  protected readonly addForm = form(
    this.#model,
    (p) => {
      validate(p.name, ({ value }) => (value().trim() ? null : { kind: 'templates.add.nameMissing' }));
    },
    {
      name: 'template-add',
      submission: {
        action: async (field) => {
          const { name, set } = field().value();
          const dialect = this.data.sets.find((entry) => entry.key === set)!.dialect;
          this.#ref.close(await this.#templates.create({ name: name.trim(), set, dialect }));
          return undefined;
        },
        onInvalid: (field) => field().errorSummary()[0]?.fieldTree().focusBoundControl(),
      },
    },
  );

  protected pickSet(set: string): void {
    this.addForm.set().value.set(set);
  }
}

/** Opens the add dialog; the template it created, or undefined on Cancel. */
export async function openTemplateAdd(
  injector: Injector,
  data: TemplateAddData,
): Promise<EmailTemplate | undefined> {
  const ref = injector.get(MatDialog).open<TemplateAdd, TemplateAddData, EmailTemplate>(TemplateAdd, {
    injector,
    data,
    width: '400px',
    maxWidth: 'calc(100vw - 32px)',
  });
  return new Promise((resolve) => ref.afterClosed().subscribe(resolve));
}
