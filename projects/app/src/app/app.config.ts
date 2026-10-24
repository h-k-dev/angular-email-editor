import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { provideI18n } from '../i18n/loader';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Route params bind to inputs: the inbox reader's `id` is `/inbox/:id`.
    provideRouter(routes, withComponentInputBinding()),
    // English is bundled; any other language is a chunk of its own, fetched
    // when it is first switched to (see i18n/loader.ts).
    provideI18n(),
  ],
};
