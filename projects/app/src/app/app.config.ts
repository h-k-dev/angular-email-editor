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
      // A factory, not the bare class: ngx-translate 18 tells the two apart by
      // the source text (`/^class\s/`), and a production build minifies the
      // class to `class{…}` — taken for a factory, called without `new`, the
      // app dies on startup. The dev server never shows it.
      loader: provideTranslateLoader(() => new LazyTranslations()),
      fallbackLang: 'en',
      lang: 'en',
    }),
  ],
};
