import { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { Observable, from, of } from 'rxjs';

/** The languages the demo speaks, in the picker's order. English needs no
    file (see `de.ts`). */
export const LANGUAGES = ['en', 'ja', 'de'] as const;
export type AppLanguage = (typeof LANGUAGES)[number];

/**
 * Loads a language as its own chunk, the first time it is used: a
 * dictionary nobody switched to is never downloaded. No HTTP loader, no
 * JSON on a server — a TypeScript module per language is type-checked and
 * bundled like the rest of the app.
 */
export class LazyTranslations implements TranslateLoader {
  getTranslation(lang: string): Observable<TranslationObject> {
    switch (lang) {
      case 'de':
        return from(import('./de').then((module) => module.default as TranslationObject));
      case 'ja':
        return from(import('./ja').then((module) => module.default as TranslationObject));
      default:
        return of({});
    }
  }
}
