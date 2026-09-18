import { TestBed } from '@angular/core/testing';
import { provideTranslateLoader, provideTranslateService } from '@ngx-translate/core';

import { LazyTranslations } from '../i18n/loader';
import { I18n } from './i18n';

describe('I18n', () => {
  describe('with nothing provided', () => {
    it('is English: every lookup gives its fallback', () => {
      TestBed.configureTestingModule({});
      const i18n = TestBed.inject(I18n);
      expect(i18n.lang()).toBe('en');
      expect(i18n.t('editor.menu.empty', 'No results')).toBe('No results');
      expect(i18n.suggestionLabel('bold')).toBeUndefined();
      i18n.use('de'); // nothing to switch: still English, no error
      expect(i18n.t('editor.menu.empty', 'No results')).toBe('No results');
    });
  });

  describe('over ngx-translate', () => {
    let i18n: I18n;

    /** The German dictionary is its own chunk: wait for it to land. */
    const german = async () => {
      i18n.use('de');
      await vi.waitFor(() => expect(i18n.lang()).toBe('de'));
      await vi.waitFor(() =>
        expect(i18n.t('editor.menu.empty', 'No results')).not.toBe('No results'),
      );
    };

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          provideTranslateService({
            loader: provideTranslateLoader(LazyTranslations),
            fallbackLang: 'en',
            lang: 'en',
          }),
        ],
      });
      i18n = TestBed.inject(I18n);
    });

    it('says the fallback in English — English is what the code says', () => {
      expect(i18n.t('editor.menu.empty', 'No results')).toBe('No results');
    });

    it('follows a language switch, once the dictionary has landed', async () => {
      await german();
      expect(i18n.t('editor.menu.empty', 'No results')).toBe('Keine Treffer');
      expect(i18n.t('editor.menu.results.other', '{{count}} results', { count: 5 })).toBe(
        '5 Treffer',
      );
      expect(i18n.t('no.such.key', 'Fallback')).toBe('Fallback');
    });

    it('gives a suggestion no second language in English: one language, one search', async () => {
      expect(i18n.suggestionLabel('bold')).toBeUndefined();
      await german();
      expect(i18n.suggestionLabel('bold')).toBeDefined();
      // …and none again after switching back: German words no longer match.
      i18n.use('en');
      await vi.waitFor(() => expect(i18n.lang()).toBe('en'));
      expect(i18n.suggestionLabel('bold')).toBeUndefined();
      expect(i18n.suggestionLabel('templates')).toBeUndefined();
    });

    it('speaks Japanese too, from a chunk of its own', async () => {
      i18n.use('ja');
      await vi.waitFor(() => expect(i18n.t('editor.menu.back', 'Back')).toBe('戻る'));
      expect(i18n.lang()).toBe('ja');
      expect(i18n.suggestionLabel('bold')?.title).toBe('太字');
    });

    it('labels a suggestion by its id: title, extra search words, a group’s placeholder', async () => {
      await german();
      expect(i18n.suggestionLabel('bold')).toEqual({
        title: 'Fett',
        keywords: ['fett', 'hervorheben'],
        placeholder: undefined,
      });
      expect(i18n.suggestionLabel('templates')?.placeholder).toBe('Vorlagen durchsuchen…');
      expect(i18n.suggestionLabel('a-template-from-the-server')).toBeUndefined();
    });
  });
});
