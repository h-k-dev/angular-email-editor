import { CanMatchFn, Routes } from '@angular/router';

import { API_PAGES } from './content/pages/mailbox/api-reference/api-pages';
import { ENTRY_PAGES } from './content/pages/mailbox/components/component-pages';
import { STYLING_PAGES } from './content/pages/mailbox/styling/styling-pages';
import { DocPageLink } from './content/partials/common/doc-page/doc';

/** Matches `<reference>/:page` only for a page the reference has. */
const knownPage =
  (pages: readonly DocPageLink[]): CanMatchFn =>
  (_route, segments) =>
    pages.some((page) => page.id === segments[1]?.path);

export const routes: Routes = [
  // Everything lazy — the shell's initial chunk is the outlet only. The
  // composer is the front page: the landing, a document on the whole screen
  // under its own bar. The other pages live in the mailbox, its aside beside
  // them — each its own chunk, and deep-linkable.
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./content/pages/compose/landing').then((m) => m.Landing),
  },
  {
    path: '',
    loadComponent: () => import('./content/pages/mailbox/mailbox').then((m) => m.Mailbox),
    children: [
      {
        path: 'inbox',
        loadComponent: () => import('./content/pages/mailbox/inbox/inbox').then((m) => m.Inbox),
        // The pane: a note while no message is open, the message once one is
        // (its id bound to the reader's `id` input).
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./content/partials/atomic/inbox/inbox-empty/inbox-empty').then(
                (m) => m.InboxEmpty,
              ),
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./content/partials/atomic/inbox/inbox-reader/inbox-reader').then(
                (m) => m.InboxReader,
              ),
          },
        ],
      },
      // The calendar: a place per view and day (`/calendar/week/2026-10-29`)
      // — its routes, and Luxon with them, in the calendar's own chunk.
      {
        path: 'calendar',
        loadChildren: () =>
          import('./content/pages/mailbox/calendar/calendar.routes').then((m) => m.CALENDAR_ROUTES),
      },
      // The template gallery: every template the store holds, a feed of
      // thumbnails.
      {
        path: 'templates',
        loadComponent: () =>
          import('./content/pages/mailbox/templates/templates').then((m) => m.TemplateGallery),
      },
      // The snippets: a list, and the open one beside it (its id bound to
      // the editor's `id` input) — the inbox's two halves.
      {
        path: 'snippets',
        loadComponent: () =>
          import('./content/pages/mailbox/snippets/snippets').then((m) => m.SnippetsPage),
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./content/partials/atomic/snippets/snippet-empty/snippet-empty').then(
                (m) => m.SnippetEmpty,
              ),
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./content/partials/atomic/snippets/snippet-editor/snippet-editor').then(
                (m) => m.SnippetEditor,
              ),
          },
        ],
      },
      // The references: a page each per aside link (`/api/editor`), its
      // `:page` bound to the component's `page` input. A reference on its
      // own opens at its first page; a page it does not have is nowhere.
      { path: 'api', pathMatch: 'full', redirectTo: `api/${API_PAGES[0].id}` },
      {
        path: 'api/:page',
        canMatch: [knownPage(API_PAGES)],
        loadComponent: () =>
          import('./content/pages/mailbox/api-reference/api-reference').then((m) => m.ApiReference),
      },
      { path: 'styling', pathMatch: 'full', redirectTo: `styling/${STYLING_PAGES[0].id}` },
      {
        path: 'styling/:page',
        canMatch: [knownPage(STYLING_PAGES)],
        loadComponent: () =>
          import('./content/pages/mailbox/styling/styling').then((m) => m.Styling),
      },
      // The components and utilities, a page each — every one a playground.
      { path: 'components', pathMatch: 'full', redirectTo: `components/${ENTRY_PAGES[0].id}` },
      {
        path: 'components/:page',
        canMatch: [knownPage(ENTRY_PAGES)],
        loadComponent: () =>
          import('./content/pages/mailbox/components/components').then((m) => m.Components),
      },
      {
        path: 'render',
        loadComponent: () => import('./content/pages/mailbox/render/render').then((m) => m.Render),
      },
    ],
  },
  // A component's playground alone, nothing of the app around it — for
  // debugging the component by itself; its page links here.
  {
    path: 'playground/:entry',
    canMatch: [knownPage(ENTRY_PAGES)],
    loadComponent: () =>
      import('./content/pages/playground/playground-alone').then((m) => m.PlaygroundAlone),
  },
  { path: '**', redirectTo: '' },
];
