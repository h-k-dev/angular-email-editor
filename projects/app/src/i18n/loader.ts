import { Provider } from '@angular/core';
import {
  TranslateLoader,
  TranslationObject,
  provideTranslateLoader,
  provideTranslateService,
} from '@ngx-translate/core';
import { Observable, from, of } from 'rxjs';

import en from './en';

/** The languages the demo speaks, in the picker's order. */
export const LANGUAGES = ['en', 'ja', 'de'] as const;
export type AppLanguage = (typeof LANGUAGES)[number];

/**
 * English is bundled and answers at once — the first frame, and a spec,
 * reads words, never keys. Any other language loads as its own chunk the
 * first time it is used: a dictionary nobody switched to is never
 * downloaded. No HTTP loader, no JSON on a server — a TypeScript module per
 * language is type-checked and bundled like the rest of the app.
 */
export class LazyTranslations implements TranslateLoader {
  getTranslation(lang: string): Observable<TranslationObject> {
    switch (lang) {
      case 'de':
        return from(import('./de').then((module) => module.default as TranslationObject));
      case 'ja':
        return from(import('./ja').then((module) => module.default as TranslationObject));
      default:
        return of(en);
    }
  }
}

/** The app's words: English in use and as every language's fallback. The
    app and the specs provide the same thing. */
export function provideI18n(): Provider[] {
  return provideTranslateService({
    // A factory, not the bare class: ngx-translate 18 tells the two apart by
    // the source text (`/^class\s/`), and a production build minifies the
    // class to `class{…}` — taken for a factory, called without `new`, the
    // app dies on startup. The dev server never shows it.
    loader: provideTranslateLoader(() => new LazyTranslations()),
    fallbackLang: 'en',
    lang: 'en',
  });
}
