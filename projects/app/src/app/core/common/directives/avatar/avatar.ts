import { Directive, computed, inject, input } from '@angular/core';

import { hue } from '../../../randomisation/hue';
import { initials } from '../../../utils/avatar';
import { HueOf } from '../hue-of/hue-of';

/**
 * Any empty element made an avatar: a round badge of a name's initials —
 * no logo, none made up. The inbox's senders wear one, the template
 * gallery's sets do.
 *
 * It writes the initials in itself. Its colour is its container's: inside
 * a `[hueOf]` it takes that hue, so the avatar and what surrounds it (a
 * row's wash, a card's) are one colour family; on its own it sets the
 * name's own hue. The look is _avatar.scss's (global, in styles.scss):
 * round, `--avatar-size` across (40px). Decoration — whatever it stands
 * beside says the name.
 *
 *     <span [avatar]="sender.name"></span>
 *     <li [hueOf]="set.key"> <span [avatar]="set.label"></span> … </li>
 */
@Directive({
  selector: '[avatar]',
  exportAs: 'avatar',
  host: {
    class: 'avatar',
    'aria-hidden': 'true',
    '[style.--avatar-hue]': 'hue()',
    '[textContent]': 'initials()',
  },
})
export class Avatar {
  /** The container whose hue it wears, if it is in one. */
  readonly #container = inject(HueOf, { optional: true });

  /** The name: its initials are the avatar's face. */
  readonly avatar = input.required<string>();

  /** Up to two letters. */
  readonly initials = computed(() => initials(this.avatar()));

  /** Its own hue — none inside a container: it inherits that one. */
  readonly hue = computed(() => (this.#container ? null : hue(this.avatar())));
}
