/**
 * The compose page's entrance, in real Chromium — `npm run test:render`
 * (jsdom's focus is not a browser's): the page opens on its welcome, To
 * addressed, with the caret already in the text — handed in by the
 * editor's host as the editor mounts — so the first keystroke writes.
 */
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Compose } from './compose';
import { EMAIL_SEND_LATENCY } from '../../../core/email/email-send';

describe('Compose entrance (render)', () => {
  let fixture: ComponentFixture<Compose>;

  const host = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [Compose],
      providers: [provideRouter([]), { provide: EMAIL_SEND_LATENCY, useValue: 0 }],
    });
    fixture = TestBed.createComponent(Compose);
    host().style.cssText = 'display: block; inline-size: 700px; block-size: 700px';
    document.body.append(host());
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  afterEach(() => host().remove());

  it('opens addressed, with the caret in the text', () => {
    const sheet = (fixture.componentInstance as any).sheet();
    expect(sheet.message().to).toEqual(['pride@example.com']);
    expect(sheet.blank()).toBe(true);

    const text = host().querySelector('[aria-label="Message body"]')!;
    expect(document.activeElement).toBe(text);
    expect(text.contains(getSelection()!.anchorNode)).toBe(true);
  });
});
