import { NgComponentOutlet } from '@angular/common';
import {
  Component,
  Injector,
  ResourceSnapshot,
  Type,
  computed,
  inject,
  input,
  linkedSignal,
  resource,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { PLAYGROUNDS } from '../../partials/atomic/components/playgrounds';
import { PLAYGROUND_PLACE } from '../../partials/atomic/components/playground/playground-frame';
import { PageHeader } from '../../partials/common/page-header/page-header';
import { ENTRY_PAGES } from '../mailbox/components/component-pages';

/** An entry's playground, as its chunk gives it. */
interface Bench {
  readonly id: string;
  readonly type: Type<unknown>;
}

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

  readonly #playground = resource({
    params: () => this.link().id,
    loader: async ({ params }) => ({ id: params, type: await PLAYGROUNDS[params]() }),
  });

  /** The bench on screen — held while the next entry's chunk is on its way,
      so the section keeps its height instead of collapsing and growing
      back. On the status: a chunk that failed clears it. */
  protected readonly bench = linkedSignal<ResourceSnapshot<Bench | undefined>, Bench | undefined>({
    source: this.#playground.snapshot,
    computation: (snapshot, previous) => {
      if (snapshot.status === 'loading' || snapshot.status === 'reloading') return previous?.value;
      return snapshot.status === 'error' ? undefined : snapshot.value;
    },
  });

  readonly #injector = inject(Injector);
  /** The bench shown's place, so a held bench is not made anew for the
      next entry's. */
  protected readonly placeInjector = computed(() =>
    Injector.create({
      parent: this.#injector,
      providers: [
        {
          provide: PLAYGROUND_PLACE,
          useValue: { alone: true, link: `/components/${this.bench()?.id}` },
        },
      ],
    }),
  );
}
