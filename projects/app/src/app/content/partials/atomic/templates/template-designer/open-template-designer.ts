import { Injector } from '@angular/core';

// Angular Material
import { MatDialog, MatDialogRef } from '@angular/material/dialog';

import { fullscreenDialog } from '../../../../../core/layout/dialogs';
import type { EmailTemplate } from '../../../../../core/email/templates';
import type { TemplateDesigner } from './template-designer';

/** What the designer opens on. */
export interface TemplateDesignerData {
  readonly template: EmailTemplate;
}

/**
 * Opens `template` in the designer: a dialog over the whole screen. The
 * designer — its editor, its phone, everything it imports — is a chunk of
 * its own, fetched on the first opening; the gallery pays nothing for it
 * until a card is pressed. Focus goes back where it was as it closes.
 */
export async function openTemplateDesigner(
  injector: Injector,
  template: EmailTemplate,
): Promise<MatDialogRef<TemplateDesigner>> {
  const { TemplateDesigner } = await import('./template-designer');
  return injector.get(MatDialog).open<TemplateDesigner, TemplateDesignerData>(TemplateDesigner, {
    injector,
    data: { template },
    ariaLabel: template.name,
    ...fullscreenDialog(),
    // The back button is the designer's own (its `BackButton` guard): the
    // dialog must not also close on the popstate, nor on the one its guard
    // makes taking its entry back out as it closes.
    closeOnNavigation: false,
    // The caret starts in the text: the dialog focuses the editor's pane
    // once it is open, and the pane hands the caret on in.
    autoFocus: 'section[email-compose]',
  });
}
