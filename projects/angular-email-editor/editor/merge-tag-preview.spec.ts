import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  Extension,
  MergeTagAnswer,
  createMergeTagPreview,
  emailExtensions,
} from '@h-k-dev/angular-email-editor';
import { ActionTrigger } from '@h-k-dev/angular-email-editor/actions';
import { EmailEditor } from './editor';
import {
  EditorMergeTagPreview,
  MergeTagPreviewSwitch,
  injectMergeTagPreview,
} from './merge-tag-preview';

const TEMPLATE = '<div>Dear {{ customer_lastName }}, your file {{ case_reference }}.</div>';

@Component({
  imports: [ActionTrigger, EmailEditor, MergeTagPreviewSwitch],
  template: `
    <div
      class="body"
      [emailEditor]="kit()"
      [(value)]="html"
      [(emailMergeTagPreview)]="filled"
      [emailMergeTagPreviewOf]="record()"
      #preview="emailMergeTagPreview"
    >
      <button class="toggle" emailAction="preview-placeholders"></button>
    </div>
  `,
})
class Host {
  readonly asked: string[][] = [];
  /** The record the evaluator reads: its name is every value's prefix. */
  readonly record = signal('A');
  /** What the evaluator waits for before it answers. */
  gate: Promise<void> = Promise.resolve();
  readonly resolve = async (expressions: string[]): Promise<MergeTagAnswer[]> => {
    this.asked.push(expressions);
    await this.gate;
    return expressions.map((expr) => `${this.record()}:${expr}`);
  };
  readonly withPreview: readonly Extension[] = [
    ...emailExtensions,
    createMergeTagPreview({ resolve: this.resolve }),
  ];
  readonly kit = signal<readonly Extension[]>(this.withPreview);
  readonly html = signal(TEMPLATE);
  readonly filled = signal(false);
  readonly body = viewChild.required(EmailEditor);
  readonly preview = viewChild.required(MergeTagPreviewSwitch);
  readonly held: EditorMergeTagPreview = injectMergeTagPreview(() => this.body().editor());
}

describe('[emailMergeTagPreview]', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  const dom = () => host.body().editor()!.view.dom;
  const values = () =>
    [...dom().querySelectorAll('.aee-merge-tag-preview')].map((el) => el.textContent);
  const settle = async () => {
    await fixture.whenStable();
    await new Promise((done) => setTimeout(done));
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await settle();
  });

  afterEach(() => fixture.destroy());

  it('shows the values while the binding is true — and the bound value stays the template', async () => {
    const written = host.html();
    host.filled.set(true);
    await settle();
    expect(values()).toEqual(['A:customer_lastName', 'A:case_reference']);
    expect(host.html()).toBe(written);
    expect(host.preview().pending()).toBe(false);

    host.filled.set(false);
    await settle();
    expect(values()).toEqual([]);
    expect(host.html()).toBe(written);
  });

  it('follows a preview turned on and off by its action', async () => {
    const toggle = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.toggle')!;
    toggle.click();
    await settle();
    expect(host.filled()).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(values()).toHaveLength(2);

    toggle.click();
    await settle();
    expect(host.filled()).toBe(false);
    expect(values()).toEqual([]);
  });

  it('asks afresh when the record changes while on — and not while off', async () => {
    host.record.set('B');
    await settle();
    expect(host.asked).toHaveLength(0);

    host.filled.set(true);
    await settle();
    expect(values()).toEqual(['B:customer_lastName', 'B:case_reference']);

    host.record.set('C');
    await settle();
    expect(values()).toEqual(['C:customer_lastName', 'C:case_reference']);
    expect(host.asked).toHaveLength(2);
  });

  it('says it is waiting while the evaluator is out', async () => {
    let answer!: () => void;
    host.gate = new Promise((done) => (answer = done));
    host.filled.set(true);
    await settle();
    expect(host.preview().pending()).toBe(true);
    expect(values()).toEqual([]);
    answer();
    await settle();
    await settle();
    expect(values()).toHaveLength(2);
    expect(host.preview().pending()).toBe(false);
  });

  it('is the same preview held from code', async () => {
    expect(host.held.available()).toBe(true);
    expect(host.held.show()).toBe(true);
    await settle();
    expect(host.held.on()).toBe(true);
    expect(host.filled()).toBe(true);
    host.record.set('B');
    expect(host.held.refresh()).toBe(true);
    await settle();
    expect(values()[0]).toBe('B:customer_lastName');
  });

  it('starts off on a new editor, and says so', async () => {
    host.filled.set(true);
    await settle();
    host.kit.set([...host.withPreview]);
    await settle();
    expect(host.filled()).toBe(false);
    expect(values()).toEqual([]);
  });

  it('says what is missing when the kit holds no preview', async () => {
    host.kit.set(emailExtensions);
    await settle();
    expect(host.held.available()).toBe(false);
    host.filled.set(true);
    expect(() => TestBed.tick()).toThrowError(/createMergeTagPreview/);
  });
});
