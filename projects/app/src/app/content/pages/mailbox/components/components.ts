import { NgComponentOutlet } from '@angular/common';
import { Component, Injector, computed, inject, input, resource } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PLAYGROUNDS } from '../../../partials/atomic/components/playgrounds';
import { PLAYGROUND_PLACE } from '../../../partials/atomic/components/playground/playground-frame';
import { DocCode } from '../../../partials/common/doc-code/doc-code';
import { DocSection } from '../../../partials/common/doc-page/doc';
import { DocPage } from '../../../partials/common/doc-page/doc-page';
import { DocProse } from '../../../partials/common/doc-page/doc-prose';
import { COMPONENT_PAGES, ENTRY_PAGES } from './component-pages';
import { COMPONENT_CONTENT } from './components.content';

const LIB = '@h-k-dev/angular-email-editor';

/** The page's sections, the same on every component's page. */
const TOC: readonly DocSection[] = [
  { id: 'playground', title: 'Playground' },
  { id: 'usage', title: 'Usage' },
];

/**
 * A component of the library (`/components/:page`), one per secondary
 * entry point that renders something: what it is and what to import, a
 * playground to try it in — every input a knob, every output in a log,
 * the state it reflects live (`PlaygroundFrame`) — and the template a
 * host writes. The playground is a chunk of its own (`PLAYGROUNDS`); the
 * same one opens alone at `/playground/:entry`, for debugging with
 * nothing of the app around it.
 */
@Component({
  selector: 'app-components',
  imports: [NgComponentOutlet, RouterLink, DocPage, DocProse, DocCode],
  templateUrl: './components.html',
  styleUrl: './components.scss',
})
export class Components {
  /** The route's `:page` — always one of `ENTRY_PAGES` (the route checks). */
  readonly page = input.required<string>();

  protected readonly link = computed(
    () => ENTRY_PAGES.find((page) => page.id === this.page()) ?? ENTRY_PAGES[0],
  );
  /** Its group in the aside, then itself. */
  protected readonly trail = computed(() => [
    COMPONENT_PAGES.includes(this.link()) ? 'app.nav.components' : 'app.nav.utilities',
    this.link().key,
  ]);
  protected readonly content = computed(() => COMPONENT_CONTENT[this.link().id]);
  protected readonly toc = TOC;
  protected readonly usageLang = computed(() => this.content().usageLang ?? 'html');

  /** The entry point, written as a host imports it. */
  protected readonly importLine = computed(
    () => `import { ${this.content().exports.join(', ')} } from '${LIB}/${this.link().id}';`,
  );

  protected readonly playground = resource({
    params: () => this.link().id,
    loader: ({ params }) => PLAYGROUNDS[params](),
  });

  readonly #injector = inject(Injector);
  /** Tells the playground where it is, and the way to it alone. */
  protected readonly placeInjector = computed(() =>
    Injector.create({
      parent: this.#injector,
      providers: [
        {
          provide: PLAYGROUND_PLACE,
          useValue: { alone: false, link: `/playground/${this.link().id}` },
        },
      ],
    }),
  );
}
