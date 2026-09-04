import { Routes } from '@angular/router';

export const routes: Routes = [
  // Everything lazy — the shell's initial chunk is the side nav only. The
  // composer stays the front page; the reference pages are their own chunks
  // and deep-linkable.
  {
    path: '',
    loadComponent: () => import('./compose/compose').then((m) => m.Compose),
  },
  {
    path: 'api',
    loadComponent: () => import('./api-reference/api-reference').then((m) => m.ApiReference),
  },
  {
    path: 'styling',
    loadComponent: () => import('./styling/styling').then((m) => m.Styling),
  },
  { path: '**', redirectTo: '' },
];
