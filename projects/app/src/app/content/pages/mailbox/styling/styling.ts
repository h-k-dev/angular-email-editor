import { Component, signal } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { RouterLink } from '@angular/router';
import { AddressInput, addressList } from '@h-k-dev/angular-email-editor/address-input';
import { AddressFormField } from '@h-k-dev/angular-email-editor/material';

import { DocSection } from '../../../partials/common/doc-page/doc';
import { DocPage } from '../../../partials/common/doc-page/doc-page';
import { DocProse } from '../../../partials/common/doc-page/doc-prose';
import {
  HOOK_GROUPS,
  MATERIAL_RECIPE,
  OVERRIDE_EXAMPLE,
  TOKEN_SECTIONS,
} from './styling.content';

/**
 * The styling page: how theming resolves, every custom property grouped by
 * the part of the UI it paints, the Material form-field recipe, and the
 * class hooks underneath. The editor's DOM is created by ProseMirror at
 * runtime — outside Angular's view encapsulation — so the surface is
 * styled globally, scoped to `.aee-editor` and never to bare
 * `.ProseMirror`. The content is `styling.content.ts`.
 */
@Component({
  selector: 'app-styling',
  imports: [
    RouterLink,
    DocPage,
    DocProse,
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
  /** The Material recipe, live: an address input as a form field's control. */
  protected readonly recipient = signal({ to: [] as string[] });
  protected readonly recipientForm = form(this.recipient, (p) => addressList(p.to));

  protected readonly example = OVERRIDE_EXAMPLE;
  protected readonly materialRecipe = MATERIAL_RECIPE;
  protected readonly sections = TOKEN_SECTIONS;
  protected readonly hookGroups = HOOK_GROUPS;

  protected readonly toc: readonly DocSection[] = [
    {
      id: 'theming',
      title: 'How theming works',
      topics: [{ id: 'where-styles-live', title: 'Where the styles live' }],
    },
    ...TOKEN_SECTIONS.map((section) => ({
      id: section.id,
      title: section.title,
      // A section of one group lists no topics: its heading would repeat.
      topics:
        section.groups.length > 1
          ? section.groups.map((group) => ({ id: group.id, title: group.title }))
          : undefined,
    })),
    { id: 'material-form-field', title: 'Material form field' },
    {
      id: 'class-hooks',
      title: 'Class hooks',
      topics: HOOK_GROUPS.map((group) => ({ id: group.id, title: group.title })),
    },
  ];
}
