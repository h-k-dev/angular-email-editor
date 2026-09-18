import { Service, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import type { SuggestionItemLabel } from 'angular-email-editor';

import { AppLanguage, LANGUAGES } from '../i18n/loader';

/**
 * The app's words, over ngx-translate. English is what the code says; a
 * lookup that finds nothing gives the fallback it was handed — so a
 * component never shows a key, and a spec that provides no translations
 * reads English.
 *
 * Reads are reactive: `t()` in a template or a `computed` follows a
 * language switch *and* a dictionary that arrives later — ngx-translate's
 * `currentLang` signal is set before a first language has loaded, so this
 * listens to its events instead.
 */
@Service()
export class I18n {
  /** Optional: a spec that provides nothing still gets English. */
  readonly #translate = inject(TranslateService, { optional: true });

  /** Moves whenever the words may have: a switch, a dictionary landing. */
  readonly #version = signal(0);

  readonly languages = LANGUAGES;

  /** The language in use. */
  readonly lang = computed<AppLanguage>(() => {
    this.#version();
    const current = this.#translate?.getCurrentLang();
    return LANGUAGES.find((language) => language === current) ?? 'en';
  });

  constructor() {
    const bump = () => this.#version.update((version) => version + 1);
    this.#translate?.onLangChange.pipe(takeUntilDestroyed()).subscribe(bump);
    this.#translate?.onTranslationChange.pipe(takeUntilDestroyed()).subscribe(bump);
  }

  use(language: AppLanguage): void {
    this.#translate?.use(language);
  }

  /** The words for `key` in the language in use, or `fallback` — the
      English the code already has. Reactive. */
  t(key: string, fallback: string, params?: Record<string, unknown>): string {
    this.#version();
    return this.#lookup(key, params) ?? fallback;
  }

  /**
   * A suggestion menu's `i18n`: the label of an item by its id — title,
   * extra search words, a group's placeholder. The menu asks when it opens,
   * so this reads the language of that moment and tracks nothing.
   */
  readonly suggestionLabel = (id: string): SuggestionItemLabel | undefined => {
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
    const found = this.#translate?.instant(key, params);
    return typeof found === 'string' && found !== key ? found : undefined;
  }
}
