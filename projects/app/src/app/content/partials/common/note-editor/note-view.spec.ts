import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { NoteView } from './note-view';

@Component({
  imports: [NoteView],
  template: `<note-view [note]="note()" />`,
})
class Host {
  readonly note = signal('');
}

describe('NoteView', () => {
  const shown = async (note: string) => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.note.set(note);
    await fixture.whenStable();
    return (fixture.nativeElement as HTMLElement).querySelector('note-view')!;
  };

  it('shows a note’s Markdown: marks, links and lists', async () => {
    const view = await shown('**Bring** [the call](https://x.test)\n\n1. milk\n2. eggs');
    expect(view.querySelector('strong')!.textContent).toBe('Bring');
    expect(view.querySelector('a')!.getAttribute('href')).toBe('https://x.test');
    expect(view.querySelectorAll('ol > li')).toHaveLength(2);
  });

  it('keeps a plain-text note’s lines and never reads HTML in it', async () => {
    const view = await shown('Room <b>4</b>\nsecond line');
    expect(view.querySelector('b')).toBeNull();
    expect(view.querySelectorAll('br')).toHaveLength(1);
    expect(view.textContent).toBe('Room <b>4</b>second line');
  });
});
