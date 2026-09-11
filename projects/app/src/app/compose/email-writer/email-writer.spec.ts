import { Component, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { EmailWriter } from './email-writer';
import { Viewport } from '../../viewport';

/** A host the way the composer uses the writer: a form over a model, with
    an action the test settles by hand, and the fields projected in. */
@Component({
  imports: [EmailWriter],
  template: `<form email-writer [formRoot]="envelope">
    <button type="button" class="action" actions>Discard</button>
    <p class="field">projected</p>
  </form>`,
})
class Host {
  readonly model = signal({ subject: '' });
  submissions = 0;
  settle!: () => void;
  readonly envelope = form(this.model, {
    submission: {
      action: () => {
        this.submissions++;
        return new Promise<null>((resolve) => (this.settle = () => resolve(null)));
      },
    },
  });
}

describe('EmailWriter', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let root: HTMLElement;
  let compact: WritableSignal<boolean>;

  const send = () => root.querySelector('.writer-bar__send') as HTMLButtonElement;
  const bar = () => root.querySelector('.writer-bar') as HTMLElement;
  const field = () => root.querySelector('.field') as HTMLElement;
  const follows = (a: Node, b: Node) =>
    !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  beforeEach(async () => {
    compact = signal(false);
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        { provide: Viewport, useValue: { narrow: signal(false), compact: compact.asReadonly() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
    root = fixture.nativeElement as HTMLElement;
  });

  it('is the form, with Send as its submit button on the right of the bar, after the actions', () => {
    const writer = root.querySelector('form[email-writer]')!;
    expect(writer.getAttribute('novalidate')).not.toBeNull(); // the form root's
    // Icon-only, so the name lives on the label, not in the text.
    expect(send().type).toBe('submit');
    expect(send().getAttribute('aria-label')).toBe('Send');
    expect(send().querySelector('mat-icon')?.textContent?.trim()).toBe('send');
    expect(bar().lastElementChild).toBe(send());
    expect(send().previousElementSibling).toBe(root.querySelector('.action'));
  });

  it('closes the sheet with the bar, under the fields, where there is room', () => {
    expect(bar().tagName).toBe('FOOTER');
    expect(follows(field(), bar())).toBe(true);
    expect(root.querySelectorAll('.writer-bar')).toHaveLength(1);
  });

  it('heads the sheet with the bar on a phone — the same buttons, moved', async () => {
    const action = root.querySelector('.action');
    compact.set(true);
    await fixture.whenStable();
    expect(bar().tagName).toBe('HEADER');
    expect(follows(bar(), field())).toBe(true);
    expect(root.querySelectorAll('.writer-bar')).toHaveLength(1);
    // The host's action is its own node, carried along rather than re-created.
    expect(root.querySelector('.action')).toBe(action);
  });

  it("Send submits the host's form, and shows progress — never disabled — until the action settles", async () => {
    const spinner = () => send().querySelector('mat-progress-spinner');
    expect(spinner()).toBeNull();

    send().click();
    await fixture.whenStable();
    expect(host.submissions).toBe(1);
    expect(host.envelope().submitting()).toBe(true);
    expect(spinner()).not.toBeNull();
    expect(send().getAttribute('aria-label')).toBe('Sending');
    // Still live: not disabled, not even aria-disabled — and a second press
    // while the first is out does not send twice.
    expect(send().disabled).toBe(false);
    expect(send().getAttribute('aria-disabled')).toBeNull();
    send().click();
    await fixture.whenStable();
    expect(host.submissions).toBe(1);

    host.settle();
    await new Promise((resolve) => setTimeout(resolve, 0)); // the submit's own microtasks
    await fixture.whenStable();
    expect(host.envelope().submitting()).toBe(false);
    expect(spinner()).toBeNull();
    expect(send().getAttribute('aria-label')).toBe('Send');
  });
});
