import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AddressInput } from './address-input';

/** A drag's data store, shared by every event of one drag the way the
    engine shares its `DataTransfer`: jsdom has neither it nor `DragEvent`. */
class Transfer {
  readonly store = new Map<string, string>();
  effectAllowed = 'uninitialized';
  dropEffect = 'none';
  get types(): string[] {
    return [...this.store.keys()];
  }
  getData(format: string): string {
    return this.store.get(format) ?? '';
  }
  setData(format: string, data: string): void {
    this.store.set(format, data);
  }
}

function dragEvent(target: Element, type: string, transfer: Transfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: transfer },
    clientX: { value: 0 },
    clientY: { value: 0 },
    altKey: { value: false },
    ctrlKey: { value: false },
    relatedTarget: { value: null },
  });
  target.dispatchEvent(event);
  return event;
}

/** The whole gesture, the way an engine runs it: a drop only where the last
    `dragover` accepted it, then `dragend` on the chip. */
function dragChip(chip: Element, target: Element): void {
  const transfer = new Transfer();
  dragEvent(chip, 'dragstart', transfer);
  dragEvent(target, 'dragenter', transfer);
  const over = dragEvent(target, 'dragover', transfer);
  if (over.defaultPrevented && transfer.dropEffect !== 'none') dragEvent(target, 'drop', transfer);
  dragEvent(chip, 'dragend', transfer);
}

function type(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function key(input: HTMLInputElement, key: string): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true }));
}

/** Two rows that save as they are left, and somewhere else to go. */
@Component({
  imports: [AddressInput],
  template: `
    <div email-address-input aria-label="To" [(value)]="to" (savedModelChange)="toSaves.push($event)"></div>
    <div email-address-input aria-label="Cc" [(value)]="cc" (savedModelChange)="ccSaves.push($event)"></div>
    <button type="button" class="elsewhere">Elsewhere</button>
  `,
})
class Host {
  readonly to = signal<string[]>([]);
  readonly cc = signal<string[]>([]);
  readonly toSaves: string[][] = [];
  readonly ccSaves: string[][] = [];
}

describe('AddressInput savedModelChange', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  const rows = () => fixture.debugElement.queryAll(By.directive(AddressInput));
  const row = (index: number) => rows()[index].nativeElement as HTMLElement;
  const input = (index: number) => row(index).querySelector<HTMLInputElement>('[data-slot=input]')!;
  const chips = (index: number) => [...row(index).querySelectorAll<HTMLElement>('[email-address-chip]')];
  const control = (index: number) => rows()[index].componentInstance as AddressInput;
  const leave = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.elsewhere')!.focus();

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    document.body.append(fixture.nativeElement);
    await fixture.whenStable();
  });

  afterEach(() => (fixture.nativeElement as HTMLElement).remove());

  it('says the list once, as the row is left — not per chip', async () => {
    input(0).focus();
    type(input(0), 'ada@example.com');
    key(input(0), 'Enter');
    type(input(0), 'grace@example.com');
    key(input(0), 'Enter');
    await fixture.whenStable();
    expect(host.toSaves).toEqual([]);

    leave();
    await fixture.whenStable();
    expect(host.toSaves).toEqual([['ada@example.com', 'grace@example.com']]);
  });

  it('commits what is still typed before it says the list', async () => {
    input(0).focus();
    type(input(0), 'ada@example.com');
    leave();
    await fixture.whenStable();
    expect(host.toSaves).toEqual([['ada@example.com']]);
  });

  it('says nothing for a row entered and left unchanged', async () => {
    host.to.set(['ada@example.com']);
    await fixture.whenStable();
    input(0).focus();
    leave();
    await fixture.whenStable();
    expect(host.toSaves).toEqual([]);
  });

  it('says nothing for a value set from outside', async () => {
    host.to.set(['ada@example.com', 'grace@example.com']);
    await fixture.whenStable();
    expect(host.toSaves).toEqual([]);
  });

  it('says a chip taken out while in the row, as the row is left', async () => {
    host.to.set(['ada@example.com', 'grace@example.com']);
    await fixture.whenStable();
    input(0).focus();
    control(0).remove('ada@example.com');
    await fixture.whenStable();
    expect(host.toSaves).toEqual([]);

    leave();
    await fixture.whenStable();
    expect(host.toSaves).toEqual([['grace@example.com']]);
  });

  it('says a chip dragged from one row to another at once, in both rows', async () => {
    host.to.set(['ada@example.com', 'grace@example.com']);
    await fixture.whenStable();

    dragChip(chips(0)[0], row(1));
    await fixture.whenStable();
    expect(host.cc()).toEqual(['ada@example.com']);
    expect(host.ccSaves).toEqual([['ada@example.com']]);
    expect(host.toSaves).toEqual([['grace@example.com']]);
  });

  it('says a move to another row at once, in both rows', async () => {
    host.to.set(['ada@example.com']);
    await fixture.whenStable();

    expect(control(0).moveTo(control(1), 'ada@example.com')).toBe(true);
    await fixture.whenStable();
    expect(host.toSaves).toEqual([[]]);
    expect(host.ccSaves).toEqual([['ada@example.com']]);
  });
});
