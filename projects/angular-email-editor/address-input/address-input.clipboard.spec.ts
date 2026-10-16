import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ADDRESS_DRAG_TYPE } from '@h-k-dev/angular-email-editor/address-chip';
import { AddressInput } from './address-input';

/** A clipboard event's data, as the engine hands it over: typed. jsdom has
    no `ClipboardEvent` data of its own. */
class Clipboard {
  readonly store = new Map<string, string>();
  get types(): string[] {
    return [...this.store.keys()];
  }
  getData(format: string): string {
    return this.store.get(format === 'text' ? 'text/plain' : format) ?? '';
  }
  setData(format: string, data: string): void {
    this.store.set(format, data);
  }
}

function clipboardEvent(target: Element, type: string, data = new Clipboard()) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: data });
  target.dispatchEvent(event);
  return { event, data };
}

function text(value: string): Clipboard {
  const data = new Clipboard();
  data.setData('text/plain', value);
  return data;
}

@Component({
  imports: [AddressInput],
  template: `
    <div email-address-input aria-label="To" [readonly]="locked()" [(value)]="to"></div>
    <div email-address-input aria-label="Cc" [(value)]="cc"></div>
  `,
})
class Host {
  readonly to = signal(['ada@example.com', 'Grace Hopper <grace@example.com>']);
  readonly cc = signal(['linus@example.com', 'alan@example.com']);
  readonly locked = signal(false);
}

describe('AddressInput clipboard', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  const controls = () =>
    fixture.debugElement
      .queryAll(By.directive(AddressInput))
      .map((row) => row.componentInstance as AddressInput);
  const rows = () =>
    [...fixture.nativeElement.querySelectorAll('[email-address-input]')] as HTMLElement[];
  const input = (row: number) => rows()[row].querySelector<HTMLInputElement>('[data-slot=input]')!;
  const chip = (row: number, index: number) =>
    rows()[row].querySelectorAll<HTMLElement>('[email-address-chip]')[index];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('Ctrl+C on a picked chip copies it — as text and as a chip — and shows and says so, as a hold does', async () => {
    controls()[0].select('Grace Hopper <grace@example.com>');
    const { event, data } = clipboardEvent(input(0), 'copy');
    await fixture.whenStable();

    expect(event.defaultPrevented).toBe(true);
    expect(data.getData('text/plain')).toBe('Grace Hopper <grace@example.com>');
    expect(data.getData(ADDRESS_DRAG_TYPE)).toBe('Grace Hopper <grace@example.com>');
    expect(chip(0, 1).getAttribute('data-copied')).toBe('true');
    expect(chip(0, 1).querySelector('[data-slot=status]')?.textContent?.trim()).toBe(
      'Copied Grace Hopper <grace@example.com>',
    );
    expect(host.to()).toEqual(['ada@example.com', 'Grace Hopper <grace@example.com>']);
  });

  it('copies as ever with nothing picked, or with text selected in the input', () => {
    expect(clipboardEvent(input(0), 'copy').event.defaultPrevented).toBe(false);

    controls()[0].select('ada@example.com');
    input(0).value = 'typed';
    input(0).setSelectionRange(0, 5);
    expect(clipboardEvent(input(0), 'copy').event.defaultPrevented).toBe(false);
  });

  it('Ctrl+X cuts it: on the clipboard, and gone from the list', async () => {
    controls()[0].select('ada@example.com');
    const { event, data } = clipboardEvent(input(0), 'cut');
    await fixture.whenStable();

    expect(event.defaultPrevented).toBe(true);
    expect(data.getData(ADDRESS_DRAG_TYPE)).toBe('ada@example.com');
    expect(host.to()).toEqual(['Grace Hopper <grace@example.com>']);
  });

  it('a read-only list copies, but never cuts', async () => {
    host.locked.set(true);
    await fixture.whenStable();
    controls()[0].select('ada@example.com');
    expect(clipboardEvent(input(0), 'cut').event.defaultPrevented).toBe(false);
    expect(host.to()).toEqual(['ada@example.com', 'Grace Hopper <grace@example.com>']);
  });

  it('a cut chip pastes back as a chip — name and all — not as text to edit', async () => {
    controls()[0].select('Grace Hopper <grace@example.com>');
    const { data } = clipboardEvent(input(0), 'cut');
    const paste = clipboardEvent(input(1), 'paste', data).event;
    await fixture.whenStable();

    expect(paste.defaultPrevented).toBe(true);
    expect(host.to()).toEqual(['ada@example.com']);
    expect(host.cc()).toEqual([
      'linus@example.com',
      'alan@example.com',
      'Grace Hopper <grace@example.com>',
    ]);
    expect(input(1).value).toBe('');
  });

  it('with a chip picked, a paste goes right after it', async () => {
    controls()[0].select('ada@example.com');
    const { data } = clipboardEvent(input(0), 'copy');
    controls()[1].select('linus@example.com');
    clipboardEvent(input(1), 'paste', data);
    await fixture.whenStable();
    expect(host.cc()).toEqual(['linus@example.com', 'ada@example.com', 'alan@example.com']);

    // Plain text too: its addresses after the picked chip, the rest typed.
    controls()[1].select('linus@example.com');
    clipboardEvent(input(1), 'paste', text('kay@example.com, oops'));
    await fixture.whenStable();
    expect(host.cc()).toEqual([
      'linus@example.com',
      'kay@example.com',
      'ada@example.com',
      'alan@example.com',
    ]);
    expect(input(1).value).toBe('oops');
  });

  it('a hold’s copy — plain text only — pastes back as a chip too', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.resolve() },
      configurable: true,
    });
    await controls()[0].copy('Grace Hopper <grace@example.com>');
    const paste = clipboardEvent(input(1), 'paste', text('Grace Hopper <grace@example.com>')).event;
    await fixture.whenStable();
    expect(paste.defaultPrevented).toBe(true);
    expect(host.cc()).toEqual([
      'linus@example.com',
      'alan@example.com',
      'Grace Hopper <grace@example.com>',
    ]);
  });

  it('a single token typed elsewhere is still left to the input, to edit', () => {
    expect(clipboardEvent(input(1), 'paste', text('Kay Example')).event.defaultPrevented).toBe(
      false,
    );
  });
});
