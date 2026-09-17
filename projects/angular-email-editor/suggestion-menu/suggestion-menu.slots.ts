import { Directive, TemplateRef, inject } from '@angular/core';
import { SuggestionGroup } from 'angular-email-editor';

/**
 * A suggestion menu's header slot, shown on level 2 above the group's
 * children. The default is a back button and the group's title; a host
 * that wants its own — a Material icon button, the group's icon, a
 * breadcrumb — hands the menu a template:
 *
 *     <div email-suggestion-menu [state]="state()">
 *       <ng-template emailSuggestionMenuHeader let-group let-back="back" let-label="backLabel">
 *         <button mat-icon-button tabindex="-1" [attr.aria-label]="label" (click)="back()">
 *           <mat-icon>arrow_back</mat-icon>
 *         </button>
 *         {{ group.title }}
 *       </ng-template>
 *       …
 *     </div>
 *
 * The template renders inside the menu's own `header` box.
 */

/** What the header template is given. */
export interface SuggestionMenuHeaderContext {
  /** The group whose children are listed — its title already translated. */
  readonly $implicit: SuggestionGroup;
  /** Back to level 1 with an empty query. */
  readonly back: () => void;
  /** The back control's accessible name, as the menu was given it. */
  readonly backLabel: string;
}

/** Marks the `ng-template` the menu renders as its level-2 header. */
@Directive({ selector: 'ng-template[emailSuggestionMenuHeader]' })
export class SuggestionMenuHeader {
  readonly template = inject<TemplateRef<SuggestionMenuHeaderContext>>(TemplateRef);

  static ngTemplateContextGuard(
    _directive: SuggestionMenuHeader,
    context: unknown,
  ): context is SuggestionMenuHeaderContext {
    return true;
  }
}
