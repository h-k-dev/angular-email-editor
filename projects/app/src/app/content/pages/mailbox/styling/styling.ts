import { Component, computed, input, signal } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { RouterLink } from '@angular/router';
import { AddressInput, addressList } from '@h-k-dev/angular-email-editor/address-input';
import { AddressFormField } from '@h-k-dev/angular-email-editor/material';

import { DocCode } from '../../../partials/common/doc-code/doc-code';
import { DocSection } from '../../../partials/common/doc-page/doc';
import { DocPage } from '../../../partials/common/doc-page/doc-page';
import { DocProse } from '../../../partials/common/doc-page/doc-prose';
import { STYLING_PAGES } from './styling-pages';
import { HOOK_GROUPS, MATERIAL_RECIPE, OVERRIDE_EXAMPLE, TOKEN_SECTIONS } from './styling.content';

/**
 * A page of the styling reference (`/styling/:page`): how theming
 * resolves, the custom properties of one part of the UI, the Material
 * form-field recipe, or the class hooks underneath. The editor's DOM is
 * created by ProseMirror at runtime — outside Angular's view encapsulation
 * — so the surface is styled globally, scoped to `.aee-editor` and never
 * to bare `.ProseMirror`. The aside lists the pages (`STYLING_PAGES`); the
 * content is `styling.content.ts`.
 */
@Component({
  selector: 'app-styling',
  imports: [
    RouterLink,
    DocPage,
    DocProse,
    DocCode,
    AddressInput,
    AddressFormField,
    FormField,
    MatFormField,
    MatLabel,
    MatHint,
    MatError,
  ],
  templateUrl: './styling.html',
  styleUrl: './styling.scss',
})
export class Styling {
  /** The route's `:page` — always one of `STYLING_PAGES` (the route checks). */
  readonly page = input.required<string>();

  protected readonly link = computed(
    () => STYLING_PAGES.find((page) => page.id === this.page()) ?? STYLING_PAGES[0],
  );
  protected readonly trail = computed(() => ['app.nav.styling', this.link().key]);

  /** The page's tokens, when it is a page of tokens. */
  protected readonly tokens = computed(
    () => TOKEN_SECTIONS.find((section) => section.id === this.link().id) ?? null,
  );

  protected readonly toc = computed<readonly DocSection[]>(() => {
    const tokens = this.tokens();
    if (tokens) {
      // One group is the page itself: nothing to jump between.
      return tokens.groups.length > 1
        ? tokens.groups.map((group) => ({ id: group.id, title: group.title }))
        : [];
    }
    switch (this.link().id) {
      case 'theming':
        return [
          { id: 'how-it-resolves', title: 'How a token resolves' },
          { id: 'where-styles-live', title: 'Where the styles live' },
        ];
      case 'class-hooks':
        return HOOK_GROUPS.map((group) => ({ id: group.id, title: group.title }));
      default:
        return [];
    }
  });

  /** The Material recipe, live: an address input as a form field's control. */
  protected readonly recipient = signal({ to: [] as string[] });
  protected readonly recipientForm = form(this.recipient, (p) => addressList(p.to));

  protected readonly example = OVERRIDE_EXAMPLE;
  protected readonly materialRecipe = MATERIAL_RECIPE;
  protected readonly hookGroups = HOOK_GROUPS;
}
