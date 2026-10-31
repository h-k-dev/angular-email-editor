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

  it('is the composer alone, no header — home beside ⋮ in the sheet\'s bar', () => {
    expect(root.querySelector('header:not(.writer-bar)')).toBeNull();
    expect(root.querySelector('app-compose [message-form]')).not.toBeNull();
    // Home sits just before ⋮ — the page's one way out.
    const home = root.querySelector('.writer-bar a[aria-label="Mailbox"]')!;
    expect(home.getAttribute('href')).toBe('/inbox');
    expect(home.nextElementSibling?.querySelector('[aria-label="More options"]')).not.toBeNull();
  });
});
