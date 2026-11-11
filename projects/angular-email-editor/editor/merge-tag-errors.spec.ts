import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form, submit } from '@angular/forms/signals';
import { REMOVE_MERGE_TAG, emailExtensions } from '@h-k-dev/angular-email-editor';
import { EmailEditor, MergeTagRevealed } from './editor';
import { MERGE_TAG_UNFILLED, checkMergeTagValues, isMergeTagUnfilled } from './merge-tag-errors';

/** The host's evaluator: a value for a few fields, none for the rest. */
const VALUES: Record<string, string> = { firstName: 'Ada', 'order.item': 'the kit' };
const resolve = async (expressions: string[]) => expressions.map((expr) => VALUES[expr] ?? '');

@Component({
  imports: [EmailEditor, FormField],
  template: `
    <div
      [emailEditor]="kit"
      [formField]="fields.body"
      (emailEditorMergeTagRevealed)="revealed.push($event)"
    ></div>
  `,
})
class Host {
  readonly kit = emailExtensions;
  readonly model = signal({ body: '' });
  readonly body = viewChild.required(EmailEditor);
  readonly revealed: MergeTagRevealed[] = [];
  sent = 0;
  readonly fields = form(this.model, {
    submission: {
      action: async (field) => {
        const unfilled = await checkMergeTagValues(field.body, this.body(), { resolve });
        if (unfilled.length) return unfilled;
        this.sent++;
        return undefined;
      },
    },
  });
}

describe('checkMergeTagValues and the editor’s errors', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  const view = () => host.body().editor()!.view;
  const selected = () => {
    const { from, to } = view().state.selection;
    return view().state.doc.textBetween(from, to);
  };
  const write = async (html: string) => {
    host.model.set({ body: html });
    await fixture.whenStable();
  };

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('names each placeholder without a value, once, in reading order — text and attributes', async () => {
    await write(
      '<div>{{ salutation }} {{ firstName }}, <a href="https://x.example/{{ case.id }}">Akte</a> {{ salutation }}</div>' +
        '<div>{{ order.item }} – {{ advisor.name }}</div>',
    );
    const errors = await checkMergeTagValues(host.fields.body, host.body(), { resolve });
    expect(errors.map((error) => [error.kind, error.expr, error.message])).toEqual([
      [MERGE_TAG_UNFILLED, 'salutation', 'No value for {{ salutation }}'],
      [MERGE_TAG_UNFILLED, 'advisor.name', 'No value for {{ advisor.name }}'],
      [MERGE_TAG_UNFILLED, 'case.id', 'No value for {{ case.id }}'],
    ]);
    expect(errors.every((error) => error.fieldTree === host.fields.body)).toBe(true);
    expect(errors.every(isMergeTagUnfilled)).toBe(true);
  });

  it('one the host would take out is no error — it stands for nothing, on its word', async () => {
    await write('<div>{{ salutation }} {{ suffix }}</div>');
    const errors = await checkMergeTagValues(host.fields.body, host.body(), {
      resolve: async (expressions) =>
        expressions.map((expr) => (expr === 'suffix' ? REMOVE_MERGE_TAG : '')),
    });
    expect(errors.map((error) => error.expr)).toEqual(['salutation']);
  });

  it('asks nothing when the document has no placeholder, or no editor yet', async () => {
    const asked: string[][] = [];
    const counting = async (expressions: string[]) => (asked.push(expressions), resolve(expressions));
    await write('<div>Hallo</div>');
    expect(await checkMergeTagValues(host.fields.body, host.body(), { resolve: counting })).toEqual([]);
    expect(await checkMergeTagValues(host.fields.body, undefined, { resolve: counting })).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('takes the host’s words', async () => {
    await write('<div>{{ salutation }}</div>');
    const [error] = await checkMergeTagValues(host.fields.body, host.body(), {
      resolve,
      message: (expr) => `Kein Wert für ${expr}`,
    });
    expect(error.message).toBe('Kein Wert für salutation');
  });

  it('a submit stops on them, and the form’s focus lands on the first token — then the next', async () => {
    await write('<div>{{ salutation }} {{ firstName }}, Ihr {{ order.item }} – {{ advisor.name }}</div>');
    expect(await submit(host.fields)).toBe(false);
    await fixture.whenStable();
    expect(host.sent).toBe(0);
    expect(host.fields.body().errors().map((error) => (error as { expr?: string }).expr)).toEqual([
      'salutation',
      'advisor.name',
    ]);

    host.fields.body().focusBoundControl();
    expect(selected()).toBe('{{ salutation }}');
    expect(document.activeElement).toBe(view().dom);
    expect(host.revealed.map(({ expr, element }) => [expr, element.textContent])).toEqual([
      ['salutation', '{{ salutation }}'],
    ]);

    // Written over: the errors go with the value they were about.
    view().dispatch(view().state.tr.insertText('Liebe', view().state.selection.from, view().state.selection.to));
    await fixture.whenStable();
    expect(host.fields.body().errors()).toEqual([]);

    // The next send names the one left.
    expect(await submit(host.fields)).toBe(false);
    await fixture.whenStable();
    host.fields.body().focusBoundControl();
    expect(selected()).toBe('{{ advisor.name }}');

    view().dispatch(view().state.tr.insertText('Frau Wild', view().state.selection.from, view().state.selection.to));
    await fixture.whenStable();
    expect(await submit(host.fields)).toBe(true);
    expect(host.sent).toBe(1);
  });

  it('without such an error, the form’s focus is the caret in the text, as ever', async () => {
    await write('<div>{{ salutation }}</div>');
    host.fields.body().focusBoundControl();
    expect(document.activeElement).toBe(view().dom);
    expect(host.revealed).toEqual([]);
    expect(view().state.selection.empty).toBe(true);
  });
});
