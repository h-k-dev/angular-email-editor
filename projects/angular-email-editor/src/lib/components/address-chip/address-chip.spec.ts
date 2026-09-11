import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AddressChip } from './address-chip';
import { AddressChipRemove } from './address-chip.slots';

@Component({
  imports: [AddressChip],
  template: `<li
    email-address-chip
    [address]="address()"
    [removable]="removable()"
    [aria-disabled]="disabled()"
    [holdDelay]="holdDelay()"
    (removed)="removals = removals + 1"
    (copied)="copies.push($event)"
  ></li>`,
})
class Host {
  readonly address = signal('Ada Lovelace <ada@example.com>');
  readonly removable = signal(true);
  readonly disabled = signal(false);
  readonly holdDelay = signal(500);
  removals = 0;
  copies: string[] = [];
}

describe('AddressChip', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let chip: HTMLElement;

  const name = () => chip.querySelector<HTMLElement>('[data-slot=name]')!;
  const note = () => chip.querySelector<HTMLElement>('[data-slot=note]');
  const remove = () => chip.querySelector<HTMLButtonElement>('[data-slot=remove]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
    chip = (fixture.nativeElement as HTMLElement).querySelector('[email-address-chip]')!;
  });

  it('shows the display name, with the header form in the title', () => {
    expect(name().textContent?.trim()).toBe('Ada Lovelace');
    expect(chip.title).toBe('Ada Lovelace <ada@example.com>');
    expect(chip.hasAttribute('data-invalid')).toBe(false);
    expect(note()).toBeNull();
  });

  it('shows the address when there is no name', async () => {
    host.address.set('ada@example.com');
    await fixture.whenStable();
    expect(name().textContent?.trim()).toBe('ada@example.com');
    expect(chip.title).toBe('ada@example.com');
  });

  it('flags a malformed address on the host, in the title and in a spoken note', async () => {
    host.address.set('not-an-address');
    await fixture.whenStable();
    expect(chip.getAttribute('data-invalid')).toBe('true');
    expect(chip.title).toBe('not-an-address — not an email address');
    expect(note()?.textContent).toContain('not an email address');
  });

  it('asks to be removed, named after its address', () => {
    const button = remove()!;
    expect(button.getAttribute('aria-label')).toBe('Remove Ada Lovelace <ada@example.com>');
    button.click();
    expect(host.removals).toBe(1);
  });

  it('drops the remove button when not removable, disables it when disabled', async () => {
    host.disabled.set(true);
    await fixture.whenStable();
    expect(chip.getAttribute('aria-disabled')).toBe('true');
    expect(remove()!.disabled).toBe(true);

    host.removable.set(false);
    await fixture.whenStable();
    expect(remove()).toBeNull();
  });
  it('copies the address after a hold, says so and keeps the context menu away; a release, a drag or the button before that do not', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (text: string) => (written.push(text), Promise.resolve()) },
      configurable: true,
    });
    host.holdDelay.set(20);
    await fixture.whenStable();
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const pointer = (el: Element, type: string, init: MouseEventInit = {}) =>
      el.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 10,
          clientY: 10,
          ...init,
        }),
      );

    // Released before the time: nothing.
    pointer(name(), 'pointerdown');
    pointer(name(), 'pointerup');
    await wait(40);
    expect(written).toEqual([]);
    // Dragged before the time: nothing.
    pointer(name(), 'pointerdown');
    pointer(name(), 'pointermove', { clientX: 30 });
    await wait(40);
    expect(written).toEqual([]);
    // Held on the remove button: that is the button's.
    pointer(remove()!, 'pointerdown');
    await wait(40);
    expect(written).toEqual([]);

    // Held: the context menu is kept away meanwhile, then the header form is copied.
    pointer(name(), 'pointerdown');
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    name().dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    await wait(40);
    expect(written).toEqual(['Ada Lovelace <ada@example.com>']);
    await fixture.whenStable();
    expect(chip.getAttribute('data-copied')).toBe('true');
    expect(chip.querySelector('[data-slot=status]')?.textContent?.trim()).toBe(
      'Copied Ada Lovelace <ada@example.com>',
    );
    expect(host.copies).toEqual(['Ada Lovelace <ada@example.com>']);

    // A clipboard that refuses — an unfocused document — falls back to the
    // copy command.
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: () =>
          Promise.reject(new DOMException('Document is not focused.', 'NotAllowedError')),
      },
      configurable: true,
    });
    const commands: string[] = [];
    const execCommand = document.execCommand;
    document.execCommand = (command: string) => {
      commands.push(command + ':' + document.querySelector('textarea')?.value);
      return true;
    };
    pointer(name(), 'pointerdown');
    await wait(40);
    document.execCommand = execCommand;
    expect(commands).toEqual(['copy:Ada Lovelace <ada@example.com>']);
    expect(host.copies).toEqual([
      'Ada Lovelace <ada@example.com>',
      'Ada Lovelace <ada@example.com>',
    ]);

    // Off: no hold at all.
    host.holdDelay.set(0);
    await fixture.whenStable();
    pointer(name(), 'pointerdown');
    await wait(40);
    expect(host.copies.length).toBe(2);
  });
});

@Component({
  imports: [AddressChip, AddressChipRemove],
  template: `<li
    email-address-chip
    address="not-an-address"
    [aria-disabled]="disabled()"
    (removed)="removals = removals + 1"
  >
    <a
      *emailAddressChipRemove="
        let address;
        let valid = valid;
        let disabled = disabled;
        let remove = remove
      "
      class="own-remove"
      (click)="remove()"
      >{{ address }} {{ valid }} {{ disabled }}</a
    >
  </li>`,
})
class SlotHost {
  readonly disabled = signal(false);
  removals = 0;
}

describe('AddressChip remove slot', () => {
  it('renders the host’s template in the trailing box, with the address and a remove that respects disabled', async () => {
    const fixture = TestBed.createComponent(SlotHost);
    const host = fixture.componentInstance;
    await fixture.whenStable();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('[email-address-chip]')!;
    const own = () => chip.querySelector<HTMLElement>('[data-slot=trailing] .own-remove')!;

    expect(chip.querySelector('[data-slot=remove]')).toBeNull();
    expect(own().textContent?.trim()).toBe('not-an-address false false');
    own().click();
    expect(host.removals).toBe(1);

    host.disabled.set(true);
    await fixture.whenStable();
    expect(own().textContent?.trim()).toBe('not-an-address false true');
    own().click();
    expect(host.removals).toBe(1);
  });
});
