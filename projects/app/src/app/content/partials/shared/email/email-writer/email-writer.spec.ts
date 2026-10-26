import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { ScrollOwner } from '../../../../../core/directives/scroll-owner/scroll-owner';
import { EmailWriter, WriterBarPosition } from './email-writer';

/** A host the way the sheets use the writer: a form over a model, with an
    action the test settles by hand, and the fields projected in. The bar's
    place and its size are the host's to say; what scrolls, whether the
    host makes the writer own the scroll (`scrollOwner`). */
@Component({
  imports: [EmailWriter, ScrollOwner],
  template: `<form
    email-writer
    [formRoot]="envelope"
    [bar]="bar()"
    [dense]="dense()"
    [scrollOwner]="owner()"
  >
    <button type="button" class="test-lead" leading>Panes</button>
    <button type="button" class="test-action" actions>Discard</button>
    <p class="test-field">projected</p>
  </form>`,
})
class Host {
  readonly model = signal({ subject: '' });
  readonly bar = signal<WriterBarPosition>('bottom');
  readonly dense = signal(true);
  readonly owner = signal(false);
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

  const send = () => root.querySelector('.writer-bar__send') as HTMLButtonElement;
  const bar = () => root.querySelector('.writer-bar') as HTMLElement;
  const writer = () => root.querySelector('form[email-writer]') as HTMLElement;
  const field = () => root.querySelector('.test-field') as HTMLElement;
  const follows = (a: Node, b: Node) =>
    !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
    root = fixture.nativeElement as HTMLElement;
  });

  it('is the form, with Send as its submit button first on the bar, the word and no glyph', () => {
    const writer = root.querySelector('form[email-writer]')!;
    expect(writer.getAttribute('novalidate')).not.toBeNull(); // the form root's
    expect(send().type).toBe('submit');
    expect(send().getAttribute('aria-label')).toBe('Send');
    expect(send().textContent?.trim()).toBe('Send');
    expect(send().querySelector('mat-icon')).toBeNull();
    expect(bar().firstElementChild).toBe(send());
  });

  it('follows Send with the leading controls, the spacer, and the actions last', () => {
    expect(send().nextElementSibling).toBe(root.querySelector('.test-lead'));
    expect(root.querySelector('.test-lead')?.nextElementSibling?.classList).toContain(
      'writer-bar__spacer',
    );
    expect(bar().lastElementChild).toBe(root.querySelector('.test-action'));
  });

  it('closes the sheet with the bar, under the fields, by default', () => {
    expect(bar().tagName).toBe('FOOTER');
    expect(follows(field(), bar())).toBe(true);
    // At the foot: the body runs on under it (the floating foot).
    expect(writer().getAttribute('data-bar')).toBe('bottom');
    expect(root.querySelectorAll('.writer-bar')).toHaveLength(1);
  });

  it('scrolls the body alone, or the whole sheet where it owns the scroll', async () => {
    expect(writer().getAttribute('data-scroll')).toBe('body');
    expect(writer().hasAttribute('data-scroll-owner')).toBe(false);
    // The phone's sheet, a document: the bar sticks, the envelope scrolls
    // away above the text, as Gmail's does — the writer is the scroller.
    host.owner.set(true);
    await fixture.whenStable();
    expect(writer().getAttribute('data-scroll')).toBe('sheet');
    expect(writer().hasAttribute('data-scroll-owner')).toBe(true);
    expect(writer().style.overflowY).toBe('auto');
  });

  it('sizes its bar for a pointer or a finger, as its host says', async () => {
    expect(writer().hasAttribute('data-dense')).toBe(true);
    host.dense.set(false);
    await fixture.whenStable();
    expect(writer().hasAttribute('data-dense')).toBe(false);
  });

  it('heads the sheet with the bar where its host asks — the same buttons, moved', async () => {
    const action = root.querySelector('.test-action');
    host.bar.set('top');
    await fixture.whenStable();
    expect(bar().tagName).toBe('HEADER');
    expect(follows(bar(), field())).toBe(true);
    expect(writer().getAttribute('data-bar')).toBe('top');
    expect(root.querySelectorAll('.writer-bar')).toHaveLength(1);
    // The host's action is its own node, carried along rather than re-created.
    expect(root.querySelector('.test-action')).toBe(action);

    host.bar.set('bottom');
    await fixture.whenStable();
    expect(bar().tagName).toBe('FOOTER');
    expect(root.querySelectorAll('.writer-bar')).toHaveLength(1);
  });

  it('mirrors the bar that heads the sheet: the actions first, Send at the end', async () => {
    host.bar.set('top');
    await fixture.whenStable();
    expect(bar().firstElementChild).toBe(root.querySelector('.test-action'));
    expect(root.querySelector('.test-action')?.nextElementSibling?.classList).toContain(
      'writer-bar__spacer',
    );
    expect(root.querySelector('.test-lead')?.nextElementSibling).toBe(send());
    expect(bar().lastElementChild).toBe(send());
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
