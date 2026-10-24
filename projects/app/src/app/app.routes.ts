import { Routes } from '@angular/router';

export const routes: Routes = [
  // Everything lazy — the shell's initial chunk is the outlet only. The
  // composer is the front page: the landing, a document on the whole screen
  // under its own bar. The other pages live in the mailbox, its aside beside
  // them — each its own chunk, and deep-linkable.
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./landing/landing').then((m) => m.Landing),
  },
  {
    path: '',
    loadComponent: () => import('./mailbox/mailbox').then((m) => m.Mailbox),
    children: [
      {
        path: 'inbox',
        loadComponent: () => import('./inbox/inbox').then((m) => m.Inbox),
      },
      {
        path: 'api',
        loadComponent: () => import('./api-reference/api-reference').then((m) => m.ApiReference),
      },
      {
        path: 'styling',
        loadComponent: () => import('./styling/styling').then((m) => m.Styling),
      },
      {
        path: 'render',
        loadComponent: () => import('./render/render').then((m) => m.Render),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
