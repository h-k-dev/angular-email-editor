import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateLoader, provideTranslateService } from '@ngx-translate/core';

import { LazyTranslations } from '../../i18n/loader';
import { I18n } from '../../services/i18n';
import { LanguageMenu } from './language-menu';

describe('LanguageMenu', () => {
  let fixture: ComponentFixture<LanguageMenu>;
  let i18n: I18n;

  const trigger = () =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button')!;
  const items = () => [...document.querySelectorAll<HTMLElement>('[ngMenuItem]')];

  const open = async () => {
    trigger().click();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LanguageMenu],
      providers: [
        provideTranslateService({
          loader: provideTranslateLoader(LazyTranslations),
          fallbackLang: 'en',
          lang: 'en',
        }),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LanguageMenu);
    i18n = TestBed.inject(I18n);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
  });

  afterEach(() => (fixture.nativeElement as HTMLElement).remove());

  it('shows the language in use, in its own words, and names itself', () => {
    expect(trigger().textContent).toContain('English');
    expect(trigger().getAttribute('aria-label')).toBe('Language: English');
    // Angular Aria says `true`, which ARIA reads as "a menu".
    expect(trigger().getAttribute('aria-haspopup')).toBe('true');
  });

  it('offers the three languages as radio items, each in its own words, one of them on', async () => {
    await open();
    expect(items().map((item) => item.textContent?.replace('check', '').trim())).toEqual([
      'English',
      '日本語',
      'Deutsch',
    ]);
    expect(items().map((item) => item.getAttribute('role'))).toEqual([
      'menuitemradio',
      'menuitemradio',
      'menuitemradio',
    ]);
    expect(items().map((item) => item.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
    ]);
  });

  it('switches the language, and says so in the new one', async () => {
    await open();
    items()[2].click();
    await vi.waitFor(() => expect(i18n.lang()).toBe('de'));
    await vi.waitFor(() => expect(i18n.t('app.language', 'Language')).toBe('Sprache'));
    await fixture.whenStable();
    expect(trigger().textContent).toContain('Deutsch');
    expect(trigger().getAttribute('aria-label')).toBe('Sprache: Deutsch');
  });
});
