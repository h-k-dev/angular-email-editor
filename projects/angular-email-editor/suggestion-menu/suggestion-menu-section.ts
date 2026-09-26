import { Component } from '@angular/core';

/**
 * A heading in a suggestion menu's list: the words of a section
 * (`SuggestionItem.section`, worded by the state's `sectionTitle`), shown
 * where the section changes from one row to the next. Never an option: it
 * takes no highlight, no click, and no place in the count — presentation,
 * the way a chat's slash menu heads its groups.
 *
 *     @for (item of state.items; track item.id) {
 *       @if (item.section && item.section !== state.items[$index - 1]?.section) {
 *         <div email-suggestion-menu-section>{{ state.sectionTitle(item.section) }}</div>
 *       }
 *       <div email-suggestion-menu-item [item]="item">…</div>
 *     }
 */
@Component({
  selector: '[email-suggestion-menu-section]',
  template: '<ng-content />',
  styleUrl: './suggestion-menu-section.scss',
  host: { role: 'presentation' },
})
export class SuggestionMenuSection {}
