import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, disabled, form, readonly } from '@angular/forms/signals';
import { By } from '@angular/platform-browser';
import { ADDRESS_DRAG_TYPE } from '@h-k-dev/angular-email-editor/address-chip';
import { AddressDragGroup } from './address-drag-group';
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

function dragEvent(
  target: Element,
  type: string,
  transfer: Transfer,
  init: { altKey?: boolean; relatedTarget?: Element | null; x?: number; y?: number } = {},
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: transfer },
    clientX: { value: init.x ?? 0 },
    clientY: { value: init.y ?? 0 },
    altKey: { value: !!init.altKey },
    ctrlKey: { value: false },
    relatedTarget: { value: init.relatedTarget ?? null },
  });
  target.dispatchEvent(event);
  return event;
}

/** The whole gesture, the way an engine runs it: a drop only where the last
    `dragover` accepted it, then `dragend` on the chip. */
function dragChip(chip: Element, target: Element, init: { altKey?: boolean } = {}) {
  const transfer = new Transfer();
  dragEvent(chip, 'dragstart', transfer);
  dragEvent(target, 'dragenter', transfer, init);
  const over = dragEvent(target, 'dragover', transfer, init);
  const accepted = over.defaultPrevented && transfer.dropEffect !== 'none';
  const effect = transfer.dropEffect;
  if (accepted) dragEvent(target, 'drop', transfer, init);
  dragEvent(chip, 'dragend', transfer);
  return { over, accepted, effect };
}

function rowParts(row: HTMLElement) {
  return {
    row,
    chips: () => [...row.querySelectorAll<HTMLElement>('[email-address-chip]')],
    list: () => row.querySelector<HTMLElement>('[data-slot=chips]')!,
    input: () => row.querySelector<HTMLInputElement>('[data-slot=input]')!,
    status: (index: number) =>
      row
        .querySelectorAll('[email-address-chip]')
        [index]?.querySelector('[data-slot=status]')
        ?.textContent?.trim() ?? '',
  };
}

/** The envelope of a writer: From takes one, To and Cc are open, Bcc can be
    made read-only, and the Cc row can be disabled. */
@Component({
  imports: [AddressInput, FormField],
  template: `
    <div email-address-input aria-label="From" limit="1" [formField]="envelope.from"></div>
    <div email-address-input aria-label="To" [formField]="envelope.to"></div>
    <div
      email-address-input
      aria-label="Cc"
      movedLabel="Moved to Cc:"
      [formField]="envelope.cc"
    ></div>
    <div email-address-input aria-label="Bcc" [formField]="envelope.bcc"></div>
    <div
      email-address-input
      aria-label="Reply-To"
      [allowDrag]="false"
      [formField]="envelope.replyTo"
    ></div>
  `,
})
class EnvelopeHost {
  readonly model = signal({
    from: [] as string[],
    to: [] as string[],
    cc: [] as string[],
    bcc: [] as string[],
    replyTo: [] as string[],
  });
  readonly bccReadonly = signal(false);
  readonly ccDisabled = signal(false);
  readonly envelope = form(this.model, (p) => {
    readonly(p.bcc, () => this.bccReadonly());
    disabled(p.cc, () => this.ccDisabled());
  });
}

describe('AddressInput drag and drop', () => {
  let fixture: ComponentFixture<EnvelopeHost>;
  let host: EnvelopeHost;
  let from: ReturnType<typeof rowParts>;
  let to: ReturnType<typeof rowParts>;
  let cc: ReturnType<typeof rowParts>;
  let bcc: ReturnType<typeof rowParts>;
  let replyTo: ReturnType<typeof rowParts>;
  const controls = () =>
    fixture.debugElement
      .queryAll(By.directive(AddressInput))
      .map((row) => row.componentInstance as AddressInput);
  const set = async (patch: Partial<ReturnType<EnvelopeHost['model']>>) => {
    host.model.update((m) => ({ ...m, ...patch }));
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EnvelopeHost] }).compileComponents();
    fixture = TestBed.createComponent(EnvelopeHost);
    host = fixture.componentInstance;
    await fixture.whenStable();
    const rows = [...fixture.nativeElement.querySelectorAll('[email-address-input]')];
    [from, to, cc, bcc, replyTo] = rows.map((row) => rowParts(row as HTMLElement));
  });

  it('moves a chip from To to Cc: both lists change, both rows are touched', async () => {
    await set({ to: ['Ada <ada@example.com>', 'grace@example.com'] });
    expect(to.chips()[0].getAttribute('draggable')).toBe('true');

    const { accepted, effect } = dragChip(to.chips()[0], cc.row);
    await fixture.whenStable();

    expect(accepted).toBe(true);
    expect(effect).toBe('move');
    expect(host.model().to).toEqual(['grace@example.com']);
    expect(host.model().cc).toEqual(['Ada <ada@example.com>']);
    expect(host.envelope.to().touched()).toBe(true);
    expect(host.envelope.cc().touched()).toBe(true);
    // The moved chip says where it went.
    expect(cc.status(0)).toBe('Moved to Cc: Ada <ada@example.com>');
  });

  it('copies with Alt (Option): the source keeps its chip', async () => {
    await set({ to: ['ada@example.com'] });
    const { effect } = dragChip(to.chips()[0], cc.row, { altKey: true });
    await fixture.whenStable();

    expect(effect).toBe('copy');
    expect(host.model().to).toEqual(['ada@example.com']);
    expect(host.model().cc).toEqual(['ada@example.com']);
    expect(host.envelope.to().touched()).toBe(false);
    expect(host.envelope.cc().touched()).toBe(true);
  });

  it('absorbs a duplicate — in any case, under any name: it leaves, the target keeps its own', async () => {
    await set({ to: ['Ada <ADA@example.com>', 'grace@example.com'], cc: ['ada@example.com'] });
    const { accepted, effect } = dragChip(to.chips()[0], cc.row);
    await fixture.whenStable();

    expect(accepted).toBe(true);
    expect(effect).toBe('move');
    expect(host.model().to).toEqual(['grace@example.com']);
    expect(host.model().cc).toEqual(['ada@example.com']);
    expect(host.envelope.to().touched()).toBe(true);
    expect(host.envelope.cc().touched()).toBe(true);
    // The entry that absorbed it says so.
    expect(cc.status(0)).toBe('Moved to Cc: Ada <ADA@example.com>');
  });

  it('refuses a copy onto a duplicate — there is nothing to copy — out loud', async () => {
    await set({ to: ['ada@example.com'], cc: ['ada@example.com'] });
    const { over, accepted, effect } = dragChip(to.chips()[0], cc.row, { altKey: true });
    await fixture.whenStable();

    // Said, so the text input inside can't take anything instead.
    expect(over.defaultPrevented).toBe(true);
    expect(effect).toBe('none');
    expect(accepted).toBe(false);
    expect(host.model().to).toEqual(['ada@example.com']);
    expect(host.model().cc).toEqual(['ada@example.com']);
  });

  it('a full row still absorbs the address it holds', async () => {
    await set({ from: ['me@example.com'], to: ['Me <me@example.com>'] });
    expect(dragChip(to.chips()[0], from.row).accepted).toBe(true);
    await fixture.whenStable();
    expect(host.model().from).toEqual(['me@example.com']);
    expect(host.model().to).toEqual([]);
  });

  it('refuses a drop on a full row: From holds one, and is never silently replaced', async () => {
    await set({ from: ['me@example.com'], to: ['ada@example.com'] });
    expect(dragChip(to.chips()[0], from.row).accepted).toBe(false);
    await fixture.whenStable();
    expect(host.model().from).toEqual(['me@example.com']);
    expect(host.model().to).toEqual(['ada@example.com']);

    await set({ from: [] });
    expect(dragChip(to.chips()[0], from.row).accepted).toBe(true);
    await fixture.whenStable();
    expect(host.model().from).toEqual(['ada@example.com']);
    expect(host.model().to).toEqual([]);
  });

  describe('within its own row', () => {
    const layOut = () => {
      // Three 100px chips on one 24px line, 4px apart, the list at 0,0.
      to.list().getBoundingClientRect = () => new DOMRect(0, 0, 400, 24);
      to.chips().forEach(
        (chip, i) => (chip.getBoundingClientRect = () => new DOMRect(i * 104, 0, 100, 24)),
      );
    };
    const marker = () => to.row.querySelector<HTMLElement>('[data-slot=drop-marker]');

    beforeEach(async () => {
      await set({ to: ['ada@example.com', 'grace@example.com', 'linus@example.com'] });
      layOut();
    });

    it('reorders: the chip moves to the line, nothing leaves, the row is touched', async () => {
      const transfer = new Transfer();
      dragEvent(to.chips()[0], 'dragstart', transfer);
      // Past linus's middle: the end.
      const over = dragEvent(to.row, 'dragover', transfer, { x: 290, y: 12 });
      await fixture.whenStable();
      expect(over.defaultPrevented).toBe(true);
      expect(transfer.dropEffect).toBe('move');
      expect(marker()?.style.left).toBe('312px');

      dragEvent(to.row, 'drop', transfer, { x: 290, y: 12 });
      dragEvent(to.chips()[0], 'dragend', transfer);
      await fixture.whenStable();
      expect(host.model().to).toEqual([
        'grace@example.com',
        'linus@example.com',
        'ada@example.com',
      ]);
      expect(host.envelope.to().touched()).toBe(true);
    });

    it('draws no line right before or after the chip itself, and a drop there changes nothing', async () => {
      const transfer = new Transfer();
      dragEvent(to.chips()[1], 'dragstart', transfer);
      // Before grace (past ada's middle), and after grace (before linus's).
      for (const x of [60, 160]) {
        dragEvent(to.row, 'dragover', transfer, { x, y: 12 });
        await fixture.whenStable();
        expect(marker()).toBeNull();
      }
      // Before ada: a line, and a place to go.
      dragEvent(to.row, 'dragover', transfer, { x: 10, y: 12 });
      await fixture.whenStable();
      expect(marker()?.style.left).toBe('-4px');

      dragEvent(to.row, 'drop', transfer, { x: 160, y: 12 });
      dragEvent(to.chips()[1], 'dragend', transfer);
      await fixture.whenStable();
      expect(host.model().to).toEqual([
        'ada@example.com',
        'grace@example.com',
        'linus@example.com',
      ]);
      expect(host.envelope.to().touched()).toBe(false);
    });

    it('a draft being typed is no place: the line stays among the chips, the draft stays as typed', async () => {
      // Grace's draft after the chips, on the same line, under the pointer.
      cc.input().value = 'gra';
      cc.input().dispatchEvent(new Event('input'));
      await set({ cc: ['linus@example.com'] });
      cc.list().getBoundingClientRect = () => new DOMRect(0, 0, 400, 24);
      cc.chips()[0].getBoundingClientRect = () => new DOMRect(0, 0, 100, 24);
      cc.row.querySelector('[data-slot=entry]')!.getBoundingClientRect = () =>
        new DOMRect(104, 0, 296, 24);

      const transfer = new Transfer();
      dragEvent(to.chips()[0], 'dragstart', transfer);
      dragEvent(cc.row, 'dragover', transfer, { x: 300, y: 12 });
      await fixture.whenStable();
      // After linus — not after the draft.
      expect(cc.row.querySelector<HTMLElement>('[data-slot=drop-marker]')?.style.left).toBe(
        '104px',
      );
      dragEvent(cc.row, 'drop', transfer, { x: 300, y: 12 });
      dragEvent(to.chips()[0], 'dragend', transfer);
      await fixture.whenStable();
      expect(host.model().cc).toEqual(['linus@example.com', 'ada@example.com']);
      expect(cc.input().value).toBe('gra');
    });

    it('refuses a copy within its own row — it would add nothing', () => {
      const transfer = new Transfer();
      dragEvent(to.chips()[0], 'dragstart', transfer);
      const over = dragEvent(to.row, 'dragover', transfer, { x: 290, y: 12, altKey: true });
      expect(over.defaultPrevented).toBe(true);
      expect(transfer.dropEffect).toBe('none');
      dragEvent(to.chips()[0], 'dragend', transfer);
    });

    it('Alt+← and Alt+→ move the picked chip a place, and it stays picked', async () => {
      const [, toControl] = controls();
      const altKey = (key: string) => {
        const event = new KeyboardEvent('keydown', {
          key,
          altKey: true,
          bubbles: true,
          cancelable: true,
        });
        to.input().dispatchEvent(event);
        return event;
      };
      toControl.select('grace@example.com');

      expect(altKey('ArrowLeft').defaultPrevented).toBe(true);
      await fixture.whenStable();
      expect(host.model().to).toEqual([
        'grace@example.com',
        'ada@example.com',
        'linus@example.com',
      ]);
      expect(toControl.current()).toBe('grace@example.com');
      expect(host.envelope.to().touched()).toBe(true);

      // At the start there is nowhere to go — and the highlight stays put.
      expect(altKey('ArrowLeft').defaultPrevented).toBe(true);
      expect(host.model().to[0]).toBe('grace@example.com');
      expect(toControl.current()).toBe('grace@example.com');

      altKey('ArrowRight');
      altKey('ArrowRight');
      await fixture.whenStable();
      expect(host.model().to).toEqual([
        'ada@example.com',
        'linus@example.com',
        'grace@example.com',
      ]);
      expect(toControl.current()).toBe('grace@example.com');
    });
  });

  it('a read-only or disabled row is neither a source nor a target', async () => {
    await set({ to: ['ada@example.com'], cc: ['grace@example.com'], bcc: ['linus@example.com'] });
    host.bccReadonly.set(true);
    host.ccDisabled.set(true);
    await fixture.whenStable();

    expect(bcc.chips()[0].hasAttribute('draggable')).toBe(false);
    expect(cc.chips()[0].hasAttribute('draggable')).toBe(false);
    expect(dragChip(to.chips()[0], bcc.row).accepted).toBe(false);
    expect(dragChip(to.chips()[0], cc.row).accepted).toBe(false);
    await fixture.whenStable();
    expect(host.model()).toEqual(
      envelopeWith({
        to: ['ada@example.com'],
        cc: ['grace@example.com'],
        bcc: ['linus@example.com'],
      }),
    );
  });

  it('allowDrag=false: no drag out, no chip drop in, and plain text is left to the browser', async () => {
    await set({ to: ['ada@example.com'], replyTo: ['me@example.com'] });
    expect(replyTo.chips()[0].hasAttribute('draggable')).toBe(false);
    expect(dragChip(to.chips()[0], replyTo.row).accepted).toBe(false);

    const text = new Transfer();
    text.setData('text/plain', 'grace@example.com');
    expect(dragEvent(replyTo.row, 'dragover', text).defaultPrevented).toBe(false);
  });

  it('moves a malformed or a pending chip as it is, still flagged or noted', async () => {
    await set({ to: ['not-an-address', '{{contact.email}}'] });
    dragChip(to.chips()[0], cc.row);
    await fixture.whenStable();
    dragChip(to.chips()[0], cc.row);
    await fixture.whenStable();

    expect(host.model().to).toEqual([]);
    // The malformed one, last in Cc, is Cc's draft now — as a pasted typo
    // would be — so the pending one lands before it.
    expect(host.model().cc).toEqual(['{{contact.email}}', 'not-an-address']);
    expect(cc.chips()[0].getAttribute('data-pending')).toBe('true');
    expect(cc.chips()[1].getAttribute('data-invalid')).toBe('true');
  });

  it('marks where the drop lands with a line, and moves nothing meanwhile', async () => {
    await set({ to: ['ada@example.com'], cc: ['grace@example.com'] });
    const marker = () => cc.row.querySelector<HTMLElement>('[data-slot=drop-marker]');
    expect(marker()).toBeNull();

    const transfer = new Transfer();
    dragEvent(to.chips()[0], 'dragstart', transfer);
    dragEvent(cc.row, 'dragenter', transfer);
    await fixture.whenStable();
    expect(cc.row.getAttribute('data-dropping')).toBe('true');
    expect(marker()?.getAttribute('aria-hidden')).toBe('true');
    // Still a line of text: the row is not redrawn under the pointer.
    expect(cc.chips()[0].hasAttribute('data-inline')).toBe(true);

    // Moving between its own parts is still over it; leaving the row is not.
    dragEvent(cc.row, 'dragleave', transfer, { relatedTarget: cc.chips()[0] });
    await fixture.whenStable();
    expect(marker()).not.toBeNull();
    dragEvent(cc.row, 'dragleave', transfer, { relatedTarget: document.body });
    dragEvent(to.chips()[0], 'dragend', transfer);
    await fixture.whenStable();
    expect(cc.row.hasAttribute('data-dropping')).toBe(false);
    expect(marker()).toBeNull();
    expect(host.model().to).toEqual(['ada@example.com']);
  });

  it('lands before or after the entry under the pointer, where the line was drawn', async () => {
    await set({ to: ['ada@example.com'], cc: ['grace@example.com', 'linus@example.com'] });
    // A laid-out row, as jsdom has none: the list at 0,0; two 100px chips on
    // one 24px line, 4px apart.
    const place = (el: Element, left: number, width: number) =>
      (el.getBoundingClientRect = () => new DOMRect(left, 0, width, 24));
    place(cc.list(), 0, 400);
    place(cc.chips()[0], 0, 100);
    place(cc.chips()[1], 104, 100);

    const transfer = new Transfer();
    dragEvent(to.chips()[0], 'dragstart', transfer);
    // Past grace's middle: after grace, before linus — the line in the gap.
    dragEvent(cc.row, 'dragover', transfer, { x: 70, y: 12 });
    await fixture.whenStable();
    const marker = cc.row.querySelector<HTMLElement>('[data-slot=drop-marker]')!;
    expect([marker.style.left, marker.style.top, marker.style.height]).toEqual([
      '102px',
      '0px',
      '24px',
    ]);
    // Before linus's middle still lands there.
    dragEvent(cc.row, 'dragover', transfer, { x: 130, y: 12 });
    await fixture.whenStable();
    expect(marker.style.left).toBe('102px');

    dragEvent(cc.row, 'drop', transfer, { x: 130, y: 12 });
    dragEvent(to.chips()[0], 'dragend', transfer);
    await fixture.whenStable();
    expect(host.model().cc).toEqual(['grace@example.com', 'ada@example.com', 'linus@example.com']);
    expect(host.model().to).toEqual([]);
  });

  it('lands first before the first entry’s middle, and last past the last one’s', async () => {
    await set({ to: ['ada@example.com', 'alan@example.com'], cc: ['grace@example.com'] });
    cc.list().getBoundingClientRect = () => new DOMRect(0, 0, 400, 24);
    cc.chips()[0].getBoundingClientRect = () => new DOMRect(0, 0, 100, 24);

    let transfer = new Transfer();
    dragEvent(to.chips()[0], 'dragstart', transfer);
    dragEvent(cc.row, 'dragover', transfer, { x: 20, y: 12 });
    await fixture.whenStable();
    expect(cc.row.querySelector<HTMLElement>('[data-slot=drop-marker]')!.style.left).toBe('-4px');
    dragEvent(cc.row, 'drop', transfer, { x: 20, y: 12 });
    dragEvent(to.chips()[0], 'dragend', transfer);
    await fixture.whenStable();
    expect(host.model().cc).toEqual(['ada@example.com', 'grace@example.com']);

    // The laid-out chips are re-rendered: lay them out again.
    cc.chips()[0].getBoundingClientRect = () => new DOMRect(0, 0, 100, 24);
    cc.chips()[1].getBoundingClientRect = () => new DOMRect(104, 0, 100, 24);
    transfer = new Transfer();
    dragEvent(to.chips()[0], 'dragstart', transfer);
    dragEvent(cc.row, 'dragover', transfer, { x: 190, y: 12 });
    await fixture.whenStable();
    expect(cc.row.querySelector<HTMLElement>('[data-slot=drop-marker]')!.style.left).toBe('208px');
    dragEvent(cc.row, 'drop', transfer, { x: 190, y: 12 });
    dragEvent(to.chips()[0], 'dragend', transfer);
    await fixture.whenStable();
    expect(host.model().cc).toEqual(['ada@example.com', 'grace@example.com', 'alan@example.com']);
  });

  it('marks no place on a row that refuses — From, full — and one on a row holding the same address', async () => {
    await set({ from: ['me@example.com'], to: ['ada@example.com'], cc: ['ada@example.com'] });
    const marker = (row: ReturnType<typeof rowParts>) =>
      row.row.querySelector('[data-slot=drop-marker]');
    const transfer = new Transfer();
    dragEvent(to.chips()[0], 'dragstart', transfer);
    dragEvent(from.row, 'dragenter', transfer);
    await fixture.whenStable();
    expect(from.row.hasAttribute('data-dropping')).toBe(false);
    expect(marker(from)).toBeNull();

    dragEvent(cc.row, 'dragenter', transfer);
    await fixture.whenStable();
    expect(marker(cc)).not.toBeNull();
    dragEvent(to.chips()[0], 'dragend', transfer);
  });

  it('plain text dropped from elsewhere is a paste; the typing in progress stays', async () => {
    to.input().value = 'gr';
    to.input().dispatchEvent(new Event('input'));
    const text = new Transfer();
    text.setData('text/plain', 'ada@example.com, nope');
    expect(dragEvent(to.row, 'dragover', text).defaultPrevented).toBe(true);
    expect(text.dropEffect).toBe('copy');
    dragEvent(to.row, 'drop', text);
    await fixture.whenStable();

    expect(host.model().to).toEqual(['ada@example.com']);
    expect(to.input().value).toBe('gr, nope');
    expect(to.input().hasAttribute('data-refused')).toBe(true);
  });

  it('leaves a file drag to the page’s drop zone', () => {
    const files = new Transfer();
    files.setData('Files', '');
    expect(dragEvent(to.row, 'dragover', files).defaultPrevented).toBe(false);
    expect(dragEvent(to.row, 'drop', files).defaultPrevented).toBe(false);
  });

  it('a chip carries nothing another field could take, and an engine’s word does not remove it', async () => {
    await set({ to: ['ada@example.com'] });
    const transfer = new Transfer();
    dragEvent(to.chips()[0], 'dragstart', transfer);
    expect(transfer.types).toEqual([ADDRESS_DRAG_TYPE]);
    // Whatever the engine reports, only an address input's drop removes it.
    transfer.dropEffect = 'move';
    dragEvent(to.chips()[0], 'dragend', transfer);
    await fixture.whenStable();
    expect(host.model().to).toEqual(['ada@example.com']);
  });

  it('refuses a chip from no drag of this page — another window’s', () => {
    const stray = new Transfer();
    stray.setData(ADDRESS_DRAG_TYPE, 'ada@example.com');
    const over = dragEvent(cc.row, 'dragover', stray);
    expect(over.defaultPrevented).toBe(true);
    expect(stray.dropEffect).toBe('none');
  });

  it('a mouse press on a draggable chip keeps its default — or no drag would start; a touch does not', async () => {
    await set({ to: ['ada@example.com'] });
    const press = (pointerType: string) => {
      const name = to.chips()[0].querySelector('[data-slot=name]')!;
      const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
      Object.defineProperty(down, 'pointerType', { value: pointerType });
      name.dispatchEvent(down);
      const mouse = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
      name.dispatchEvent(mouse);
      return mouse.defaultPrevented;
    };
    expect(to.list().getAttribute('tabindex')).toBe('-1');
    expect(press('mouse')).toBe(false);
    expect(press('touch')).toBe(true);
  });

  it('focus parked on the chip list by a press that came to nothing commits and touches on leaving', async () => {
    to.input().focus();
    to.input().value = 'ada@example.com';
    to.input().dispatchEvent(new Event('input'));
    to.list().focus();
    await fixture.whenStable();
    expect(host.envelope.to().touched()).toBe(false);
    expect(host.model().to).toEqual([]);

    to.list().blur();
    await fixture.whenStable();
    expect(host.model().to).toEqual(['ada@example.com']);
    expect(host.envelope.to().touched()).toBe(true);
  });

  describe('a draft the row was left with', () => {
    // Cc lost focus with "gra" and "nope" typed: they sit at the end of its
    // list, malformed, to be handed back to the input on focus.
    beforeEach(async () => {
      await set({ to: ['ada@example.com'], cc: ['linus@example.com', 'gra', 'nope'] });
      cc.list().getBoundingClientRect = () => new DOMRect(0, 0, 400, 24);
      cc.chips().forEach(
        (chip, i) => (chip.getBoundingClientRect = () => new DOMRect(i * 104, 0, 100, 24)),
      );
    });

    it('is no place: over it, the line stays after the last chip, and the drop lands before it', async () => {
      const transfer = new Transfer();
      dragEvent(to.chips()[0], 'dragstart', transfer);
      for (const x of [150, 230, 380]) {
        dragEvent(cc.row, 'dragover', transfer, { x, y: 12 });
        await fixture.whenStable();
        expect(cc.row.querySelector<HTMLElement>('[data-slot=drop-marker]')?.style.left).toBe(
          '104px',
        );
      }
      dragEvent(cc.row, 'drop', transfer, { x: 380, y: 12 });
      dragEvent(to.chips()[0], 'dragend', transfer);
      await fixture.whenStable();
      expect(host.model().cc).toEqual(['linus@example.com', 'ada@example.com', 'gra', 'nope']);
    });

    it('with no chip before it, the line is at the draft’s start', async () => {
      await set({ cc: ['gra'] });
      cc.chips()[0].getBoundingClientRect = () => new DOMRect(0, 0, 40, 24);
      const transfer = new Transfer();
      dragEvent(to.chips()[0], 'dragstart', transfer);
      dragEvent(cc.row, 'dragover', transfer, { x: 30, y: 12 });
      await fixture.whenStable();
      expect(cc.row.querySelector<HTMLElement>('[data-slot=drop-marker]')?.style.left).toBe('-4px');
      dragEvent(cc.row, 'drop', transfer, { x: 30, y: 12 });
      dragEvent(to.chips()[0], 'dragend', transfer);
      await fixture.whenStable();
      expect(host.model().cc).toEqual(['ada@example.com', 'gra']);
    });

    it('moveTo lands before it too', () => {
      const [, toControl, ccControl] = controls();
      expect(toControl.moveTo(ccControl, 'ada@example.com')).toBe(true);
      expect(host.model().cc).toEqual(['linus@example.com', 'ada@example.com', 'gra', 'nope']);
    });
  });

  describe('moveTo — the keyboard’s move', () => {
    it('moves the picked chip to another row, touching both, and the chip says so', async () => {
      await set({ to: ['ada@example.com', 'grace@example.com'] });
      const [, toControl, ccControl] = controls();
      toControl.select('grace@example.com');

      expect(toControl.moveTo(ccControl)).toBe(true);
      await fixture.whenStable();
      expect(host.model().to).toEqual(['ada@example.com']);
      expect(host.model().cc).toEqual(['grace@example.com']);
      expect(toControl.current()).toBeNull();
      expect(host.envelope.to().touched()).toBe(true);
      expect(host.envelope.cc().touched()).toBe(true);
      expect(cc.status(0)).toBe('Moved to Cc: grace@example.com');
    });

    it('absorbs onto a duplicate: it leaves, the target keeps its own', async () => {
      await set({ to: ['Ada <ada@example.com>'], cc: ['ada@example.com'] });
      const [, toControl, ccControl] = controls();

      expect(toControl.moveTo(ccControl, 'Ada <ada@example.com>')).toBe(true);
      await fixture.whenStable();
      expect(host.model().to).toEqual([]);
      expect(host.model().cc).toEqual(['ada@example.com']);
      expect(cc.status(0)).toBe('Moved to Cc: Ada <ada@example.com>');
    });

    it('moves nothing onto a full row, a locked row, or itself', async () => {
      await set({ from: ['me@example.com'], to: ['ada@example.com'] });
      const [fromControl, toControl, , bccControl] = controls();

      expect(toControl.moveTo(fromControl, 'ada@example.com')).toBe(false);
      expect(toControl.moveTo(toControl, 'ada@example.com')).toBe(false);
      expect(toControl.moveTo(bccControl)).toBe(false); // nothing picked
      host.bccReadonly.set(true);
      await fixture.whenStable();
      expect(toControl.moveTo(bccControl, 'ada@example.com')).toBe(false);
      expect(host.model().to).toEqual(['ada@example.com']);
      expect(host.envelope.to().touched()).toBe(false);
    });
  });
});

/** The model with only the rows named compared — the rest are empty. */
function envelopeWith(rows: Record<string, string[]>) {
  return { from: [], to: [], cc: [], bcc: [], replyTo: [], ...rows };
}

/** Two writers on one page, each its own group, and a row in none. */
@Component({
  imports: [AddressInput, AddressDragGroup],
  template: `
    <section emailAddressDragGroup>
      <div email-address-input aria-label="To" [(value)]="firstTo"></div>
      <div email-address-input aria-label="Cc" [(value)]="firstCc"></div>
    </section>
    <section emailAddressDragGroup>
      <div email-address-input aria-label="To" [(value)]="secondTo"></div>
    </section>
    <div email-address-input aria-label="Loose" [(value)]="loose"></div>
  `,
})
class GroupsHost {
  readonly firstTo = signal(['ada@example.com']);
  readonly firstCc = signal<string[]>([]);
  readonly secondTo = signal<string[]>([]);
  readonly loose = signal<string[]>([]);
}

describe('AddressDragGroup', () => {
  it('keeps chips among the inputs of one group', async () => {
    const fixture = TestBed.createComponent(GroupsHost);
    const host = fixture.componentInstance;
    await fixture.whenStable();
    const [firstTo, firstCc, secondTo, loose] = [
      ...fixture.nativeElement.querySelectorAll('[email-address-input]'),
    ].map((row) => rowParts(row as HTMLElement));

    // Another writer's row, and a row in no group, refuse it.
    expect(dragChip(firstTo.chips()[0], secondTo.row).accepted).toBe(false);
    expect(dragChip(firstTo.chips()[0], loose.row).accepted).toBe(false);
    await fixture.whenStable();
    expect(host.secondTo()).toEqual([]);
    expect(host.loose()).toEqual([]);
    expect(host.firstTo()).toEqual(['ada@example.com']);

    // A row of its own writer takes it.
    expect(dragChip(firstTo.chips()[0], firstCc.row).accepted).toBe(true);
    await fixture.whenStable();
    expect(host.firstCc()).toEqual(['ada@example.com']);
    expect(host.firstTo()).toEqual([]);
  });
});
