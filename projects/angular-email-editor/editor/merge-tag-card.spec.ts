import type { MergeTagHover } from '@h-k-dev/angular-email-editor';
import { MergeTagCardAction, mergeTagCard } from './merge-tag-card';

const element = document.createElement('span');

/** A placeholder as the editor reports it, its ways spied on. */
function tagOf(
  state: MergeTagHover['state'],
  ways: MergeTagCardAction[],
  more: Partial<MergeTagHover> = {},
) {
  const tag: MergeTagHover = { element, state, expr: 'cf_12', value: '', text: '', edited: false, ...more };
  for (const way of ways) (tag as unknown as Record<string, unknown>)[way] = vi.fn(() => true);
  return tag;
}

describe('mergeTagCard', () => {
  let done: MergeTagCardAction[];
  let opened: MergeTagHover[];
  const make = () =>
    mergeTagCard({ done: (action) => done.push(action), fieldOpened: (tag) => opened.push(tag) });

  beforeEach(() => {
    done = [];
    opened = [];
  });

  it('is about nothing until it is shown a placeholder', () => {
    const card = make();
    expect(card.tag()).toBeNull();
    expect(card.state()).toBeNull();
    expect(card.token()).toBe('');
    expect(card.rows()).toEqual([]);
    card.choose('parse');
    card.apply();
    expect(done).toEqual([]);
  });

  it('says the token as written and its expression — what a type is looked up by, before a parse and after', () => {
    const card = make();
    card.show(tagOf('token', ['parse']));
    expect([card.token(), card.expr(), card.state()]).toEqual(['{{ cf_12 }}', 'cf_12', 'token']);
    card.show(tagOf('filled', ['edit'], { value: '01.02.2026', text: '01.02.2026' }));
    expect([card.token(), card.expr(), card.state()]).toEqual(['{{ cf_12 }}', 'cf_12', 'filled']);
  });

  it('says the value a preview draws — a filled one is in the text itself', () => {
    const card = make();
    card.show(tagOf('previewed', ['unparse'], { value: 'Berlin' }));
    expect(card.value()).toBe('Berlin');
    card.show(tagOf('filled', ['edit'], { value: 'Berlin', text: 'Berlin' }));
    expect(card.value()).toBe('');
  });

  describe('the rows are the ways the placeholder has', () => {
    const rowsOf = (tag: MergeTagHover) => {
      const card = make();
      card.show(tag);
      return card.rows();
    };

    it('before a parse, in a message: parse, write, remove', () => {
      expect(rowsOf(tagOf('token', ['remove', 'write', 'parse']))).toEqual(['parse', 'write', 'remove']);
    });

    it('before a parse, in a template: parse and remove — no value is written there', () => {
      expect(rowsOf(tagOf('token', ['parse', 'remove']))).toEqual(['parse', 'remove']);
    });

    it('after a parse, a filled value: edit, reset while written over, restore', () => {
      expect(rowsOf(tagOf('filled', ['edit', 'restore']))).toEqual(['edit', 'restore']);
      expect(rowsOf(tagOf('filled', ['restore', 'reset', 'edit']))).toEqual(['edit', 'reset', 'restore']);
    });

    it('after a parse, a previewed value: unparse and remove', () => {
      expect(rowsOf(tagOf('previewed', ['remove', 'unparse']))).toEqual(['unparse', 'remove']);
    });
  });

  it('runs a row’s way and says it is done', () => {
    const card = make();
    const tag = tagOf('token', ['parse', 'write', 'remove']);
    card.show(tag);
    card.choose('parse');
    expect(tag.parse).toHaveBeenCalledTimes(1);
    expect(done).toEqual(['parse']);
  });

  it('does nothing for a way the placeholder has not', () => {
    const card = make();
    card.show(tagOf('token', ['parse', 'remove']));
    card.choose('write');
    expect(card.editing()).toBe(false);
    expect(done).toEqual([]);
  });

  describe('the field', () => {
    it('opens empty for a token, tells the host, and is not done yet', () => {
      const card = make();
      const tag = tagOf('token', ['parse', 'write', 'remove']);
      card.show(tag);
      card.draft.set('left over');
      card.choose('write');
      expect(card.editing()).toBe(true);
      expect(card.draft()).toBe('');
      expect(card.canApply()).toBe(false);
      expect(opened).toEqual([tag]);
      expect(done).toEqual([]);
    });

    it('writes the value in a token’s place on apply', () => {
      const card = make();
      const tag = tagOf('token', ['write']);
      card.show(tag);
      card.choose('write');
      card.apply();
      expect(tag.write).not.toHaveBeenCalled();
      card.draft.set('Schmidt');
      expect(card.canApply()).toBe(true);
      card.apply();
      expect(tag.write).toHaveBeenCalledWith('Schmidt');
      expect(done).toEqual(['write']);
    });

    it('opens over a filled value as it reads; Enter applies, Shift-Enter is a line break', () => {
      const card = make();
      const tag = tagOf('filled', ['edit', 'restore'], { value: 'Müller', text: 'Meier' });
      card.show(tag);
      card.choose('edit');
      expect(card.draft()).toBe('Meier');

      const field = document.createElement('textarea');
      field.value = 'Meier-Schulz';
      card.fieldInput({ target: field } as unknown as Event);
      card.fieldKeys(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
      expect(tag.edit).not.toHaveBeenCalled();
      const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      card.fieldKeys(enter);
      expect(enter.defaultPrevented).toBe(true);
      expect(tag.edit).toHaveBeenCalledWith('Meier-Schulz');
      expect(done).toEqual(['edit']);
    });

    it('stays open when the editor refuses the value', () => {
      const card = make();
      const tag = tagOf('token', ['write']);
      (tag.write as ReturnType<typeof vi.fn>).mockReturnValue(false);
      card.show(tag);
      card.choose('write');
      card.draft.set('x');
      card.apply();
      expect(done).toEqual([]);
      expect(card.editing()).toBe(true);
    });

    it('closes for another placeholder under the card, and stays for the same one read anew', () => {
      const card = make();
      card.show(tagOf('token', ['write']));
      card.choose('write');
      // The same piece, reported again (it changed under the card).
      card.show(tagOf('token', ['write']));
      expect(card.editing()).toBe(true);
      card.show(tagOf('token', ['parse'], { element: document.createElement('span') }));
      expect(card.editing()).toBe(false);
    });
  });
});
