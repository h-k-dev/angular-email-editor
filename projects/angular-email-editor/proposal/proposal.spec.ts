import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TextSelection } from 'prosemirror-state';
import {
  ContentStreamWriter,
  Editor,
  createContentProposal,
  createContentStream,
  createEditor,
  richTextExtensions,
} from 'angular-email-editor';
import {
  EditorProposal,
  Proposal,
  ProposalAccept,
  ProposalDiscard,
  ProposalKeys,
  injectProposal,
} from './proposal';

@Component({
  imports: [ProposalAccept, ProposalDiscard],
  template: `
    <button
      class="apply"
      [emailProposalAccept]="proposal"
      #apply="emailProposalAccept"
      [disabled]="apply.disabled()"
    >
      Apply
    </button>
    <button
      class="discard"
      [emailProposalDiscard]="proposal"
      #discard="emailProposalDiscard"
      [disabled]="discard.disabled()"
    >
      Discard
    </button>
  `,
})
class Host {
  readonly editor = signal<Editor | undefined>(undefined);
  readonly proposal: EditorProposal = injectProposal(() => this.editor());
  readonly apply = viewChild.required<ProposalAccept>('apply');
}

/** An editor to propose into, with the caret at the end of its one
    paragraph and a flat, predictable geometry. */
function mountEditor(): { editor: Editor; mount: HTMLElement } {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const editor = createEditor({
    parent: mount,
    extensions: [
      ...richTextExtensions,
      createContentStream({ reveal: 'instant' }),
      createContentProposal(),
    ],
    content: '<p>We met last week.</p>',
  });
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1),
    ),
  );
  vi.spyOn(editor.view, 'coordsAtPos').mockImplementation((pos) => ({
    left: 10 + pos,
    right: 11 + pos,
    top: 100,
    bottom: 120,
  }));
  return { editor, mount };
}

/** The kit's canonical form of an HTML — what `getHTML` makes of it. */
function canonical(mount: HTMLElement, content: string): string {
  const other = createEditor({ parent: mount, extensions: richTextExtensions, content });
  const out = other.getHTML();
  other.destroy();
  return out;
}

describe('injectProposal', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let editor: Editor;
  let mount: HTMLElement;

  const canon = (content: string) => canonical(mount, content);
  const button = (name: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(`.${name}`)!;
  const settle = () => fixture.whenStable();

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    ({ editor, mount } = mountEditor());
    host.editor.set(editor);
    await settle();
  });

  afterEach(() => {
    fixture.destroy();
    editor.destroy();
    mount.remove();
  });

  it('is idle without a proposal: both triggers disabled, the box the caret’s', () => {
    expect(host.proposal.active()).toBe(false);
    expect(button('apply').disabled).toBe(true);
    expect(button('discard').disabled).toBe(true);
    expect(host.proposal.box()).toEqual({ left: 28, top: 100, width: 1, height: 20 });
  });

  it('proposes at the selection, follows the writing, and the triggers do their job', async () => {
    let writer!: ContentStreamWriter;
    let finish!: () => void;
    host.proposal.propose(
      (given) => {
        writer = given;
        return new Promise<void>((resolve) => (finish = resolve));
      },
      { format: 'html' },
    );
    await settle();
    expect(host.proposal.active()).toBe(true);
    expect(host.proposal.streaming()).toBe(true);
    // Discard is there from the first moment; Apply waits for the writing.
    expect(button('discard').disabled).toBe(false);
    expect(button('apply').disabled).toBe(true);
    writer.write(' Bitte lesen.');
    await settle();
    expect(host.proposal.range()).toEqual({ from: 18, to: 31 });
    // The box: the proposal's line, from its start to its end.
    expect(host.proposal.box()).toEqual({ left: 28, top: 100, width: 14, height: 20 });
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
    expect(host.proposal.streaming()).toBe(false);
    expect(button('apply').disabled).toBe(false);

    button('apply').click();
    await settle();
    expect(host.proposal.active()).toBe(false);
    expect(editor.getHTML()).toBe(canon('<p>We met last week. Bitte lesen.</p>'));
    expect(button('apply').disabled).toBe(true);
  });

  it('discard takes it out, mid-stream too', async () => {
    let writer!: ContentStreamWriter;
    host.proposal.propose((given) => {
      writer = given;
      return new Promise<void>(() => undefined);
    });
    await settle();
    writer.write(' Bitte');
    await settle();
    expect(editor.getHTML()).toContain('Bitte');
    button('discard').click();
    await settle();
    expect(editor.getHTML()).toBe(canon('<p>We met last week.</p>'));
    expect(host.proposal.active()).toBe(false);
  });

  it('is nothing without an editor', () => {
    host.editor.set(undefined);
    expect(host.proposal.propose(() => undefined)).toBeNull();
    expect(host.proposal.accept()).toBe(false);
    expect(host.proposal.discard()).toBe(false);
  });
});

// The same, from the template's side: the proposal as a directive on the
// panel's element, bare triggers taking it by injection, and the keys.
@Component({
  imports: [Proposal, ProposalAccept, ProposalDiscard, ProposalKeys],
  template: `
    <div
      class="panel"
      [emailProposal]="editor()"
      #p="emailProposal"
      emailProposalKeys
      (accepted)="accepted = accepted + 1"
      (escape)="escapes.push($event)"
    >
      <span class="state">{{ p.active() ? 'proposed' : 'idle' }}</span>
      <button
        class="apply"
        emailProposalAccept
        #apply="emailProposalAccept"
        [disabled]="apply.disabled()"
      >
        Apply
      </button>
      <button
        class="discard"
        emailProposalDiscard
        #discard="emailProposalDiscard"
        [disabled]="discard.disabled()"
      >
        Discard
      </button>
    </div>
  `,
})
class Provided {
  readonly editor = signal<Editor | undefined>(undefined);
  readonly proposal = viewChild.required(Proposal);
  accepted = 0;
  readonly escapes: KeyboardEvent[] = [];
}

@Component({
  imports: [ProposalAccept],
  template: `<button emailProposalAccept>Apply</button>`,
})
class Unprovided {}

describe('Proposal directive, and the keys', () => {
  let fixture: ComponentFixture<Provided>;
  let host: Provided;
  let editor: Editor;
  let mount: HTMLElement;

  const button = (name: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(`.${name}`)!;
  const text = () => (fixture.nativeElement as HTMLElement).querySelector('.state')!.textContent;
  /** A key pressed in the text — or, `where` given, anywhere else on the
      page; the panel's own button, say. */
  const key = (key: string, init: KeyboardEventInit = {}, where: EventTarget = editor.view.dom) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    where.dispatchEvent(event);
    return event;
  };
  const settle = () => fixture.whenStable();
  /** Proposes, and hands back the writer and the way to end the writing. */
  const propose = async () => {
    let writer!: ContentStreamWriter;
    let finish!: () => void;
    host.proposal().propose(
      (given) => {
        writer = given;
        return new Promise<void>((resolve) => (finish = resolve));
      },
      { format: 'html' },
    );
    await settle();
    return {
      writer,
      finish: async () => {
        finish();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await settle();
      },
    };
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Provided, Unprovided] }).compileComponents();
    fixture = TestBed.createComponent(Provided);
    host = fixture.componentInstance;
    ({ editor, mount } = mountEditor());
    host.editor.set(editor);
    await settle();
  });

  afterEach(() => {
    fixture.destroy();
    editor.destroy();
    mount.remove();
  });

  it('is the proposal, and the bare triggers inside take it by injection', async () => {
    expect(text()).toBe('idle');
    expect(button('apply').disabled).toBe(true);
    expect(button('discard').disabled).toBe(true);

    const { writer, finish } = await propose();
    expect(text()).toBe('proposed');
    expect(host.proposal().streaming()).toBe(true);
    expect(button('discard').disabled).toBe(false);
    expect(button('apply').disabled).toBe(true);
    writer.write(' Bitte lesen.');
    await finish();
    expect(button('apply').disabled).toBe(false);

    button('apply').click();
    await settle();
    expect(text()).toBe('idle');
    expect(editor.getHTML()).toBe(canonical(mount, '<p>We met last week. Bitte lesen.</p>'));
  });

  it('Ctrl-Enter applies once the writing is done, is swallowed while it writes; Escape is the host’s', async () => {
    // Nothing proposed: the keys are not heard at all.
    expect(key('Enter', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(host.escapes.length).toBe(0);
    key('Escape');
    expect(host.escapes.length).toBe(0);

    const { writer, finish } = await propose();
    writer.write(' Bitte lesen.');
    await settle();
    // Still writing: swallowed — nothing applied, nothing passed on.
    expect(key('Enter', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(host.accepted).toBe(0);
    expect(text()).toBe('proposed');
    // Escape reaches the host, and only the host: the proposal stands.
    // (Pressed on the panel's button: the editor binds Escape itself.)
    const escape = key('Escape', {}, button('discard'));
    expect(host.escapes).toEqual([escape]);
    expect(escape.defaultPrevented).toBe(false);
    expect(text()).toBe('proposed');

    await finish();
    expect(key('Enter', { ctrlKey: true }).defaultPrevented).toBe(true);
    await settle();
    expect(host.accepted).toBe(1);
    expect(text()).toBe('idle');
    expect(editor.getHTML()).toBe(canonical(mount, '<p>We met last week. Bitte lesen.</p>'));
    // Gone with the proposal: the keys are the page's again.
    expect(key('Enter', { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('a bare trigger with no proposal anywhere says so', () => {
    const alone = TestBed.createComponent(Unprovided);
    expect(() => alone.detectChanges()).toThrow(/emailProposalAccept.*emailProposal/);
    alone.destroy();
  });
});
