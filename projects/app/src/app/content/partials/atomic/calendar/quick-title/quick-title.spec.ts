import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { EventEdit } from '../../../../../core/calendar/calendar-event';
import { QuickTitle } from './quick-title';

@Component({
  imports: [QuickTitle],
  template: `<calendar-quick-title [(value)]="edit" (save)="saved.push($event)" />`,
})
class Host {
  readonly edit = signal<EventEdit>({
    title: '',
    start: '2026-10-30T09:00',
    end: '2026-10-30T10:30',
    allDay: false,
    color: 'peacock',
    location: '',
    description: '',
  });
  readonly saved: EventEdit[] = [];
}

describe('QuickTitle', () => {
  const start = async () => {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const title = root.querySelector<HTMLInputElement>('.quick-title__field')!;
    const note = () => root.querySelector('note-editor');
    const words = () => root.querySelector<HTMLElement>('.note-editor__text');
    return { fixture, root, title, note, words };
  };

  const key = (target: Element, key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };

  /** A submit, as the browser's Enter in the title sends one. */
  const submitted = async (root: HTMLElement) => {
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve));
  };

  it('has no description until Shift+Enter in the title — then the caret is in it', async () => {
    const { fixture, title, note, words } = await start();
    expect(note()).toBeNull();

    const press = key(title, 'Enter', { shiftKey: true });
    await fixture.whenStable();
    // Never the form sent.
    expect(press.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.saved).toHaveLength(0);
    expect(note()).not.toBeNull();
    expect(words()!.contains(document.activeElement)).toBe(true);
  });

  it('keeps the event on Enter in the title, the title written through', async () => {
    const { fixture, root, title } = await start();
    title.value = 'Standup';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await submitted(root);
    expect(fixture.componentInstance.saved).toEqual([
      expect.objectContaining({ title: 'Standup', description: '' }),
    ]);
  });

  it('keeps the event on Mod-Enter in the description, as an email is sent', async () => {
    const { fixture, root, title, words } = await start();
    key(title, 'Enter', { shiftKey: true });
    await fixture.whenStable();
    fixture.componentInstance.edit.update((edit) => ({ ...edit, description: 'Agenda' }));
    await fixture.whenStable();

    const form = root.querySelector('form')!;
    let sent = 0;
    form.requestSubmit = () => void sent++;
    // Mod is Ctrl off a Mac — jsdom's navigator.
    key(words()!, 'Enter', { ctrlKey: true });
    expect(sent).toBe(1);
  });

  it('puts the empty description away on Backspace, the caret back in the title', async () => {
    const { fixture, title, note, words } = await start();
    key(title, 'Enter', { shiftKey: true });
    await fixture.whenStable();

    key(words()!, 'Backspace');
    await fixture.whenStable();
    expect(note()).toBeNull();
    expect(document.activeElement).toBe(title);
  });
});
