/**
 * A document's sideways scroll, in real Chromium — `npm run test:render`
 * (jsdom has no layout): the compose page is the zoomed window's layout
 * (`document`), the whole sheet the scroller. An email wider than the
 * column — a fixed-layout table round a wider one, as Poor Fix Width is —
 * scrolls sideways under the bar, the envelope and the formatting toolbar,
 * which stay where the column puts them. Downwards only the toolbar holds
 * (the foot): the bar and the envelope go up with the text.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { page } from 'vitest/browser';

import { Compose } from './compose';
import { EMAIL_SEND_LATENCY } from '../../../core/email/email-send';
import { EmailCompose } from '../../partials/shared/email/email-compose/email-compose';

const WIDE =
  '<table width="1200" style="width: 1200px; table-layout: fixed"><tbody><tr><td>' +
  '<table><tbody><tr>' +
  `<td style="white-space: nowrap; height: 1500px">Verwendungszweck: ${'B'.repeat(240)}</td>` +
  '</tr></tbody></table>' +
  '</td></tr></tbody></table>';

describe('Compose sideways (render)', () => {
  let fixture: ComponentFixture<Compose>;

  const host = () => fixture.nativeElement as HTMLElement;
  const el = (selector: string) => host().querySelector<HTMLElement>(selector)!;
  const left = (selector: string) => el(selector).getBoundingClientRect().left;
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  beforeEach(async () => {
    localStorage.clear();
    await page.viewport(1200, 800);
    TestBed.configureTestingModule({
      imports: [Compose],
      providers: [{ provide: EMAIL_SEND_LATENCY, useValue: 0 }],
    });
    fixture = TestBed.createComponent(Compose);
    host().style.cssText = 'display: flex; flex-direction: column; position: fixed; inset: 0';
    document.body.append(host());
    await fixture.whenStable();
    // The formatting toolbar on, so the foot has something to keep in place.
    localStorage.setItem('angular-email-editor:formatting-toolbar', 'on');
    const sheet = (fixture.componentInstance as any).sheet();
    sheet.formattingOpen?.set(true);
    const body = () => fixture.debugElement.query(By.directive(EmailCompose)).componentInstance as EmailCompose;
    await vi.waitFor(() => expect(body().baseline()).not.toBeNull());
    body().replace(WIDE);
    await vi.waitFor(async () => {
      await fixture.whenStable();
      const form = el('form[email-writer]');
      expect(form.scrollWidth).toBeGreaterThan(form.clientWidth + 1000);
    });
  });

  afterEach(() => {
    host().remove();
    localStorage.clear();
  });

  it('scrolls the email alone sideways: the bar, the envelope and the toolbar stay put', async () => {
    const form = el('form[email-writer]');
    expect(form.getAttribute('data-scroll')).toBe('sheet');
    // The composer as wide as the email draws: its sticky foot spans the
    // whole scroll.
    expect(el('section[email-compose]').getBoundingClientRect().width).toBeGreaterThan(form.scrollWidth - 1);

    const fixed = ['form[email-writer] > header.writer-bar', '.writer-envelope', '.email-compose__dock'];
    const before = fixed.map(left);
    const email = left('section[email-compose]');
    for (const by of [500, form.scrollWidth]) {
      form.scrollLeft = by;
      await frame();
      expect(fixed.map(left)).toEqual(before);
      expect(left('section[email-compose]')).toBeCloseTo(email - form.scrollLeft, 0);
    }
  });

  it('scrolls the bar and the envelope away downwards — only the toolbar holds the foot', async () => {
    const form = el('form[email-writer]');
    const box = (selector: string) => el(selector).getBoundingClientRect();
    const bar = box('form[email-writer] > header.writer-bar');
    const toolbar = box('.email-compose__dock');
    const email = box('section[email-compose]');
    const envelope = box('.writer-envelope');
    form.scrollTop = 300;
    await frame();
    const by = form.scrollTop;
    expect(by).toBeGreaterThan(100);
    // Only the text moves.
    expect(box('section[email-compose]').top).toBeCloseTo(email.top - by, 0);
    expect(box('form[email-writer] > header.writer-bar').top).toBeCloseTo(bar.top - by, 0);
    expect(box('.writer-envelope').top).toBeCloseTo(envelope.top - by, 0);
    expect(box('.email-compose__dock').top).toBeCloseTo(toolbar.top, 0);
    // The toolbar's glass down to the sheet's very edge: nothing shows under it.
    expect(box('.email-compose__foot').bottom).toBeCloseTo(form.getBoundingClientRect().bottom, 0);
    // Under the toolbar, the sideways bar's room (its rail): it never lies
    // over the buttons.
    expect(box('.email-compose__foot').bottom - box('.email-compose__dock').bottom).toBeCloseTo(12, 0);
  });

  it('leaves the column alone for an email that fits', async () => {
    const body = fixture.debugElement.query(By.directive(EmailCompose)).componentInstance as EmailCompose;
    body.replace('<p>Hi</p>');
    await vi.waitFor(async () => {
      await fixture.whenStable();
      const form = el('form[email-writer]');
      expect(form.scrollWidth).toBe(form.clientWidth);
    });
    expect(el('section[email-compose]').getBoundingClientRect().width).toBeLessThanOrEqual(720);
  });
});
