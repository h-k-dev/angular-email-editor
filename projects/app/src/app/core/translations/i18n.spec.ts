import { TestBed } from '@angular/core/testing';
import { I18n } from './i18n';

describe('I18n', () => {
  describe('over ngx-translate', () => {
    let i18n: I18n;

    /** The German dictionary is its own chunk: wait for it to land. */
    const german = async () => {
      i18n.use('de');
      await vi.waitFor(() => expect(i18n.lang()).toBe('de'));
      await vi.waitFor(() => expect(i18n.t('editor.menu.empty')).not.toBe('No results'));
    };

    // test-setup.ts provides the app's i18n, as app.config.ts does.
    beforeEach(() => {
      i18n = TestBed.inject(I18n);
    });

    it('speaks English from the start — the bundled dictionary, no wait', () => {
      expect(i18n.lang()).toBe('en');
      expect(i18n.t('editor.menu.empty')).toBe('No results');
      expect(i18n.suggestionLabel('bold')).toBeUndefined();
    });

    it('keeps the language picked, and takes up a pick from another tab', async () => {
      await german();
      expect(localStorage.getItem('angular-email-editor:language')).toBe('de');

      // Another tab goes back to English: the default is no key at all.
      localStorage.removeItem('angular-email-editor:language');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'angular-email-editor:language',
          newValue: null,
          storageArea: localStorage,
        }),
      );
      TestBed.tick();
      expect(i18n.lang()).toBe('en');
    });

    it('follows a language switch, once the dictionary has landed', async () => {
      await german();
      expect(i18n.t('editor.menu.empty')).toBe('Keine Treffer');
      expect(i18n.t('editor.menu.results.other', { count: 5 })).toBe('5 Treffer');
      // A key German does not say reads as English; one nobody says, as itself.
      expect(i18n.t('render.view')).toBe('View');
      expect(i18n.lookup('no.such.key')).toBeUndefined();
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
      await vi.waitFor(() => expect(i18n.t('editor.menu.back')).toBe('戻る'));
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

  it('speaks the language this browser kept from the start', async () => {
    localStorage.setItem('angular-email-editor:language', 'ja');
    const i18n = TestBed.inject(I18n);
    TestBed.tick();
    await vi.waitFor(() => expect(i18n.lang()).toBe('ja'));
    // The page says so, for a screen reader's voice.
    expect(document.documentElement.lang).toBe('ja');
    i18n.use('de');
    expect(document.documentElement.lang).toBe('de');
  });

  it('reads a language it does not speak as English', () => {
    localStorage.setItem('angular-email-editor:language', 'xx');
    const i18n = TestBed.inject(I18n);
    TestBed.tick();
    expect(i18n.lang()).toBe('en');
  });
});
