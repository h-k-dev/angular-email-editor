import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form } from '@angular/forms/signals';
import { Attachment, AttachmentChip } from 'angular-email-editor/attachment-chip';
import { AttachmentChips } from './attachment-chips';

/** A host the way a composer without a form uses the pair: it holds the
    list two-way, renders a chip per item into the strip, and leaves the
    removals to the strip. */
@Component({
  imports: [AttachmentChips, AttachmentChip],
  template: `<ul
    email-attachment-chips
    [label]="label()"
    [disabled]="disabled()"
    [(value)]="attachments"
  >
    @for (attachment of attachments(); track attachment) {
      <li
        email-attachment-chip
        [attachment]="attachment"
        [aria-busy]="attachment === uploading()"
        (removed)="removals = removals + 1"
      ></li>
    }
  </ul>`,
})
class Host {
  readonly attachments = signal<Attachment[]>([]);
  readonly uploading = signal<Attachment | null>(null);
  readonly disabled = signal(false);
  readonly label = signal('Attachments');
  removals = 0;
}

describe('AttachmentChips', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let list: HTMLElement;

  const chips = () => [...list.querySelectorAll('[email-attachment-chip]')];
  const names = () =>
    chips().map((chip) => chip.querySelector('[data-slot=name]')?.textContent?.trim());
  const removeButton = (index: number) =>
    chips()[index].querySelector<HTMLButtonElement>('[data-slot=remove]')!;

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

  it("a chip's removal takes exactly its item out of the value — the strip's doing, not the host's", async () => {
    const twin = { name: 'same-name.pdf', type: 'application/pdf' };
    host.attachments.set([{ name: 'same-name.pdf', type: 'application/pdf' }, twin]);
    await fixture.whenStable();

    removeButton(0).click();
    await fixture.whenStable();

    expect(host.attachments()).toEqual([twin]);
    expect(host.attachments()[0]).toBe(twin);
    expect(host.removals).toBe(1); // the chip's own output still reaches the host
    expect(chips()).toHaveLength(1);
  });

  it('hides again when the last chip is removed', async () => {
    host.attachments.set([{ name: 'only.txt', type: 'text/plain' }]);
    await fixture.whenStable();

    removeButton(0).click();
    await fixture.whenStable();

    expect(chips()).toHaveLength(0);
    expect(list.hasAttribute('hidden')).toBe(true);
  });

  it('holds the value still while disabled, and says so', async () => {
    host.attachments.set([{ name: 'only.txt', type: 'text/plain' }]);
    host.disabled.set(true);
    await fixture.whenStable();
    expect(list.getAttribute('aria-disabled')).toBe('true');

    removeButton(0).click();
    await fixture.whenStable();
    expect(host.attachments()).toHaveLength(1);
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

/** A host the way a signal-forms composer uses the strip: the field
    directive on the container, the chips rendered from the field's value. */
@Component({
  imports: [AttachmentChips, AttachmentChip, FormField],
  template: `<ul email-attachment-chips [formField]="message.attachments">
    @for (attachment of message.attachments().value(); track attachment) {
      <li email-attachment-chip [attachment]="attachment"></li>
    }
  </ul>`,
})
class FormHost {
  readonly model = signal({
    attachments: [
      { name: 'a.pdf', type: 'application/pdf' },
      { name: 'b.pdf', type: 'application/pdf' },
    ] as Attachment[],
  });
  readonly message = form(this.model);
}

describe('AttachmentChips in a signal form', () => {
  it('draws the field’s value and writes a removal back into the model', async () => {
    await TestBed.configureTestingModule({ imports: [FormHost] }).compileComponents();
    const fixture = TestBed.createComponent(FormHost);
    const host = fixture.componentInstance;
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('[email-attachment-chip]')).toHaveLength(2);

    root.querySelector<HTMLButtonElement>('[data-slot=remove]')!.click();
    await fixture.whenStable();
    expect(host.model().attachments.map((a) => a.name)).toEqual(['b.pdf']);
    expect(host.message.attachments().dirty()).toBe(true);
    expect(root.querySelectorAll('[email-attachment-chip]')).toHaveLength(1);
  });
});
