import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Compose } from './compose';
import { Viewport } from '../viewport';
import { EMAIL_SEND_LATENCY } from '../../services/email-send';

/** Lets the mock transport's (zero-latency) timer and the submit settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// jsdom lacks what the textMetrics extension needs at editor mount
// (ResizeObserver, a canvas 2D context for glyph measurement) — without the
// stubs, createEditor throws mid-mount and the email pane silently never
// wires up in tests.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const context2dStub = {
  font: '',
  measureText: (text: string) => ({ width: text.length * 7 }),
};
HTMLCanvasElement.prototype.getContext = (() => context2dStub) as never;

describe('Compose', () => {
  let component: Compose;
  let fixture: ComponentFixture<Compose>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Compose],
      providers: [{ provide: EMAIL_SEND_LATENCY, useValue: 0 }],
    }).compileComponents();

    fixture = TestBed.createComponent(Compose);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('an external html write during focus applies on blur — a draft restore is never dropped', async () => {
    // Put the user "in" the editor (mount focuses it too, but not reliably
    // under the test harness — make it explicit).
    // Two editor roots live on the page (body + source): name the one meant.
    const pm = fixture.nativeElement.querySelector('[aria-label="Message body"]') as HTMLElement;
    pm.focus();
    expect(document.activeElement).toBe(pm);

    // A draft restore (or import) lands while the user is "in" the editor —
    // written to the pane's model, the exact surface a host binds against.
    const pane = (component as any).emailPane();
    pane.value.set('<div>restored draft</div>');
    await fixture.whenStable(); // flush the pane's sync effect
    expect(pane.value()).toBe('<div>restored draft</div>');
    // Protected while focused: the typing surface must not be rewritten…
    expect(pm.textContent).not.toContain('restored draft');

    // …but the value is not lost: leaving the editor catches up.
    pm.blur();
    expect(pm.textContent).toContain('restored draft');
  });

  it("the toolbar's </> moves the HTML source into the editing surface's place and back", async () => {
    const root = fixture.nativeElement as HTMLElement;
    // The pane's home is the page wrapper, which is also the .eml import
    // dropzone (compose.html) — not the component host.
    const page = root.querySelector('.page') as HTMLElement;
    const editor = root.querySelector('.editor') as HTMLElement;
    const code = root.querySelector('.code') as HTMLElement;
    const source = root.querySelector('section[html-email-compose]') as HTMLElement;
    const sourceEditor = source.querySelector('[aria-label="Email HTML source"]');
    const toggle = root.querySelector('[aria-label="HTML source"]') as HTMLButtonElement;
    const bold = root.querySelector('.toolbar [aria-label="Bold"]') as HTMLButtonElement;
    const quote = root.querySelector('.toolbar [aria-label="Quote"]') as HTMLButtonElement;
    const send = root.querySelector('.writer-bar__send') as HTMLButtonElement;

    // Hidden by default, in its own column (a sibling of the composer).
    expect(source.hidden).toBe(true);
    expect(source.parentElement).toBe(page);
    expect(editor.hidden).toBe(false);
    expect(code.hidden).toBe(true);

    toggle.click();
    await fixture.whenStable();
    // The very same node moved into the code slot — not a re-created pane.
    expect(source.hidden).toBe(false);
    expect(code.contains(source)).toBe(true);
    expect(source.querySelector('[aria-label="Email HTML source"]')).toBe(sourceEditor);
    expect(editor.hidden).toBe(true);
    expect(code.hidden).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    // Marks route to the source pane (its kit mirrors them) and Send lives
    // in the writer's bar — both stay live; block commands have no source
    // twin and lock.
    expect(bold.disabled).toBe(false);
    expect(quote.disabled).toBe(true);
    expect(send.disabled).toBe(false);
    expect(root.querySelector('.toolbar [aria-label="Send"]')).toBeNull();

    toggle.click();
    await fixture.whenStable();
    // …and back home, hidden again.
    expect(source.parentElement).toBe(page);
    expect(source.hidden).toBe(true);
    expect(editor.hidden).toBe(false);
    expect(code.hidden).toBe(true);
    expect(quote.disabled).toBe(false);
  });

  it('detach shows the HTML source beside the editor; the two buttons switch each other', async () => {
    const root = fixture.nativeElement as HTMLElement;
    // The pane's home is the page wrapper, which is also the .eml import
    // dropzone (compose.html) — not the component host.
    const page = root.querySelector('.page') as HTMLElement;
    const editor = root.querySelector('.editor') as HTMLElement;
    const code = root.querySelector('.code') as HTMLElement;
    const source = root.querySelector('section[html-email-compose]') as HTMLElement;
    const detach = root.querySelector('[aria-label="Detach HTML source"]') as HTMLButtonElement;
    const codeToggle = root.querySelector('[aria-label="HTML source"]') as HTMLButtonElement;
    const quote = root.querySelector('.toolbar [aria-label="Quote"]') as HTMLButtonElement;

    detach.click();
    await fixture.whenStable();
    expect(root.classList.contains('compose--detached')).toBe(true);
    expect(source.hidden).toBe(false);
    expect(source.parentElement).toBe(page); // its own column, not the slot
    expect(editor.hidden).toBe(false); // the editor stays, and stays the target
    expect(quote.disabled).toBe(false);
    expect(detach.getAttribute('aria-pressed')).toBe('true');

    // Pressing the other button switches views rather than stacking them.
    codeToggle.click();
    await fixture.whenStable();
    expect(root.classList.contains('compose--detached')).toBe(false);
    expect(code.contains(source)).toBe(true);
    expect(detach.getAttribute('aria-pressed')).toBe('false');

    detach.click();
    await fixture.whenStable();
    expect(code.contains(source)).toBe(false);
    expect(root.classList.contains('compose--detached')).toBe(true);

    // Pressing the active one again hides the source.
    detach.click();
    await fixture.whenStable();
    expect(root.classList.contains('compose--detached')).toBe(false);
    expect(source.hidden).toBe(true);
  });

  it('Send submits the one form: held and explained while the envelope is incomplete, delivered once it is', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const pm = root.querySelector('[aria-label="Message body"]') as HTMLElement;
    const send = root.querySelector('.writer-bar__send') as HTMLButtonElement;
    const toRow = root.querySelectorAll('[email-address-input]')[1];
    // A body, so the only thing missing is a recipient.
    pm.focus();
    (component as any).emailPane().value.set('<div>hello</div>');
    pm.blur();
    await fixture.whenStable();
    expect(send.type).toBe('submit');

    send.click();
    await settle();
    await fixture.whenStable();
    // Nothing went out; the strip says why, and the To row wears it.
    expect(root.querySelector('[aria-label="Last send"]')).toBeNull();
    expect(root.querySelector('[aria-label="Form problem"]')?.textContent).toContain(
      'Add at least one address',
    );
    expect(toRow.getAttribute('data-invalid')).toBe('true');
    // …and the caret is in it: the form focused the control bound to the
    // first field with an error.
    expect(document.activeElement).toBe(toRow.querySelector('[data-slot=input]'));

    (component as any).message.update((m: object) => ({ ...m, to: ['ada@example.com'] }));
    await fixture.whenStable();
    expect(root.querySelector('[aria-label="Form problem"]')).toBeNull();

    send.click();
    await settle();
    await fixture.whenStable();
    // The transport's receipt: envelope and body, as a real host would hand its mailer.
    const note = root.querySelector('[aria-label="Last send"]')?.textContent ?? '';
    expect(note).toContain('Sent msg_1');
    expect(note).toContain('to 1 recipient');
    expect(note).toContain('no subject');
  });

  it('Cc and Bcc sit on the To row like Gmail: each opens its row focused, and an empty row folds back', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const labels = () =>
      [...root.querySelectorAll('.writer-field__label')].map((el) => el.textContent?.trim());
    const actions = () =>
      [...root.querySelectorAll('.writer-field__action')].map((el) => el.textContent?.trim());
    const action = (name: string) =>
      [...root.querySelectorAll<HTMLButtonElement>('.writer-field__action')].find(
        (el) => el.textContent?.trim() === name,
      )!;
    const row = (label: string) =>
      [...root.querySelectorAll<HTMLElement>('.writer-field')].find(
        (el) => el.querySelector('.writer-field__label')?.textContent?.trim() === label,
      )!;

    expect(labels()).toEqual(['From', 'To', 'Subject']);
    expect(actions()).toEqual(['Cc', 'Bcc']);
    expect(action('Cc').type).toBe('button');

    action('Cc').click();
    await fixture.whenStable();
    expect(labels()).toEqual(['From', 'To', 'Cc', 'Subject']);
    expect(actions()).toEqual(['Bcc']);
    const ccInput = row('Cc').querySelector<HTMLInputElement>('[data-slot=input]')!;
    expect(document.activeElement).toBe(ccInput);

    // The button never takes focus: it is removed as its row opens, and a
    // removed focused element would leave focus nowhere.
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    action('Bcc').dispatchEvent(mousedown);
    expect(mousedown.defaultPrevented).toBe(true);

    // Moving to another recipient row keeps it open, and so does focus going
    // nowhere (the window losing focus)…
    const toInput = row('To').querySelector<HTMLInputElement>('[data-slot=input]')!;
    row('Cc').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: toInput }));
    await fixture.whenStable();
    expect(labels()).toEqual(['From', 'To', 'Cc', 'Subject']);
    row('Cc').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    await fixture.whenStable();
    expect(labels()).toEqual(['From', 'To', 'Cc', 'Subject']);

    // …leaving the recipients for somewhere real, with it empty, folds it back.
    const subject = root.querySelector<HTMLInputElement>('.writer-field__input')!;
    row('Cc').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: subject }));
    await fixture.whenStable();
    expect(labels()).toEqual(['From', 'To', 'Subject']);
    expect(actions()).toEqual(['Cc', 'Bcc']);

    // With an address in it, it stays — and it is in the model.
    action('Bcc').click();
    await fixture.whenStable();
    const bccInput = row('Bcc').querySelector<HTMLInputElement>('[data-slot=input]')!;
    bccInput.value = 'grace@example.com';
    bccInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    row('Bcc').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: subject }));
    await fixture.whenStable();
    expect(labels()).toEqual(['From', 'To', 'Bcc', 'Subject']);
    expect(actions()).toEqual(['Cc']);
    expect((component as any).message().bcc).toEqual(['grace@example.com']);
  });

  it('starts with the caret in To, and tabs From, Cc, Bcc, To, Subject', async () => {
    const root = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    const toInput = root
      .querySelectorAll('[email-address-input]')[1]
      .querySelector<HTMLInputElement>('[data-slot=input]')!;
    expect(document.activeElement).toBe(toInput);

    // Source order is tab order: the copy buttons precede the To control,
    // and CSS draws them last.
    const row = toInput.closest('.writer-field')!;
    const actions = row.querySelector('.writer-field__actions')!;
    const control = row.querySelector('[email-address-input]')!;
    expect(
      actions.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(getComputedStyle(actions).order).toBe('1');
  });

  it('To, Cc and Bcc merge into one line while focus is elsewhere and a copy row is there, and open again on focus', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const group = root.querySelector<HTMLElement>('.writer-recipients')!;
    const summary = () => root.querySelector<HTMLElement>('.writer-summary');
    const toInput = root
      .querySelectorAll('[email-address-input]')[1]
      .querySelector<HTMLInputElement>('[data-slot=input]')!;
    const subject = root.querySelector<HTMLInputElement>('.writer-field__input')!;

    // Nothing but To, focus elsewhere: the row is its own line, and there is
    // nothing to merge — its placeholder stays put when focus arrives.
    expect(group.classList).not.toContain('writer-recipients--merged');
    expect(summary()).toBeNull();

    // The caret starts in To: take focus elsewhere, then give the message a Bcc.
    subject.focus();
    (component as any).message.update((m: object) => ({
      ...m,
      to: ['Ada Lovelace <ada@example.com>', 'hong@iusta'],
      bcc: ['grace@example.com'],
    }));
    await fixture.whenStable();
    // A Bcc beside To: one quiet line, hidden from assistive tech.
    expect(group.classList).toContain('writer-recipients--merged');
    expect(summary()?.getAttribute('aria-hidden')).toBe('true');
    const line = summary()!.querySelector('.writer-summary__line')!;
    expect(
      [...line.querySelectorAll('.writer-summary__person, .writer-summary__kind')].map((el) =>
        el.textContent?.trim(),
      ),
    ).toEqual(['Ada Lovelace', 'hong@iusta', 'Bcc', 'grace@example.com']);
    expect(line.textContent?.replace(/\s+/g, ' ')).toContain('Ada Lovelace, hong@iusta');
    expect(summary()!.querySelector('.writer-summary__label')?.textContent?.trim()).toBe('To');
    expect(
      [...line.querySelectorAll('.writer-summary__person--invalid')].map((el) => el.textContent),
    ).toEqual(['hong@iusta']);

    // A click on the line puts the caret in To, and the focus opens the rows.
    summary()!.click();
    await fixture.whenStable();
    expect(document.activeElement).toBe(toInput);
    expect(group.classList).not.toContain('writer-recipients--merged');
    expect(summary()).toBeNull();

    // Focus going nowhere keeps them open; leaving for somewhere real merges.
    toInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    await fixture.whenStable();
    expect(summary()).toBeNull();
    subject.focus();
    await fixture.whenStable();
    expect(group.classList).toContain('writer-recipients--merged');

    // Tab (any focus) into a hidden row opens them too — the rows never unmount.
    toInput.focus();
    await fixture.whenStable();
    expect(summary()).toBeNull();
  });

  it('a body problem focuses the editor, out of code view if need be', async () => {
    const root = fixture.nativeElement as HTMLElement;
    (component as any).message.update((m: object) => ({ ...m, to: ['ada@example.com'] }));
    await fixture.whenStable();
    (root.querySelector('[aria-label="HTML source"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect((root.querySelector('.code') as HTMLElement).hidden).toBe(false);

    (root.querySelector('.writer-bar__send') as HTMLButtonElement).click();
    await settle();
    await fixture.whenStable();
    expect(root.querySelector('[aria-label="Form problem"]')?.textContent).toContain(
      'Write something',
    );
    expect((root.querySelector('.code') as HTMLElement).hidden).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('[aria-label="Message body"]'));
  });

  it('a rejection the server pins on an address comes back onto the To row', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const pm = root.querySelector('[aria-label="Message body"]') as HTMLElement;
    pm.focus();
    (component as any).emailPane().value.set('<div>hello</div>');
    pm.blur();
    (component as any).message.update((m: object) => ({ ...m, to: ['bounce@example.com'] }));
    await fixture.whenStable();

    (root.querySelector('.writer-bar__send') as HTMLButtonElement).click();
    await settle();
    await fixture.whenStable();
    expect(root.querySelector('[aria-label="Last send"]')).toBeNull();
    const toRow = root.querySelectorAll('[email-address-input]')[1];
    expect(toRow.getAttribute('data-invalid')).toBe('true');
    // The wording is the composer's, in its strip — the row only wears the state.
    expect(root.querySelector('[aria-label="Form problem"]')?.textContent).toContain(
      'bounce@example.com was rejected',
    );
  });

  it('the preview is a detachable pane too — hidden by default, docked to the left', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const preview = root.querySelector('section[email-preview]') as HTMLElement;
    const composer = root.querySelector('section[email-compose]') as HTMLElement;
    const toggle = root.querySelector('.toolbar [aria-label="Preview"]') as HTMLButtonElement;

    expect(preview.hidden).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    toggle.click();
    await fixture.whenStable();
    expect(preview.hidden).toBe(false);
    expect(root.classList.contains('compose--preview')).toBe(true);
    // To the left: before the composer, in DOM as on screen.
    expect(
      preview.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    toggle.click();
    await fixture.whenStable();
    expect(preview.hidden).toBe(true);
  });
});

describe('Compose below the docking breakpoint', () => {
  it('drops the dock-out buttons from the toolbar and collapses a docked pane', async () => {
    const narrow = signal(false);
    await TestBed.configureTestingModule({
      imports: [Compose],
      providers: [
        {
          provide: Viewport,
          useValue: { narrow: narrow.asReadonly(), compact: signal(false).asReadonly() },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Compose);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const btn = (label: string) =>
      root.querySelector(`.toolbar [aria-label="${label}"]`) as HTMLButtonElement | null;

    // Wide: dock the preview and the source.
    btn('Preview')!.click();
    btn('Detach HTML source')!.click();
    await fixture.whenStable();
    expect(root.classList.contains('compose--detached')).toBe(true);
    expect(root.classList.contains('compose--preview')).toBe(true);

    // Narrow: the options are gone, the docked panes collapse — code view's
    // button (in place) stays.
    narrow.set(true);
    await fixture.whenStable();
    expect(btn('Preview')).toBeNull();
    expect(btn('Detach HTML source')).toBeNull();
    expect(btn('HTML source')).not.toBeNull();
    expect(root.classList.contains('compose--detached')).toBe(false);
    expect(root.classList.contains('compose--preview')).toBe(false);
    // The status strip is desktop chrome.
    expect(root.querySelector('footer.status')).toBeNull();

    // Wide again: the options return; nothing re-docks by itself.
    narrow.set(false);
    await fixture.whenStable();
    expect(btn('Preview')).not.toBeNull();
    expect(root.classList.contains('compose--preview')).toBe(false);
    expect(root.querySelector('footer.status')).not.toBeNull();
  });
});
