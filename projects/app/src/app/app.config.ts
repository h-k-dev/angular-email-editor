import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateLoader, provideTranslateService } from '@ngx-translate/core';

import { LazyTranslations } from '../i18n/loader';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // English is what the code says; any other language is a chunk of its
    // own, fetched when it is first switched to (see i18n/loader.ts).
    provideTranslateService({
      loader: provideTranslateLoader(LazyTranslations),
      fallbackLang: 'en',
      lang: 'en',
    }),
  ],
};
