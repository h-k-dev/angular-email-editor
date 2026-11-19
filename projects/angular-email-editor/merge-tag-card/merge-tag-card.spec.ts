import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MergeTagHover } from '@h-k-dev/angular-email-editor';
import { MergeTagCard, MergeTagCardAction } from './merge-tag-card';

const element = document.createElement('span');

/** A placeholder as the editor reports it, its ways spied on. */
function tagOf(state: MergeTagHover['state'], ways: MergeTagCardAction[], more: Partial<MergeTagHover> = {}) {
  const tag: MergeTagHover = { element, state, expr: 'cf_12', value: '', text: '', edited: false, ...more };
  for (const way of ways) (tag as unknown as Record<string, unknown>)[way] = vi.fn(() => true);
  return tag;
}

@Component({
  imports: [MergeTagCard],
  template: `
    <div
      email-merge-tag-card
      [tag]="tag()"
      [type]="type()"
      [note]="note()"
      parseLabel="Parse text"
      (done)="done.push($event)"
    ></div>
  `,
})
class Host {
  readonly tag = signal(tagOf('token', ['parse', 'write', 'remove']));
  readonly type = signal<string | null>(null);
  readonly note = signal<string | null>(null);
  readonly done: MergeTagCardAction[] = [];
  readonly card = viewChild.required(MergeTagCard);
}

describe('MergeTagCard', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let root: HTMLElement;

  const rows = () => [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  const actions = () => rows().map((row) => row.getAttribute('data-action'));
  const row = (action: MergeTagCardAction) => rows().find((r) => r.getAttribute('data-action') === action)!;
  const field = () => root.querySelector('textarea');
  const applyButton = () => root.querySelector<HTMLButtonElement>('.email-merge-tag-card__apply')!;
  const show = async (tag: MergeTagHover) => {
    host.tag.set(tag);
    await fixture.whenStable();
  };
  const typeIn = async (text: string) => {
    field()!.value = text;
    field()!.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    root = fixture.nativeElement.querySelector('[email-merge-tag-card]');
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
  });

  afterEach(() => fixture.nativeElement.remove());

  it('says the token as written — and its type, where the host knows it', async () => {
    expect(root.querySelector('.email-merge-tag-card__token')!.textContent).toBe('{{ cf_12 }}');
    expect(root.querySelector('.email-merge-tag-card__type')).toBeNull();

    host.type.set('Date');
    await fixture.whenStable();
    expect(root.querySelector('.email-merge-tag-card__type')!.textContent).toBe('Date');
  });

  it('keeps saying the type after the parse: on a filled value too', async () => {
    host.type.set('Date');
    await show(tagOf('filled', ['edit', 'restore'], { value: '01.02.2026', text: '01.02.2026' }));
    expect(root.querySelector('.email-merge-tag-card__type')!.textContent).toBe('Date');
  });

  it('shows the host’s note, and a previewed value', async () => {
    host.note.set('No value');
    await show(tagOf('previewed', ['unparse', 'remove'], { value: 'Berlin', text: 'Berlin' }));
    expect(root.querySelector('.email-merge-tag-card__note')!.textContent).toBe('No value');
    expect(root.querySelector('.email-merge-tag-card__value')!.textContent).toBe('Berlin');
  });

  describe('the rows are the ways the placeholder has', () => {
    it('before a parse, in a message: Parse, Write a value, Remove', () => {
      expect(actions()).toEqual(['parse', 'write', 'remove']);
      expect(row('parse').textContent!.trim()).toBe('Parse text');
    });

    it('before a parse, in a template: Parse and Remove — no value is written there', async () => {
      await show(tagOf('token', ['parse', 'remove']));
      expect(actions()).toEqual(['parse', 'remove']);
    });

    it('after a parse, a filled value: Edit, Reset while written over, Restore', async () => {
      await show(tagOf('filled', ['edit', 'restore']));
      expect(actions()).toEqual(['edit', 'restore']);
      await show(tagOf('filled', ['edit', 'reset', 'restore'], { edited: true, value: 'Müller' }));
      expect(actions()).toEqual(['edit', 'reset', 'restore']);
      expect(row('reset').title).toBe('Müller');
    });

    it('after a parse, a previewed value: Show placeholder and Remove', async () => {
      await show(tagOf('previewed', ['unparse', 'remove']));
      expect(actions()).toEqual(['unparse', 'remove']);
    });
  });

  it('runs a row’s way and says it is done', () => {
    const tag = host.tag();
    row('parse').click();
    expect(tag.parse).toHaveBeenCalledTimes(1);
    expect(host.done).toEqual(['parse']);
  });

  it('walks the rows with the arrows, Home and End', () => {
    host.card().focus();
    expect(document.activeElement).toBe(row('parse'));
    const press = (key: string) =>
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    press('ArrowDown');
    expect(document.activeElement).toBe(row('write'));
    press('End');
    expect(document.activeElement).toBe(row('remove'));
    press('ArrowDown');
    expect(document.activeElement).toBe(row('parse'));
    press('ArrowUp');
    expect(document.activeElement).toBe(row('remove'));
    press('Home');
    expect(document.activeElement).toBe(row('parse'));
  });

  it('picks the row the focus is on with Enter or Space — once', () => {
    const tag = host.tag();
    host.card().focus();
    const down = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(down);
    // The button's own click is kept from following the key.
    expect(down.defaultPrevented).toBe(true);
    expect(tag.parse).toHaveBeenCalledTimes(1);

    row('remove').focus();
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(tag.remove).toHaveBeenCalledTimes(1);
    expect(host.done).toEqual(['parse', 'remove']);
  });

  describe('the field', () => {
    it('opens empty for a token, with Apply an icon button at its end — disabled until something is written', async () => {
      row('write').click();
      await fixture.whenStable();
      expect(rows()).toEqual([]);
      expect(field()!.value).toBe('');
      expect(host.done).toEqual([]);

      const apply = applyButton();
      expect(apply.parentElement).toBe(field()!.parentElement);
      expect(apply.previousElementSibling).toBe(field());
      expect(apply.getAttribute('aria-label')).toBe('Apply');
      expect(apply.textContent!.trim()).toBe('');
      expect(apply.disabled).toBe(true);
    });

    it('writes the value in a token’s place on Apply', async () => {
      const tag = host.tag();
      row('write').click();
      await fixture.whenStable();
      await typeIn('Schmidt');
      applyButton().click();
      expect(tag.write).toHaveBeenCalledWith('Schmidt');
      expect(host.done).toEqual(['write']);
    });

    it('opens over a filled value as it reads, and Enter applies — Shift-Enter is a line break', async () => {
      const tag = tagOf('filled', ['edit', 'restore'], { value: 'Müller', text: 'Meier' });
      await show(tag);
      row('edit').click();
      await fixture.whenStable();
      expect(field()!.value).toBe('Meier');

      await typeIn('Meier-Schulz');
      field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
      expect(tag.edit).not.toHaveBeenCalled();
      field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(tag.edit).toHaveBeenCalledWith('Meier-Schulz');
      expect(host.done).toEqual(['edit']);
    });

    it('stays open when the editor refuses the value', async () => {
      const tag = host.tag();
      (tag.write as ReturnType<typeof vi.fn>).mockReturnValue(false);
      row('write').click();
      await fixture.whenStable();
      await typeIn('x');
      applyButton().click();
      expect(host.done).toEqual([]);
      expect(field()).not.toBeNull();
    });

    it('closes for another placeholder under the card', async () => {
      row('write').click();
      await fixture.whenStable();
      const other = tagOf('token', ['parse', 'remove'], { element: document.createElement('span') });
      await show(other);
      expect(field()).toBeNull();
      expect(actions()).toEqual(['parse', 'remove']);
    });
  });
});
