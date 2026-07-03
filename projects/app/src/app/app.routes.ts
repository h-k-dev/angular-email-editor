import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./compose/compose').then((m) => m.Compose),
  },
];
