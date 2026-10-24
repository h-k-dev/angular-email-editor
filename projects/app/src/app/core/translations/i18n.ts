import { DOCUMENT, Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import type { SuggestionItemLabel } from '@h-k-dev/angular-email-editor';

import { AppLanguage, LANGUAGES } from '../../../i18n/loader';
import { Preferences } from '../storages/preferences';

/**
 * The app's words, over ngx-translate, for code: a `computed`, a snackbar, a
 * callback the library calls. A template reads them through ngx-translate's
 * own pipe instead — `{{ 'composer.more' | translate }}` — never a method
 * call (see `i18n/en.ts`).
 *
 * Reads are reactive: `t()` in a `computed` follows a language switch *and*
 * a dictionary that arrives later — ngx-translate's `currentLang` signal is
 * set before a first language has loaded, so this listens to its events
 * instead.
 *
 * The language is a {@link Preferences} one: this browser keeps the pick,
 * and a pick in another tab is taken up here too.
 */
@Service()
export class I18n {
  readonly #translate = inject(TranslateService);
  readonly #chosen = inject(Preferences).language;
  readonly #root = inject(DOCUMENT).documentElement;

  /** Moves whenever the words may have: a switch, a dictionary landing. */
  readonly #version = signal(0);

  readonly languages = LANGUAGES;

  /** The language in use. */
  readonly lang = computed<AppLanguage>(() => {
    this.#version();
    const current = this.#translate.getCurrentLang();
    return LANGUAGES.find((language) => language === current) ?? 'en';
  });

  constructor() {
    const bump = () => this.#version.update((version) => version + 1);
    this.#translate.onLangChange.pipe(takeUntilDestroyed()).subscribe(bump);
    this.#translate.onTranslationChange.pipe(takeUntilDestroyed()).subscribe(bump);

    // The kept pick, as the app starts and as another tab changes it:
    // ngx-translate is outside the signal graph, so it is handed over. The
    // page says which language it is in (`<html lang>`): a screen reader
    // reads Japanese with a Japanese voice, a browser hyphenates German as
    // German.
    effect(() => {
      const language = this.#chosen();
      untracked(() => {
        if (this.#translate.getCurrentLang() !== language) this.#translate.use(language);
        this.#root.lang = language;
      });
    });
  }

  /** Speaks `language` from now on — and in every tab, after a reload too. */
  use(language: AppLanguage): void {
    this.#chosen.set(language);
    this.#translate.use(language);
    this.#root.lang = language;
  }

  /** The words for `key` in the language in use — English where it has
      none (`i18n/en.ts`). Reactive. */
  t(key: string, params?: Record<string, unknown>): string {
    this.#version();
    return this.#lookup(key, params) ?? key;
  }

  /** The words for `key`, or `undefined` where no dictionary has any — for a
      key made of an id, whose English is someone else's (a library action's
      title). Reactive. */
  lookup(key: string, params?: Record<string, unknown>): string | undefined {
    this.#version();
    return this.#lookup(key, params);
  }

  /**
   * A suggestion menu's `i18n`: the label of an item by its id — title,
   * extra search words, a group's placeholder. The menu asks when it opens,
   * so this reads the language of that moment and tracks nothing.
   */
  readonly suggestionLabel = (id: string): SuggestionItemLabel | undefined => {
    // A palette row — `color-red`, `background-red` — is worded from the
    // colour's name and the side's pattern ("{{name}} text"), so a palette
    // of any length is translated by its names alone.
    const colour = /^(color|background)-(.+)$/.exec(id);
    if (colour) {
      const name = this.#lookup(`editor.color.names.${colour[2]}`);
      if (!name) return undefined;
      const side = colour[1] === 'color' ? 'textRow' : 'backgroundRow';
      return { title: this.#lookup(`editor.color.${side}`, { name }), keywords: [name] };
    }
    const base = `editor.actions.${id}`;
    const title = this.#lookup(`${base}.title`);
    const keywords = this.#lookup(`${base}.keywords`);
    const placeholder = this.#lookup(`${base}.placeholder`);
    if (!title && !keywords && !placeholder) return undefined;
    return {
      title,
      keywords: keywords
        ?.split(',')
        .map((word) => word.trim())
        .filter(Boolean),
      placeholder,
    };
  };

  /** ngx-translate answers a missing key with the key itself. */
  #lookup(key: string, params?: Record<string, unknown>): string | undefined {
    const found = this.#translate.instant(key, params);
    return typeof found === 'string' && found !== key ? found : undefined;
  }
}
