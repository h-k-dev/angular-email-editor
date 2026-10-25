import { NgComponentOutlet } from '@angular/common';
import { Component, Injector, computed, inject, input, resource } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { PLAYGROUNDS } from '../../partials/atomic/components/playgrounds';
import { PLAYGROUND_PLACE } from '../../partials/atomic/components/playground/playground-frame';
import { PageHeader } from '../../partials/common/page-header/page-header';
import { ENTRY_PAGES } from '../mailbox/components/component-pages';

/**
 * A component's playground alone (`/playground/:entry`): the bench on the
 * whole viewport, with nothing of the app around it — no aside, no other
 * page's listeners — for debugging the component by itself. The panels sit
 * beside the stage here, where there is the room. The way back is its
 * page in the Components reference.
 */
@Component({
  selector: 'app-playground-alone',
  imports: [NgComponentOutlet, RouterLink, TranslatePipe, MatIconButton, MatIcon, PageHeader],
  templateUrl: './playground-alone.html',
  styleUrl: './playground-alone.scss',
})
export class PlaygroundAlone {
  /** The route's `:entry` — always one of `ENTRY_PAGES` (the route checks). */
  readonly entry = input.required<string>();

  protected readonly link = computed(
    () => ENTRY_PAGES.find((page) => page.id === this.entry()) ?? ENTRY_PAGES[0],
  );
  protected readonly back = computed(() => `/components/${this.link().id}`);

  protected readonly playground = resource({
    params: () => this.link().id,
    loader: ({ params }) => PLAYGROUNDS[params](),
  });

  readonly #injector = inject(Injector);
  protected readonly placeInjector = computed(() =>
    Injector.create({
      parent: this.#injector,
      providers: [{ provide: PLAYGROUND_PLACE, useValue: { alone: true, link: this.back() } }],
    }),
  );
}
