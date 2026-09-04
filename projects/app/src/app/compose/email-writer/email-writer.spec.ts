import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EmailWriter } from './email-writer';

describe('EmailWriter', () => {
  let component: EmailWriter;
  let fixture: ComponentFixture<EmailWriter>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmailWriter],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailWriter);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('puts Send on the right of its top bar, and sending without an editor is a no-op', () => {
    const bar = fixture.nativeElement.querySelector('.writer-bar') as HTMLElement;
    const send = bar.querySelector('.writer-bar__send') as HTMLButtonElement;
    expect(send.textContent).toContain('Send');
    expect(bar.lastElementChild).toBe(send);
    expect(() => send.click()).not.toThrow();
  });

  it('lays the envelope out as From, To, Subject rows under the bar', () => {
    const root = fixture.nativeElement as HTMLElement;
    const labels = [
      ...root.querySelectorAll(
        '.writer-envelope .field-label, .writer-envelope .writer-field__label',
      ),
    ].map((el) => el.textContent?.trim());
    expect(labels).toEqual(['From', 'To', 'Subject']);
  });

  it('binds the subject two-way', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector('.writer-field__input') as HTMLInputElement;
    input.value = 'Quarterly numbers';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(component.subject()).toBe('Quarterly numbers');
  });
});
