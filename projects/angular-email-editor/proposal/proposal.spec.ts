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
import { EditorProposal, ProposalAccept, ProposalDiscard, injectProposal } from './proposal';

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

describe('injectProposal', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let editor: Editor;
  let mount: HTMLElement;

  /** The kit's canonical form of an HTML — what `getHTML` makes of it. */
  const canon = (content: string) => {
    const other = createEditor({ parent: mount, extensions: richTextExtensions, content });
    const out = other.getHTML();
    other.destroy();
    return out;
  };
  const button = (name: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(`.${name}`)!;
  const settle = () => fixture.whenStable();

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    mount = document.createElement('div');
    document.body.appendChild(mount);
    editor = createEditor({
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
