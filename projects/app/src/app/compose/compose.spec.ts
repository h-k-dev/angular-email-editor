import { signal } from '@angular/core';
import { TextSelection } from 'prosemirror-state';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Compose } from './compose';
import { Viewport } from '../../services/viewport';
import { EMAIL_SEND_LATENCY } from '../../services/email-send';
import {
  DRAFT_KEY,
  DRAFT_SAVE_DELAY,
  DraftContent,
  parseDraft,
  serializeDraft,
} from '../../services/draft';

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

// Every composer saves its draft when it goes: start each spec without one.
beforeEach(() => localStorage.clear());

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
    const pane = (component as any).sheet().emailPane();
    pane.value.set('<div>restored draft</div>');
    await fixture.whenStable(); // flush the pane's sync effect
    expect(pane.value()).toBe('<div>restored draft</div>');
    // Protected while focused: the typing surface must not be rewritten…
    expect(pm.textContent).not.toContain('restored draft');

    // …but the value is not lost: leaving the editor catches up.
    pm.blur();
    expect(pm.textContent).toContain('restored draft');
  });

  it('a write landing while the tab is in the background applies at once, though the editor is still the active element', async () => {
    const pm = fixture.nativeElement.querySelector('[aria-label="Message body"]') as HTMLElement;
    pm.focus();
    expect(document.activeElement).toBe(pm);

    // The window lost focus (another tab is in front); the editor did not
    // lose its place as the document's active element.
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    try {
      (component as any).sheet().emailPane().value.set('<div>saved in another tab</div>');
      await fixture.whenStable();
      expect(pm.textContent).toContain('saved in another tab');
    } finally {
      hasFocus.mockRestore();
    }
  });

  it("the writer bar's </> moves the HTML source into the editing surface's place and back", async () => {
    const root = fixture.nativeElement as HTMLElement;
    // The pane's home is the page wrapper, which is also the .eml import
    // dropzone (compose.html) — not the component host.
    const page = root.querySelector('.page') as HTMLElement;
    const editor = root.querySelector('.editor') as HTMLElement;
    const code = root.querySelector('.code') as HTMLElement;
    const source = root.querySelector('section[html-email-compose]') as HTMLElement;
    const sourceEditor = source.querySelector('[aria-label="Email HTML source"]');
    const toggle = root.querySelector(
      '.writer-bar [aria-label="HTML source"]',
    ) as HTMLButtonElement;
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

  it("the writer bar's formatting options button shows and hides the toolbar", async () => {
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector(
      '.writer-bar [aria-label="Formatting options"]',
    ) as HTMLButtonElement;
    const toolbar = root.querySelector('.toolbar') as HTMLElement;

    // Shown by default, pressed.
    expect(toolbar.hidden).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('true');

    button.click();
    await fixture.whenStable();
    expect(toolbar.hidden).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('false');

    button.click();
    await fixture.whenStable();
    expect(toolbar.hidden).toBe(false);
  });

  it('the font dropdowns lead the toolbar and apply the curated choice from their Aria menu', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const row = root.querySelector('.toolbar__scroll') as HTMLElement;
    const family = row.querySelector('.toolbar__select--family') as HTMLButtonElement;
    const size = row.querySelector('.toolbar__select--size') as HTMLButtonElement;
    expect(row.firstElementChild).toBe(family);
    // Never a "default": the value in effect, or nothing yet.
    expect(family.textContent).not.toContain('Default');
    expect(size.getAttribute('aria-haspopup')).toBe('true');

    // Opens the menu from its trigger and picks the item — the menus render
    // in the CDK overlay container, outside the component.
    const choose = async (trigger: HTMLButtonElement, label: string) => {
      trigger.click();
      await fixture.whenStable();
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
        (el) => el.textContent?.trim().startsWith(label),
      );
      expect(item).toBeDefined();
      item!.click();
      await fixture.whenStable();
    };

    await choose(size, '18px');
    expect(size.textContent).toContain('18');
    expect(size.getAttribute('aria-expanded')).toBe('false');
    await choose(family, 'Serif');
    expect(family.textContent).toContain('Serif');
  });

  it('the text colour button reads as applied for a colour, not for the font or size that share its mark', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const color = root.querySelector('.toolbar [aria-label="Text color"]') as HTMLButtonElement;
    const size = root.querySelector('.toolbar__select--size') as HTMLButtonElement;

    // A size at the caret: the same textStyle mark, without a colour.
    size.click();
    await fixture.whenStable();
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((el) =>
      el.textContent?.trim().startsWith('18px'),
    );
    item!.click();
    await fixture.whenStable();
    expect(size.textContent).toContain('18');
    expect(color.hasAttribute('data-applied')).toBe(false);

    // A swatch from its palette: now the colour is on.
    color.click();
    await fixture.whenStable();
    expect(color.getAttribute('aria-expanded')).toBe('true');
    const swatch = document.querySelector(
      '[color-palette] [aria-label="Red"]',
    ) as HTMLButtonElement;
    swatch.click();
    await fixture.whenStable();
    expect(color.hasAttribute('data-applied')).toBe(true);
    expect(color.getAttribute('aria-expanded')).toBe('false');
  });

  it('the link buttons open the link editor at the selection, through the shared commands', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const pane = (component as any).sheet().emailPane();
    pane.value.set('<p>see the docs</p>');
    await fixture.whenStable();
    const editor = pane.editor();
    // jsdom has no layout: the anchor at the selection is measured from a
    // rect the test supplies.
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({
      left: 40,
      right: 40,
      top: 100,
      bottom: 120,
    });
    // Select "docs": the link editor opens only on a selection or in a link.
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 9, 13)),
    );
    await fixture.whenStable();

    const dialog = () => document.querySelector('[role="dialog"][aria-label="Edit link"]');
    expect(dialog()).toBeNull();
    (root.querySelector('.toolbar [aria-label="Link"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(dialog()).not.toBeNull();

    // Applying a scheme-less URL links the selection with https.
    const input = dialog()!.querySelector('input') as HTMLInputElement;
    input.value = 'example.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    (dialog()!.querySelector('[aria-label="Apply link"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(dialog()).toBeNull();
    expect(pane.value()).toContain('href="https://example.com"');
  });

  it('the link editor selects its field as it opens; Escape closes from any of it, never an IME’s', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const pane = (component as any).sheet().emailPane();
    pane.value.set('<p>see the docs</p>');
    await fixture.whenStable();
    const editor = pane.editor();
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({
      left: 40,
      right: 40,
      top: 100,
      bottom: 120,
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 9, 13)),
    );
    await fixture.whenStable();

    const dialog = () => document.querySelector('[role="dialog"][aria-label="Edit link"]');
    const openIt = async () => {
      (root.querySelector('.toolbar [aria-label="Link"]') as HTMLButtonElement).click();
      await fixture.whenStable();
    };
    const key = (target: Element, key: string, init: KeyboardEventInit = {}) =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
      );

    await openIt();
    const input = dialog()!.querySelector('input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('dir')).toBe('ltr');

    // An IME's Enter confirms its text; it neither applies nor closes.
    input.value = 'example.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    key(input, 'Enter', { isComposing: true });
    key(input, 'Escape', { isComposing: true });
    await fixture.whenStable();
    expect(dialog()).not.toBeNull();
    expect(pane.value()).not.toContain('href=');

    // Escape on the Apply button closes too, and applies nothing.
    key(dialog()!.querySelector('[aria-label="Apply link"]')!, 'Escape');
    await fixture.whenStable();
    expect(dialog()).toBeNull();
    expect(pane.value()).not.toContain('href=');
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
    (component as any).sheet().emailPane().value.set('<div>hello</div>');
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

    (component as any).sheet().message.update((m: object) => ({ ...m, to: ['ada@example.com'] }));
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
    expect((component as any).sheet().message().bcc).toEqual(['grace@example.com']);
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
    (component as any).sheet().message.update((m: object) => ({
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
    (component as any).sheet().message.update((m: object) => ({ ...m, to: ['ada@example.com'] }));
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
    (component as any).sheet().emailPane().value.set('<div>hello</div>');
    pm.blur();
    (component as any)
      .sheet()
      .message.update((m: object) => ({ ...m, to: ['bounce@example.com'] }));
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
    const toggle = root.querySelector('.writer-bar [aria-label="Preview"]') as HTMLButtonElement;
    // The page's controls, not the editor's: the formatting toolbar holds
    // formatting alone — no view toggles.
    const toolbar = root.querySelector('.toolbar') as HTMLElement;
    for (const label of ['Preview', 'HTML source', 'Detach HTML source']) {
      expect(toolbar.querySelector(`[aria-label="${label}"]`)).toBeNull();
    }

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
  it('drops the pane toggles from the writer bar and collapses a docked pane', async () => {
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
      root.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;

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

  it('folds code view at a phone width, where the bar offers no </> to leave it', async () => {
    const compact = signal(false);
    await TestBed.configureTestingModule({
      imports: [Compose],
      providers: [
        {
          provide: Viewport,
          useValue: { narrow: compact.asReadonly(), compact: compact.asReadonly() },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Compose);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const editor = root.querySelector('.editor') as HTMLElement;

    (root.querySelector('.writer-bar [aria-label="HTML source"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(editor.hidden).toBe(true);

    compact.set(true);
    await fixture.whenStable();
    expect(editor.hidden).toBe(false);
    expect(root.querySelector('section[html-email-compose]')?.hasAttribute('hidden')).toBe(true);
    expect(root.querySelector('[aria-label="HTML source"]')).toBeNull();
  });

  it('keeps the formatting toolbar on a phone, with no switch to hide it', async () => {
    const compact = signal(false);
    await TestBed.configureTestingModule({
      imports: [Compose],
      providers: [
        {
          provide: Viewport,
          useValue: { narrow: compact.asReadonly(), compact: compact.asReadonly() },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Compose);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const toolbar = root.querySelector('.toolbar') as HTMLElement;
    const toggle = () =>
      root.querySelector(
        '.writer-bar [aria-label="Formatting options"]',
      ) as HTMLButtonElement | null;

    // Wide: switched off.
    toggle()!.click();
    await fixture.whenStable();
    expect(toolbar.hidden).toBe(true);

    // Phone: the toolbar is back and the switch is gone.
    compact.set(true);
    await fixture.whenStable();
    expect(toolbar.hidden).toBe(false);
    expect(toggle()).toBeNull();

    // Wide again: the choice made there still holds.
    compact.set(false);
    await fixture.whenStable();
    expect(toolbar.hidden).toBe(true);
    expect(toggle()!.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('Compose drafts', () => {
  const draft = (overrides: Partial<DraftContent> = {}): DraftContent => ({
    from: ['you@example.com'],
    to: ['ada@example.com'],
    cc: [],
    bcc: [],
    subject: 'Plans',
    html: '<div>restored body</div>',
    attachments: [],
    ...overrides,
  });
  const stored = () => parseDraft(localStorage.getItem(DRAFT_KEY));

  const start = async (saveDelay = 0) => {
    await TestBed.configureTestingModule({
      imports: [Compose],
      providers: [
        { provide: EMAIL_SEND_LATENCY, useValue: 0 },
        { provide: DRAFT_SAVE_DELAY, useValue: saveDelay },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Compose);
    await fixture.whenStable();
    return {
      fixture,
      component: (fixture.componentInstance as any).sheet(),
      root: fixture.nativeElement as HTMLElement,
    };
  };

  /** Another tab saving (or removing) the draft. */
  const otherTab = (content: DraftContent | null) => {
    const value = serializeDraft(content);
    if (value === null) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, value);
    window.dispatchEvent(
      new StorageEvent('storage', { key: DRAFT_KEY, newValue: value, storageArea: localStorage }),
    );
  };

  it('opens with the stored draft: rows, body and attachments — and keeps it', async () => {
    localStorage.setItem(
      DRAFT_KEY,
      serializeDraft(draft({ attachments: [{ id: 'att_kept', name: 'plan.pdf', size: 12 }] }))!,
    );
    const { component, root } = await start();
    await settle();

    const message = component.message();
    expect(message.to).toEqual(['ada@example.com']);
    expect((root.querySelector('input[id^="message-subject-"]') as HTMLInputElement).value).toBe(
      'Plans',
    );
    expect(root.querySelector('[aria-label="Message body"]')?.textContent).toContain(
      'restored body',
    );
    expect(message.attachments).toEqual([
      expect.objectContaining({ id: 'att_kept', name: 'plan.pdf' }),
    ]);
    expect(component.uploads.status(message.attachments[0].key)()).toBe('complete');
    // Mounting the editor must not have published an empty body over it.
    expect(stored()?.html).toBe(message.html);
    expect(stored()?.html).toContain('restored body');
  });

  it('saves the message once it rests, and removes the draft once there is nothing left to keep', async () => {
    const { fixture, component, root } = await start();
    expect(stored()).toBeNull();

    component.message.update((m: object) => ({ ...m, subject: 'Hello' }));
    await vi.waitFor(() => expect(stored()?.subject).toBe('Hello'));
    await fixture.whenStable();
    expect(root.querySelector('[aria-label="Draft"]')?.textContent).toContain('Draft saved');

    component.message.update((m: object) => ({ ...m, subject: '' }));
    await vi.waitFor(() => expect(stored()).toBeNull());
    await fixture.whenStable();
    expect(root.querySelector('[aria-label="Draft"]')).toBeNull();
  });

  it('leaves an attachment still uploading out of the draft', async () => {
    const { component } = await start();
    const pending = component.uploads.start({ name: 'big.zip', size: 1024 });
    component.message.update((m: object) => ({
      ...m,
      subject: 'With files',
      attachments: [pending],
    }));
    await vi.waitFor(() => expect(stored()?.subject).toBe('With files'));
    expect(stored()?.attachments).toEqual([]);
  });

  it('saves at once when the composer goes, without waiting for the message to rest', async () => {
    const { fixture, component } = await start(60_000);
    component.message.update((m: object) => ({ ...m, subject: 'Leaving' }));
    await fixture.whenStable();
    expect(stored()).toBeNull();
    fixture.destroy();
    expect(stored()?.subject).toBe('Leaving');
  });

  it('takes in a draft another tab saved, keeping the uploads still under way here', async () => {
    const { fixture, component, root } = await start();
    const pending = component.uploads.start({ name: 'big.zip', size: 1024 });
    component.message.update((m: object) => ({ ...m, attachments: [pending] }));
    await fixture.whenStable();

    otherTab(draft({ subject: 'From the other tab' }));
    await fixture.whenStable();
    expect(component.message().subject).toBe('From the other tab');
    expect(component.message().attachments).toEqual([pending]);
    expect(root.querySelector('[aria-label="Message body"]')?.textContent).toContain(
      'restored body',
    );

    // That tab sent it: this sheet clears too.
    otherTab(null);
    await fixture.whenStable();
    expect(component.message().subject).toBe('');
    expect(component.message().to).toEqual([]);
  });

  it('a send clears the sheet and the draft; the receipt stays until the next message starts', async () => {
    const { fixture, component, root } = await start();
    const pm = root.querySelector('[aria-label="Message body"]') as HTMLElement;
    pm.focus();
    component.emailPane().value.set('<div>hello</div>');
    pm.blur();
    component.message.update((m: object) => ({ ...m, to: ['ada@example.com'] }));
    await vi.waitFor(() => expect(stored()?.to).toEqual(['ada@example.com']));

    (root.querySelector('.writer-bar__send') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(stored()).toBeNull());
    await fixture.whenStable();
    expect(component.message().to).toEqual([]);
    expect(pm.textContent?.trim()).toBe('');
    expect(root.querySelector('[aria-label="Form problem"]')).toBeNull();
    expect(root.querySelector('[aria-label="Last send"]')?.textContent).toContain('Sent msg_1');

    component.message.update((m: object) => ({ ...m, subject: 'Next one' }));
    await fixture.whenStable();
    expect(root.querySelector('[aria-label="Last send"]')).toBeNull();
  });

  it('Discard throws the draft away and starts over', async () => {
    localStorage.setItem(DRAFT_KEY, serializeDraft(draft())!);
    const { fixture, component, root } = await start();
    const discard = root.querySelector('[aria-label="Discard draft"]') as HTMLButtonElement;
    // In the writer's bar, beside Send.
    expect(discard.closest('.writer-bar')).toBe(
      root.querySelector('.writer-bar__send')?.closest('.writer-bar'),
    );

    discard.click();
    await settle();
    await fixture.whenStable();
    expect(stored()).toBeNull();
    expect(component.message().subject).toBe('');
    expect(root.querySelector('[aria-label="Message body"]')?.textContent).not.toContain(
      'restored body',
    );
  });
});
