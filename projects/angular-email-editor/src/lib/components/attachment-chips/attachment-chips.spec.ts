import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Attachment } from '../attachment-chip/attachment';
import { AttachmentChip } from '../attachment-chip/attachment-chip';
import { AttachmentChips } from './attachment-chips';

/** A host the way the composer uses the pair: it owns the list, renders a
    chip per item into the container, and answers each chip's `removed`. */
@Component({
  imports: [AttachmentChips, AttachmentChip],
  template: `<ul email-attachment-chips [label]="label()">
    @for (attachment of attachments(); track attachment) {
      <li
        email-attachment-chip
        [attachment]="attachment"
        [aria-busy]="attachment === uploading()"
        (removed)="remove(attachment)"
      ></li>
    }
  </ul>`,
})
class Host {
  readonly attachments = signal<Attachment[]>([]);
  readonly uploading = signal<Attachment | null>(null);
  readonly label = signal('Attachments');

  remove(attachment: Attachment): void {
    this.attachments.update((current) => current.filter((a) => a !== attachment));
  }
}

describe('AttachmentChips', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let list: HTMLElement;

  const chips = () => [...list.querySelectorAll('[email-attachment-chip]')];
  const names = () =>
    chips().map((chip) => chip.querySelector('[data-slot=name]')?.textContent?.trim());

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
    list = (fixture.nativeElement as HTMLElement).querySelector('[email-attachment-chips]')!;
  });

  it('hides itself while it holds no chips', () => {
    expect(chips()).toHaveLength(0);
    expect(list.hasAttribute('hidden')).toBe(true);
  });

  it('reveals itself once the host renders chips into it', async () => {
    host.attachments.set([
      { name: 'Q4-report.pdf', type: 'application/pdf' },
      { name: 'photo.jpg', type: 'image/jpeg' },
    ]);
    await fixture.whenStable();

    expect(names()).toEqual(['Q4-report.pdf', 'photo.jpg']);
    expect(list.hasAttribute('hidden')).toBe(false);
  });

  it('hides again when the last chip is removed', async () => {
    host.attachments.set([{ name: 'only.txt', type: 'text/plain' }]);
    await fixture.whenStable();

    chips()[0].querySelector<HTMLButtonElement>('[data-slot=remove]')!.click();
    await fixture.whenStable();

    expect(chips()).toHaveLength(0);
    expect(list.hasAttribute('hidden')).toBe(true);
  });

  it('is busy while any of its chips is', async () => {
    const pending = { name: 'big.zip', type: 'application/zip' };
    host.attachments.set([{ name: 'done.txt', type: 'text/plain' }, pending]);
    await fixture.whenStable();
    expect(list.hasAttribute('aria-busy')).toBe(false);

    host.uploading.set(pending);
    await fixture.whenStable();
    expect(list.getAttribute('aria-busy')).toBe('true');

    host.uploading.set(null);
    await fixture.whenStable();
    expect(list.hasAttribute('aria-busy')).toBe(false);
  });

  it('is a named list, whatever list-style does to it', async () => {
    expect(list.getAttribute('role')).toBe('list');
    expect(list.getAttribute('aria-label')).toBe('Attachments');

    host.label.set('Anhänge');
    await fixture.whenStable();

    expect(list.getAttribute('aria-label')).toBe('Anhänge');
  });
});
