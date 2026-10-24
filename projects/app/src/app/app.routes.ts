import { Routes } from '@angular/router';

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
      {
        path: 'api',
        loadComponent: () => import('./content/pages/mailbox/api-reference/api-reference').then((m) => m.ApiReference),
      },
      {
        path: 'styling',
        loadComponent: () => import('./content/pages/mailbox/styling/styling').then((m) => m.Styling),
      },
      {
        path: 'render',
        loadComponent: () => import('./content/pages/mailbox/render/render').then((m) => m.Render),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
