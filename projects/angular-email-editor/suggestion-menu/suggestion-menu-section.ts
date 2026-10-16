import { Component } from '@angular/core';

/**
 * A heading in a suggestion menu's list: the words of a section
 * (`SuggestionItem.section`), shown where the section changes from one row
 * to the next — the state says where, and in which words, as each item's
 * `heading`. Never an option: it takes no highlight, no click, and no place
 * in the count — presentation, the way a chat's slash menu heads its groups.
 *
 *     @for (item of state.items; track item.id) {
 *       @if (item.heading; as heading) {
 *         <div email-suggestion-menu-section>{{ heading }}</div>
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
