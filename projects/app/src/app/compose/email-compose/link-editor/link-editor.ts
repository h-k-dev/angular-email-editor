import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';

// Angular Signal Forms
import { FormField, FormRoot, form, submit, validate } from '@angular/forms/signals';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';

// CDK
import { CdkConnectedOverlay, ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';

// ProseMirror
import { undo } from 'prosemirror-history';

// Library
import {
  Editor,
  UNSET_BUTTON_HREF,
  hrefProblem,
  linkRangeAt,
  normalizeHref,
  selectedButton,
} from 'angular-email-editor';
import { ActionTrigger } from 'angular-email-editor/actions';
import { Anchor } from 'angular-email-editor/anchor';

import { I18n } from '../../../../services/i18n';
import { FormattingCommands } from '../formatting-commands';
import { FormattingItem } from '../formatting-items';
import { dismissOnPressOutside } from '../../dismiss-outside';

/**
 * The link popover: a URL field and its three actions — apply, open, and
 * remove — anchored at the selection in the visible editor, the same for a
 * text link and a button. Opened by the composer's link items (toolbar,
 * bubble menu, ⋯ menu) through `FormattingCommands`, by the button link
 * right after it made a button, and by a click on a button.
 *
 * The field is a signal form (`linkForm`) and Apply is its submit: what was
 * typed is validated as a link an email can carry (`hrefProblem` — a real
 * URL, an address, a phone number, a `{{ token }}`; never a script) and
 * applied only when it passes; otherwise the field turns the error colour
 * (`aria-invalid`), with no message. Enter submits the same way. Open goes
 * to the link as it stands; Remove takes it off — the button too, which is
 * plain words again.
 *
 * One menu at a time: nothing covers the page while it is open, so a press
 * outside closes it and lands where it was aimed — no other menu takes its
 * place.
 *
 * The input needs real focus, so no mousedown suppression here — the
 * editor blurs while editing and is refocused on close. Opened by a click
 * on a button, it takes no focus: the caret stays in the editor with the
 * button selected, so Delete removes it — and the popover closes with it
 * (`open` follows the button's selection). In code view the source pane has
 * no link mark to read back: there it is insert-only, on a selection.
 */
@Component({
  selector: 'div[link-editor]',
  imports: [
    // Angular Signal Forms
    FormField,
    FormRoot,

    // Material
    MatButtonModule,
    MatDividerModule,
    MatIconModule,

    // CDK
    OverlayModule,

    // Library
    ActionTrigger,
    Anchor,
  ],
  templateUrl: './link-editor.html',
  styleUrl: './link-editor.scss',
})
export class LinkEditor {
  readonly #commands = inject(FormattingCommands);

  readonly #injector = inject(Injector);

  protected readonly i18n = inject(I18n);

  protected readonly input = viewChild<ElementRef<HTMLInputElement>>('input');

  /** What the field holds. */
  readonly #model = signal({ href: '' });

  /** The field, validated as a link an email can carry; Apply (and Enter)
      submits it, and only a link that passes is applied. */
  protected readonly linkForm = form(
    this.#model,
    (p) => {
      validate(p.href, ({ value }) => {
        const problem = hrefProblem(value());
        return problem ? { kind: `link.${problem}` } : null;
      });
    },
    {
      name: 'link',
      submission: {
        action: async () => {
          this.#apply();
          return undefined;
        },
        onInvalid: () => this.#focusField(),
      },
    },
  );

  /** The field was tried (Apply, Enter, Open) and is no link: it says so
      by its colour and `aria-invalid`, in no words — never while the link
      is still being typed. */
  protected readonly refused = computed(() => {
    const field = this.linkForm.href();
    return field.touched() && field.invalid();
  });

  /** The button being edited, by position — null for a text link. */
  readonly #buttonPos = signal<number | null>(null);

  /** The edited button is no longer the selection: deleted, or the caret
      moved on. */
  readonly #buttonLeft = computed(() => {
    const pos = this.#buttonPos();
    if (pos === null) return false;
    const state = this.#commands.state();
    return !state || selectedButton(state)?.pos !== pos;
  });

  /** Open — and shut for good once the button it edits is no longer
      selected: a click leaves the caret in the editor, so Delete takes the
      button out and the popover goes with it. It stays shut when an undo
      brings the button back. */
  protected readonly open = linkedSignal<boolean, boolean>({
    source: this.#buttonLeft,
    computation: (left, previous) => !left && (previous?.value ?? false),
  });

  /** Whether this popover holds the selected button: it was opened on it,
      and the button is still the selection — open or closed since. The
      button's bubble menu stays away the whole time: one menu at a time,
      and closing this one (Escape, a click on the toolbar) must not bring
      another up in its place. Let go once the selection leaves the button;
      a keyboard selection of it later gets its bubble as usual. */
  readonly #holding = linkedSignal<boolean, boolean>({
    source: this.#buttonLeft,
    computation: (left, previous) => !left && (previous?.value ?? false),
  });

  readonly holdsButton = this.#holding.asReadonly();

  /** Where the popover stands: the text's start, or over the button. Equal
      boxes are no change, so re-measuring an unmoved button renders nothing. */
  protected readonly anchor = signal<{ left: number; top: number; height: number } | null>(null, {
    equal: (a, b) => a?.left === b?.left && a?.top === b?.top && a?.height === b?.height,
  });

  // A query cannot be an ES-private field: TypeScript's `private` it is.
  private readonly overlay = viewChild(CdkConnectedOverlay);

  constructor() {
    // A button can move under its popover — aligned from the popover itself,
    // or pushed along by an edit — and the popover follows it: measured
    // after the render that moved it (a read), then stood over (a write).
    afterRenderEffect({
      earlyRead: () => {
        this.#commands.state(); // track: every transaction
        const pos = this.#buttonPos();
        if (!this.open() || pos === null) return null;
        const dom = this.#commands.editor()?.view.nodeDOM(pos) as HTMLElement | null;
        const box = dom?.getBoundingClientRect();
        return box ? { left: box.left + box.width / 2, top: box.top, height: box.height } : null;
      },
      write: (box) => {
        const measured = box();
        if (!measured) return;
        const before = this.anchor();
        this.anchor.set(measured);
        if (this.anchor() === before) return;
        // The overlay does not watch its origin move. The anchor element
        // takes the new box in the next render; then the overlay is told
        // to follow it — measuring the origin and placing itself, both.
        afterNextRender(
          { mixedReadWrite: () => this.overlay()?.overlayRef?.updatePosition() },
          { injector: this.#injector },
        );
      },
    });
    // A press outside closes it — never the click that opened it.
    dismissOnPressOutside(
      this.open,
      () => this.overlay()?.overlayRef?.overlayElement,
      () => this.dismiss(),
    );
  }

  protected readonly positions: ConnectedPosition[] = [
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
    // Fallback: no room above, flip below.
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
  ];

  /** Whether the popover edits a selected button's link rather than a
      link mark on the text. */
  readonly #button = computed(() => this.#buttonPos() !== null);

  /** A button's popover is its one menu: it also carries where the button
      sits on its line. */
  protected readonly forButton = this.#button;

  /** Left, centre, right — the kit's alignment actions, the toolbar's own
      items. */
  protected readonly alignItems = (['align-left', 'align-center', 'align-right'] as const).map(
    (id) => this.#commands.items[id],
  );

  /** The visible editor's actions, which the alignment buttons trigger. */
  protected readonly actions = this.#commands.actions;

  protected readonly label = (item: FormattingItem): string => this.#commands.label(item);

  /** Whether that button was just made from text (the button link): a
      button is a link, so one left without a link is taken back — undone,
      the text exactly as it was, marks and all. */
  readonly #newButton = signal(false);

  /** Opens the popover at the selection: prefilled when the caret sits in
      an existing link — or a button is selected, whose link it edits — a
      no-op when there is neither selection nor link. `newButton`: the
      button was just made, see {@link #newButton}. `focus: false` leaves
      the caret in the editor — a click on a button: the button stays the
      selection, Delete removes it, a click in the field edits the link. */
  show(options: { newButton?: boolean; focus?: boolean } = {}): void {
    const editor = this.#commands.target();
    if (!editor) return;

    const code = this.#commands.codeView();
    const button = code ? null : selectedButton(editor.state);
    const { from, empty } = editor.state.selection;
    const range = code || button ? undefined : linkRangeAt(editor.state, from);
    if (empty && !range) {
      editor.focus();
      return;
    }

    const buttonHref = button?.node.attrs['href'] as string | undefined;
    const href = button ? (buttonHref === UNSET_BUTTON_HREF ? '' : buttonHref!) : range?.attrs.href;
    this.#buttonPos.set(button?.pos ?? null);
    this.#holding.set(!!button);
    this.#newButton.set(!!button && !!options.newButton);
    // A fresh start: the link it holds, nothing tried yet.
    this.linkForm().reset({ href: href ?? '' });
    // A button: over the button itself; text: at the selection's start.
    const dom = button && (editor.view.nodeDOM(button.pos) as HTMLElement | null);
    const box = dom?.getBoundingClientRect();
    const coords = box ?? editor.view.coordsAtPos(from);
    this.anchor.set({
      left: box ? box.left + box.width / 2 : coords.left,
      top: coords.top,
      height: coords.bottom - coords.top,
    });
    this.open.set(true);
    if (options.focus === false) return;
    // The field exists once the render that opens the overlay has run:
    // selecting it is a DOM write after that render.
    afterNextRender(
      {
        write: () => {
          const input = this.input()?.nativeElement;
          input?.focus();
          input?.select();
        },
      },
      { injector: this.#injector },
    );
  }

  /** Closes without applying, from the keyboard: the caret goes back to
      the editor. */
  protected close(): void {
    this.open.set(false);
    this.#commands.focus();
  }

  /** A press outside closes it too — and is just a press: nothing covers
      the page, so it lands where it was aimed (a caret in the text, another
      field) and nothing else opens in the popover's place. */
  protected dismiss(): void {
    this.open.set(false);
  }

  /** The popover has gone — however it went: Escape, a click outside,
      Apply, Remove, or its button no longer selected. `open` follows (the
      overlay may detach on its own). A button just made that still has no
      link is taken back: it would go nowhere. */
  protected closed(): void {
    this.open.set(false);
    const pos = this.#buttonPos();
    const editor = this.#commands.target();
    if (!this.#newButton() || pos === null || !editor) return;
    this.#newButton.set(false);
    const node = editor.state.doc.nodeAt(pos);
    if (node?.type.name === 'button' && node.attrs['href'] === UNSET_BUTTON_HREF) {
      this.#takeBack(editor);
    }
  }

  /** Escape closes — from anywhere in the popover, and from the editor when
      the caret stayed there (a clicked button), even if the editor has
      handled that Escape too; an IME's own Escape stays the IME's. Closing
      is ours alone: the overlay's own Escape is off
      (`cdkConnectedOverlayDisableClose`), or it would detach behind `open`'s
      back and the next `show()` would change nothing. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    this.close();
  }

  /** Enter submits, as Apply does — but not the Enter that confirms an
      IME's text. */
  protected onEnter(event: Event): void {
    if ((event as KeyboardEvent).isComposing) return;
    event.preventDefault();
    void submit(this.linkForm);
  }

  /** Goes to the link as the field has it, in a new tab — once it is one:
      otherwise the field says why, and keeps the caret. A `{{ token }}`
      is no address yet: there is nowhere to go until it is filled in. */
  protected visit(): void {
    const raw = this.linkForm.href().value();
    const href = normalizeHref(raw);
    if (hrefProblem(raw) || href.startsWith('{{')) {
      this.linkForm.href().markAsTouched();
      this.#focusField();
      return;
    }
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  /** Takes the link off: from the text — or, for a button, the button off
      too: plain words again, as a link removed from text leaves them. */
  protected remove(): void {
    this.open.set(false);
    const editor = this.#commands.target();
    if (this.#button()) this.#unbutton();
    else editor?.commands['unsetLink']();
    editor?.focus();
  }

  /** The submission: the field has passed, so its link goes on — the
      text's link mark, or the button's href. */
  #apply(): void {
    const editor = this.#commands.target();
    this.open.set(false);
    if (!editor) return;
    const href = normalizeHref(this.linkForm.href().value());
    if (this.#button()) editor.commands['setButtonHref'](href);
    else editor.commands['setLink']({ href });
    editor.focus();
  }

  /** The selected button back to plain words. One just made is undone — the
      text as it was, marks and all (the conversion is its own history
      event, see `toggleButtonLink`); an older one is turned back into its
      label. */
  #unbutton(): void {
    const editor = this.#commands.target();
    if (!editor) return;
    if (this.#newButton()) {
      this.#newButton.set(false);
      this.#takeBack(editor);
      return;
    }
    editor.commands['setButtonHref']('');
    editor.commands['toggleButtonLink']();
  }

  /** Undoes the conversion that made the button (its own history event).
      While the button is still selected, the undo's own selection is right
      — the words as they were. Once a click has put the caret elsewhere,
      that caret stays where it was put. */
  #takeBack(editor: Editor): void {
    const before = editor.state.selection;
    const stillOn = selectedButton(editor.state)?.pos === this.#buttonPos();
    undo(editor.state, (tr) => {
      if (!stillOn) tr.setSelection(before.map(tr.doc, tr.mapping));
      editor.view.dispatch(tr);
    });
  }

  #focusField(): void {
    this.input()?.nativeElement.focus();
  }
}
