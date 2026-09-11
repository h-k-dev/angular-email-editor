import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form } from '@angular/forms/signals';
import { By } from '@angular/platform-browser';
import { AddressChipRemove } from '../address-chip/address-chip.slots';
import { AddressInput } from './address-input';
import {
  ADDRESS_LIST_EMPTY,
  ADDRESS_LIST_INVALID,
  ADDRESS_LIST_TOO_MANY,
  addressList,
} from './address-rules';

function parts(root: HTMLElement) {
  return {
    field: () =>
      root.matches('[email-address-input]')
        ? root
        : root.querySelector<HTMLElement>('[email-address-input]')!,
    chips: () => [...root.querySelectorAll<HTMLElement>('[email-address-chip]')],
    entry: () => root.querySelector<HTMLElement>('[data-slot=entry]')!,
    input: () => root.querySelector<HTMLInputElement>('[data-slot=input]')!,
  };
}

function key(input: HTMLInputElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });
  input.dispatchEvent(event);
  return event;
}

function type(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function paste(input: HTMLInputElement, text: string): Event {
  const event = new Event('paste', { cancelable: true, bubbles: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
  input.dispatchEvent(event);
  return event;
}

/** A host the way a writer without a form uses it: its own label in its own
    row, two-way value, a cap. */
@Component({
  imports: [AddressInput],
  template: `<span id="to-label">To</span>
    <div
      email-address-input
      aria-labelledby="to-label"
      placeholder="Recipients"
      [limit]="max()"
      [disabled]="disabled()"
      [(value)]="addresses"
      (touch)="touches = touches + 1"
    ></div>`,
})
class Host {
  readonly addresses = signal<string[]>([]);
  readonly max = signal(Infinity);
  readonly disabled = signal(false);
  touches = 0;
}

describe('AddressInput', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let part: ReturnType<typeof parts>;
  const control = () =>
    fixture.debugElement.query(By.directive(AddressInput)).componentInstance as AddressInput;
  /** What a host's own Edit control does: the chip's address, to the API. */
  const editChip = (chip: Element) => control().edit(chip.getAttribute('title')!);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
    part = parts(fixture.nativeElement);
  });

  it('owns no label: the host names the input through aria-labelledby; placeholder set, no chips', () => {
    expect(part.field().querySelector('[data-slot=label]')).toBeNull();
    expect(part.field().hasAttribute('role')).toBe(false);
    expect(part.input().getAttribute('aria-labelledby')).toBe('to-label');
    expect(part.input().placeholder).toBe('Recipients');
    expect(part.chips().length).toBe(0);
  });

  it('commits on Enter, comma and semicolon, clearing the input and swallowing the key', async () => {
    type(part.input(), 'ada@example.com');
    expect(key(part.input(), 'Enter').defaultPrevented).toBe(true);
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com']);
    expect(part.input().value).toBe('');
    expect(part.input().placeholder).toBe('');

    type(part.input(), 'grace@example.com');
    key(part.input(), ',');
    type(part.input(), 'linus@example.com');
    key(part.input(), ';');
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com', 'grace@example.com', 'linus@example.com']);
    expect(part.chips().length).toBe(3);
  });

  it('Tab on an address commits it and stays; Tab on nothing or a typo leaves', () => {
    part.input().focus();
    type(part.input(), 'ada@example.com');
    expect(key(part.input(), 'Tab').defaultPrevented).toBe(true);
    expect(host.addresses()).toEqual(['ada@example.com']);
    expect(part.input().value).toBe('');

    // Nothing typed: Tab moves on.
    expect(key(part.input(), 'Tab').defaultPrevented).toBe(false);
    // A typo alone: Tab moves on too — leaving commits and flags it.
    type(part.input(), 'not-an-address');
    expect(key(part.input(), 'Tab').defaultPrevented).toBe(false);
    // Backwards never commits.
    type(part.input(), 'grace@example.com');
    const back = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      cancelable: true,
      bubbles: true,
    });
    part.input().dispatchEvent(back);
    expect(back.defaultPrevented).toBe(false);
    expect(host.addresses()).toEqual(['ada@example.com']);
  });

  it('swallows Enter even with nothing typed, so it never submits a form', () => {
    expect(key(part.input(), 'Enter').defaultPrevented).toBe(true);
  });

  it('commits on blur and reports the touch', async () => {
    type(part.input(), 'ada@example.com');
    part.input().dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com']);
    expect(host.touches).toBe(1);
  });

  it('splits a pasted run into chips, deduplicated, and keeps a display name whole', async () => {
    host.addresses.set(['ada@example.com']);
    await fixture.whenStable();
    const event = paste(part.input(), 'ada@example.com, "Hopper, Grace" <grace@example.com>');
    expect(event.defaultPrevented).toBe(true);
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com', '"Hopper, Grace" <grace@example.com>']);
    expect(part.chips()[1].querySelector('[data-slot=name]')?.textContent?.trim()).toBe(
      'Hopper, Grace',
    );
  });

  it('leaves a single pasted token to the input', () => {
    expect(paste(part.input(), 'Ada Lovelace <ada@example.com>').defaultPrevented).toBe(false);
  });

  it('makes chips only of addresses while typing: the rest stays in the input, flagged', async () => {
    part.input().focus();
    type(part.input(), 'ada@example.com, not-an-address');
    key(part.input(), 'Enter');
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com']);
    expect(part.input().value).toBe('not-an-address');
    expect(part.input().getAttribute('aria-invalid')).toBe('true');
    expect(part.input().hasAttribute('data-refused')).toBe(true);

    // Editing clears the flag; a further commit judges again.
    type(part.input(), 'not-an-addres');
    await fixture.whenStable();
    expect(part.input().hasAttribute('data-refused')).toBe(false);

    // A paste joins its own leftovers to what the input holds.
    paste(part.input(), 'grace@example.com, nope');
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com', 'grace@example.com']);
    expect(part.input().value).toBe('not-an-addres, nope');
  });

  it('commits a typo on leaving, so the form sees it, and hands it back to the input on focus', async () => {
    host.addresses.set(['ada@example.com']);
    part.input().focus();
    type(part.input(), 'grace@example');
    key(part.input(), 'Enter');
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com']);

    part.input().blur();
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com', 'grace@example']);
    expect(part.chips()[1].getAttribute('data-invalid')).toBe('true');
    expect(part.input().value).toBe('');
    expect(host.touches).toBe(1);

    part.input().focus();
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com']);
    expect(part.input().value).toBe('grace@example');
    // Back as plain typing: the caret is on it, the next commit judges it.
    expect(part.input().hasAttribute('data-refused')).toBe(false);
  });

  it('reads as a line of text until focused, then shows chips with their remove buttons', async () => {
    host.addresses.set(['ada@example.com', 'grace@example.com']);
    await fixture.whenStable();
    expect(part.field().hasAttribute('data-focused')).toBe(false);
    expect(part.chips().every((chip) => chip.hasAttribute('data-inline'))).toBe(true);
    // The buttons are there, out of the tab order (the arrow keys reach
    // the chips), still focusable by script.
    const button = part.chips()[0].querySelector<HTMLButtonElement>('[data-slot=remove]')!;
    expect(button).not.toBeNull();
    expect(button.tabIndex).toBe(-1);

    part.input().focus();
    await fixture.whenStable();
    expect(part.field().getAttribute('data-focused')).toBe('true');
    expect(part.chips().some((chip) => chip.hasAttribute('data-inline'))).toBe(false);

    // Moving to a chip's button is not leaving: nothing commits, no touch.
    type(part.input(), 'half@');
    button.focus();
    await fixture.whenStable();
    expect(part.field().getAttribute('data-focused')).toBe('true');
    expect(part.input().value).toBe('half@');
    expect(host.touches).toBe(0);
  });

  it('takes the last chip back into the input on Backspace, only when the input is empty', async () => {
    host.addresses.set(['ada@example.com', 'grace@example.com']);
    await fixture.whenStable();

    type(part.input(), 'x');
    expect(key(part.input(), 'Backspace').defaultPrevented).toBe(false);
    expect(host.addresses().length).toBe(2);

    type(part.input(), '');
    expect(key(part.input(), 'Backspace').defaultPrevented).toBe(true);
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com']);
    expect(part.input().value).toBe('grace@example.com');
    // Enter puts it back where it was.
    key(part.input(), 'Enter');
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com', 'grace@example.com']);

    // Taking a chip back is the one pending edit: a typo chip elsewhere goes.
    host.addresses.set(['oops', 'ada@example.com']);
    await fixture.whenStable();
    type(part.input(), '');
    key(part.input(), 'Backspace');
    await fixture.whenStable();
    expect(host.addresses()).toEqual([]);
    expect(part.input().value).toBe('ada@example.com');
    expect(part.input().hasAttribute('data-refused')).toBe(false);
  });

  it('a press on a chip, its button or the gap leaves the caret in the input; the input takes its own', async () => {
    host.addresses.set(['ada@example.com']);
    await fixture.whenStable();
    const press = (el: Element) =>
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(press(part.chips()[0])).toBe(false);
    expect(press(part.chips()[0].querySelector('[data-slot=remove]')!)).toBe(false);
    expect(press(part.field())).toBe(false);
    expect(press(part.input())).toBe(true);

    // The pointer's press, before the mouse's, already puts the caret in.
    part.input().blur();
    part.chips()[0].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(document.activeElement).toBe(part.input());
  });

  it('removes a chip from its button, and gives the caret back to the input', async () => {
    host.addresses.set(['ada@example.com', 'grace@example.com']);
    await fixture.whenStable();
    const button = part.chips()[0].querySelector<HTMLButtonElement>('[data-slot=remove]')!;
    button.focus();
    button.click();
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['grace@example.com']);
    expect(document.activeElement).toBe(part.input());
  });

  it('a click picks a chip, edit() takes it back into the input; one pending edit at a time', async () => {
    host.addresses.set(['ada@example.com', 'grace@example.com']);
    await fixture.whenStable();
    const click = (chip: Element) => chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Picking is being done with the typing: the address typed becomes a
    // chip, the typo stays behind, and the pick lands on the chip clicked.
    type(part.input(), 'bob@example.com, not-yet');
    click(part.chips()[0]);
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com', 'grace@example.com', 'bob@example.com']);
    expect(part.input().value).toBe('not-yet');
    expect(part.input().hasAttribute('data-refused')).toBe(true);
    expect(document.activeElement).toBe(part.input());
    expect(part.chips()[0].getAttribute('aria-current')).toBe('true');
    expect(part.input().getAttribute('aria-activedescendant')).toBe(part.chips()[0].id);
    type(part.input(), '');
    host.addresses.set(['ada@example.com', 'grace@example.com']);
    await fixture.whenStable();
    click(part.chips()[0]);
    await fixture.whenStable();
    expect(part.chips()[0].id).toBe(`${part.input().id}-chip-0`);

    // A click on the picked chip only picks it again; edit() — with no
    // address, the picked chip's — takes it back.
    click(part.chips()[0]);
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com', 'grace@example.com']);
    expect(part.chips()[0].getAttribute('aria-current')).toBe('true');
    expect(control().current()).toBe('ada@example.com');
    control().edit();
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['grace@example.com']);
    expect(part.input().value).toBe('ada@example.com');
    expect(part.input().getAttribute('aria-activedescendant')).toBeNull();
    expect(part.input().hasAttribute('data-refused')).toBe(false);

    // One pending edit at a time: the addresses typed so far are committed,
    // the typo in progress goes, and so does any chip that is not an address.
    host.addresses.update((list) => [...list, 'oops']);
    type(part.input(), 'bob@example.com, not-yet');
    editChip(part.chips()[0]);
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['bob@example.com']);
    expect(part.input().value).toBe('grace@example.com');

    // A click on the remove control is the control's, not a pick.
    host.addresses.set(['ada@example.com', 'grace@example.com']);
    type(part.input(), '');
    await fixture.whenStable();
    click(part.chips()[1].querySelector('[data-slot=remove]')!);
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com']);
    expect(part.input().getAttribute('aria-activedescendant')).toBeNull();

    // A locked list edits nothing.
    host.disabled.set(true);
    await fixture.whenStable();
    click(part.chips()[0]);
    editChip(part.chips()[0]);
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com']);
    expect(part.input().getAttribute('aria-activedescendant')).toBeNull();
  });

  it('exposes the selection and its commands to a host control: select, current, remove, copy', async () => {
    host.addresses.set(['ada@example.com', 'grace@example.com']);
    await fixture.whenStable();
    expect(control().current()).toBeNull();
    control().select('grace@example.com');
    await fixture.whenStable();
    expect(control().current()).toBe('grace@example.com');
    expect(part.chips()[1].getAttribute('aria-current')).toBe('true');
    expect(part.input().getAttribute('aria-activedescendant')).toBe(part.chips()[1].id);
    control().select('nobody@example.com');
    expect(control().current()).toBeNull();

    // copy() goes through the chip: the clipboard gets the header form.
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (text: string) => (written.push(text), Promise.resolve()) },
      configurable: true,
    });
    control().select('ada@example.com');
    expect(await control().copy()).toBe(true);
    expect(written).toEqual(['ada@example.com']);
    expect(await control().copy('nobody@example.com')).toBe(false);

    // remove() on the picked chip, and with nothing picked, nothing.
    control().remove();
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['grace@example.com']);
    control().remove();
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['grace@example.com']);
  });

  it('edits a chip in place: the input takes its spot, and a commit fills it; a typo leaves for the end on blur', async () => {
    host.addresses.set(['ada@example.com', 'bob@example.com', 'carol@example.com']);
    await fixture.whenStable();
    part.input().focus();
    const entry = () => part.input().closest('li')!;
    const chipBefore = () =>
      entry().previousElementSibling?.querySelector('[data-slot=name]')?.textContent;
    const chipAfter = () =>
      entry().nextElementSibling?.querySelector('[data-slot=name]')?.textContent;
    expect(chipAfter()).toBeUndefined();

    editChip(part.chips()[1]);
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com', 'carol@example.com']);
    expect(part.input().value).toBe('bob@example.com');
    expect(document.activeElement).toBe(part.input());
    expect(chipBefore()).toBe('ada@example.com');
    expect(chipAfter()).toBe('carol@example.com');

    // A commit takes the chip's place; the input stays there for more.
    type(part.input(), 'bobby@example.com');
    key(part.input(), 'Enter');
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com', 'bobby@example.com', 'carol@example.com']);
    expect(chipBefore()).toBe('bobby@example.com');
    expect(chipAfter()).toBe('carol@example.com');
    type(part.input(), 'dan@example.com');
    key(part.input(), 'Tab');
    await fixture.whenStable();
    expect(host.addresses()).toEqual([
      'ada@example.com',
      'bobby@example.com',
      'dan@example.com',
      'carol@example.com',
    ]);

    // Leaving with an address commits it in place and the input returns to
    // the end; leaving with a typo sends the typo to the end.
    type(part.input(), 'erin@example.com');
    part.input().blur();
    await fixture.whenStable();
    expect(host.addresses()).toEqual([
      'ada@example.com',
      'bobby@example.com',
      'dan@example.com',
      'erin@example.com',
      'carol@example.com',
    ]);
    expect(chipAfter()).toBeUndefined();
    part.input().focus();
    editChip(part.chips()[0]);
    await fixture.whenStable();
    expect(part.input().value).toBe('ada@example.com');
    type(part.input(), 'ada@');
    part.input().blur();
    await fixture.whenStable();
    expect(host.addresses()).toEqual([
      'bobby@example.com',
      'dan@example.com',
      'erin@example.com',
      'carol@example.com',
      'ada@',
    ]);
    expect(part.chips()[4].getAttribute('data-invalid')).toBe('true');
    expect(chipAfter()).toBeUndefined();
  });

  it('roves the chips with the arrow keys while the caret stays in the input', async () => {
    host.addresses.set(['ada@example.com', 'grace@example.com']);
    await fixture.whenStable();
    part.input().focus();
    const activeId = () => part.input().getAttribute('aria-activedescendant');
    const chipId = (i: number) => part.chips()[i].id;

    // From the start of the typing, ← reaches the last chip and walks back.
    expect(key(part.input(), 'ArrowLeft').defaultPrevented).toBe(true);
    await fixture.whenStable();
    expect(activeId()).toBe(chipId(1));
    // An address typed, caret at its start: ← makes it a chip and lands on it.
    key(part.input(), 'Escape');
    type(part.input(), 'bob@example.com');
    part.input().setSelectionRange(0, 0);
    key(part.input(), 'ArrowLeft');
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com', 'grace@example.com', 'bob@example.com']);
    expect(part.input().value).toBe('');
    expect(activeId()).toBe(chipId(2));
    key(part.input(), 'Escape');
    host.addresses.set(['ada@example.com', 'grace@example.com']);
    await fixture.whenStable();
    key(part.input(), 'ArrowLeft');
    await fixture.whenStable();
    expect(part.chips()[1].getAttribute('aria-current')).toBe('true');
    key(part.input(), 'ArrowLeft');
    await fixture.whenStable();
    expect(activeId()).toBe(chipId(0));
    key(part.input(), 'ArrowLeft');
    await fixture.whenStable();
    expect(activeId()).toBe(chipId(0));

    // → walks forward and, past the last chip, back to the caret.
    key(part.input(), 'ArrowRight');
    key(part.input(), 'ArrowRight');
    await fixture.whenStable();
    expect(activeId()).toBeNull();
    expect(key(part.input(), 'ArrowRight').defaultPrevented).toBe(false);

    // Escape drops the highlight; typing does too.
    key(part.input(), 'ArrowLeft');
    key(part.input(), 'Escape');
    await fixture.whenStable();
    expect(activeId()).toBeNull();
    key(part.input(), 'ArrowLeft');
    type(part.input(), 'x');
    await fixture.whenStable();
    expect(activeId()).toBeNull();

    // With typing in front of the caret, ← is the caret's own.
    part.input().setSelectionRange(1, 1);
    expect(key(part.input(), 'ArrowLeft').defaultPrevented).toBe(false);

    // Enter edits the highlighted chip; Delete removes it.
    type(part.input(), '');
    key(part.input(), 'ArrowLeft');
    expect(key(part.input(), 'Enter').defaultPrevented).toBe(true);
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com']);
    expect(part.input().value).toBe('grace@example.com');
    expect(activeId()).toBeNull();
    type(part.input(), '');
    key(part.input(), 'ArrowLeft');
    key(part.input(), 'Delete');
    await fixture.whenStable();
    expect(host.addresses()).toEqual([]);
  });

  it('caps at max and hides the entry once full', async () => {
    host.max.set(1);
    await fixture.whenStable();
    type(part.input(), 'me@example.com you@example.com');
    key(part.input(), 'Enter');
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['me@example.com']);
    expect(part.entry().hidden).toBe(true);
    expect(part.field().getAttribute('data-full')).toBe('true');

    // Full, the input is hidden: a click on the field focuses the chip's
    // remove button instead, and the field turns into chips.
    const button = part.chips()[0].querySelector<HTMLButtonElement>('[data-slot=remove]')!;
    part.field().click();
    await fixture.whenStable();
    expect(document.activeElement).toBe(button);
    expect(part.field().getAttribute('data-focused')).toBe('true');
    button.click();
    await fixture.whenStable();
    expect(part.entry().hidden).toBe(false);
  });

  it('locks while disabled: input disabled, chips not removable, host says so', async () => {
    host.addresses.set(['ada@example.com']);
    host.disabled.set(true);
    await fixture.whenStable();
    expect(part.field().getAttribute('aria-disabled')).toBe('true');
    expect(part.input().disabled).toBe(true);
    expect(part.chips()[0].querySelector('[data-slot=remove]')).toBeNull();
  });
});

/** A host the way a signal-forms writer uses it: an envelope model, the
    field directive on each row, and the list rule on each path. */
@Component({
  imports: [AddressInput, FormField],
  template: `
    <div email-address-input aria-label="From" limit="1" [formField]="envelope.from"></div>
    <div email-address-input aria-label="To" [formField]="envelope.to"></div>
  `,
})
class FormHost {
  readonly model = signal({ from: [] as string[], to: [] as string[] });
  readonly envelope = form(this.model, (p) => {
    addressList(p.from, { max: 1 });
    addressList(p.to);
  });
}

describe('AddressInput in a signal form', () => {
  let fixture: ComponentFixture<FormHost>;
  let host: FormHost;
  let from: ReturnType<typeof parts>;
  let to: ReturnType<typeof parts>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FormHost] }).compileComponents();
    fixture = TestBed.createComponent(FormHost);
    host = fixture.componentInstance;
    await fixture.whenStable();
    const rows = fixture.nativeElement.querySelectorAll('[email-address-input]');
    from = parts(rows[0]);
    to = parts(rows[1]);
  });

  it('writes what is committed into the model, and draws what the model holds', async () => {
    type(to.input(), 'ada@example.com');
    key(to.input(), 'Enter');
    await fixture.whenStable();
    expect(host.model().to).toEqual(['ada@example.com']);

    host.model.update((m) => ({ ...m, from: ['me@example.com'] }));
    await fixture.whenStable();
    expect(from.chips().length).toBe(1);
    expect(from.entry().hidden).toBe(true);
  });

  it('starts invalid but quiet: the state shows once the row is touched, and no message ever', async () => {
    expect(host.envelope.to().invalid()).toBe(true);
    expect(to.input().getAttribute('aria-invalid')).toBeNull();
    expect(to.field().hasAttribute('data-invalid')).toBe(false);

    to.input().dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(host.envelope.to().touched()).toBe(true);
    expect(to.input().getAttribute('aria-invalid')).toBe('true');
    expect(to.field().getAttribute('data-invalid')).toBe('true');
    // The wording is the form owner's to show, from the field's errors.
    expect(to.field().textContent).not.toContain('Add at least one address');
    expect(
      host.envelope
        .to()
        .errors()
        .map((e) => e.message),
    ).toEqual(['Add at least one address']);
  });

  it('names the offenders in the field’s errors, and clears once every chip is an address', async () => {
    type(to.input(), 'nope, ada@example.com, also-nope');
    key(to.input(), 'Enter');
    to.input().dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(
      host.envelope
        .to()
        .errors()
        .map((e) => [e.kind, e.message]),
    ).toEqual([[ADDRESS_LIST_INVALID, '“nope” and 1 other are not email addresses']]);
    // The address went in on Enter; the typos only on leaving, after it.
    expect(to.chips().map((c) => c.getAttribute('data-invalid'))).toEqual([null, 'true', 'true']);

    host.model.update((m) => ({ ...m, to: ['ada@example.com'] }));
    await fixture.whenStable();
    expect(host.envelope.to().valid()).toBe(true);
    expect(to.field().hasAttribute('data-invalid')).toBe(false);
  });

  it('reports every rule the list breaks, by kind', async () => {
    host.model.update((m) => ({ ...m, from: ['me@example.com', 'nope'] }));
    await fixture.whenStable();
    expect(
      host.envelope
        .from()
        .errors()
        .map((e) => e.kind),
    ).toEqual([ADDRESS_LIST_INVALID, ADDRESS_LIST_TOO_MANY]);
    expect(
      host.envelope
        .to()
        .errors()
        .map((e) => e.kind),
    ).toEqual([ADDRESS_LIST_EMPTY]);
  });

  it('carries the field name onto the input', () => {
    expect(to.input().name).toContain('to');
  });
});

/** A host that brings its own remove control for every chip. */
@Component({
  imports: [AddressInput, AddressChipRemove],
  template: `<div email-address-input aria-label="To" [(value)]="addresses">
    <button
      *emailAddressChipRemove="let address; let remove = remove; let label = label"
      type="button"
      class="own-remove"
      [attr.aria-label]="label"
      (click)="remove()"
    >
      drop {{ address }}
    </button>
  </div>`,
})
class SlotHost {
  readonly addresses = signal(['ada@example.com', 'grace@example.com']);
}

describe('AddressInput remove slot', () => {
  it('hands the host’s remove template to every chip, in place of the default button', async () => {
    const fixture = TestBed.createComponent(SlotHost);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const own = [...root.querySelectorAll<HTMLButtonElement>('.own-remove')];

    expect(own.map((b) => b.textContent?.trim())).toEqual([
      'drop ada@example.com',
      'drop grace@example.com',
    ]);
    expect(root.querySelector('[data-slot=remove]')).toBeNull();
    expect(own[0].getAttribute('aria-label')).toBe('Remove ada@example.com');

    own[0].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.addresses()).toEqual(['grace@example.com']);
  });
});
