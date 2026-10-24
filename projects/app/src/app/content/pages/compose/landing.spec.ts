import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { EMAIL_SEND_LATENCY } from '../../../core/email/email-send';
import { Landing } from './landing';

describe('Landing', () => {
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Landing],
      providers: [provideRouter([]), { provide: EMAIL_SEND_LATENCY, useValue: 0 }],
    }).compileComponents();
    const fixture = TestBed.createComponent(Landing);
    await fixture.whenStable();
    root = fixture.nativeElement as HTMLElement;
  });

  it('puts a bar over the composer with home to the mailbox, and nothing else', () => {
    const bar = root.querySelector('.landing-bar')!;
    expect(bar.querySelector('a[aria-label="Mailbox"]')?.getAttribute('href')).toBe('/inbox');
    expect(bar.querySelectorAll('a, button')).toHaveLength(1);
    expect(root.querySelector('app-compose [message-form]')).not.toBeNull();
  });

  it('stands the bar on the sheet\'s paper: the same island scheme', () => {
    const bar = root.querySelector('.landing-bar')!;
    const sheet = root.querySelector('[message-form]')!;
    expect(bar.getAttribute('data-paper-scheme')).toBe(sheet.getAttribute('data-paper-scheme'));
  });
});
