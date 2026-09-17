import { ComponentFixture, TestBed } from '@angular/core/testing';

// Library
import { InlineImages } from 'angular-email-editor';

import { EmailPreview } from './email-preview';

describe('EmailPreview', () => {
  let fixture: ComponentFixture<EmailPreview>;

  const srcdoc = () =>
    (fixture.nativeElement as HTMLElement).querySelector('iframe')?.getAttribute('srcdoc') ?? '';

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmailPreview],
      providers: [InlineImages],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailPreview);
    fixture.componentRef.setInput('html', '<p>First</p>');
    await fixture.whenStable();
  });

  it('renders the html into its frame while active', () => {
    expect(srcdoc()).toContain('<p>First</p>');
  });

  it('holds still while hidden — the frame is not rewritten per keystroke', async () => {
    fixture.componentRef.setInput('active', false);
    await fixture.whenStable();
    const frame = (fixture.nativeElement as HTMLElement).querySelector('iframe')!;
    const writes: string[] = [];
    new MutationObserver((records) => writes.push(...records.map((r) => r.attributeName!))).observe(
      frame,
      { attributes: true },
    );

    for (const text of ['S', 'Se', 'Sec', 'Second']) {
      fixture.componentRef.setInput('html', `<p>${text}</p>`);
      await fixture.whenStable();
    }
    await Promise.resolve();
    expect(writes).not.toContain('srcdoc');
    expect(srcdoc()).toContain('<p>First</p>');
  });

  it('catches up once shown again', async () => {
    fixture.componentRef.setInput('active', false);
    await fixture.whenStable();
    fixture.componentRef.setInput('html', '<p>Second</p>');
    await fixture.whenStable();

    fixture.componentRef.setInput('active', true);
    await fixture.whenStable();
    expect(srcdoc()).toContain('<p>Second</p>');
  });
});
