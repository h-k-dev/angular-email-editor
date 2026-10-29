import {
  Component,
  ElementRef,
  Injector,

  // Signals
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

// Angular Signal Forms
import { FieldTree, FormField } from '@angular/forms/signals';

// Angular Material
import { MatFormField, MatPrefix, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';

// Angular Email Editor
import { isEmailAddress, parseMailbox } from '@h-k-dev/angular-email-editor/address';
import { AddressInput, AddressInputLabel } from '@h-k-dev/angular-email-editor/address-input';
import { KeepFocus } from '@h-k-dev/angular-email-editor/focus';
import { AddressFormField } from '@h-k-dev/angular-email-editor/material';

import { Envelope } from '../../../../../../core/email/envelope';

/** Tells the rows on one page apart: Preview needs an id of its own for
    its label. */
let nextRowsId = 0;

/** The rows that hold addresses. */
export type AddressRow = 'from' | 'to' | 'cc' | 'bcc';

/**
 * The envelope rows of one message, Gmail's: From, To with Cc and Bcc,
 * Subject with Preview — each a `[formField]` of the message's form
 * (`form`), so the form's rules, errors and focus-on-invalid reach them.
 * Both sheets, the desktop's and the phone's, write on these same rows.
 *
 * The rows keep their own state — which copy rows are open, whether the
 * recipients have merged into one line — and nothing else: the message is
 * the form's. The sheet asks them for the caret (`focus`) and to start
 * over (`reset`).
 */
@Component({
  selector: 'div[envelope-rows]',
  imports: [
    NgTemplateOutlet,
    FormField,
    AddressInput,
    KeepFocus,

    // Material form fields (the `material` frame)
    MatFormField,
    MatPrefix,
    MatSuffix,
    AddressInputLabel,
    MatInput,
    AddressFormField,
  ],
  templateUrl: './envelope-rows.html',
  styleUrl: './envelope-rows.scss',
  host: {
    '[attr.data-fields]': 'fields()',
  },
})
export class EnvelopeRows {
  readonly #injector = inject(Injector);

  /** The message's form: every row is one of its fields. */
  readonly form = input.required<FieldTree<Envelope>>();

  /** An address row the user is done with — left, or a chip dragged in or
      out — and its list (the address input's `savedModelChange`): for a
      host that saves a row as soon as it is left (the template designer). */
  readonly rowSaved = output<{ row: AddressRow; value: string[] }>();

  /** The subject the user is done with — left after a change, or Enter
      (the input's `change`): for a host that saves it as soon as it is. */
  readonly subjectSaved = output<string>();

  /** How the rows frame their controls: `plain` — the control alone in the
      row (the page); `material` — inside an Angular Material form field at
      density -4, exactly the row's 40px (a compose window). The two look
      the same; the form field adds its error styling — the red line under
      an invalid control — and no message: iusta core's rows. */
  readonly fields = input<'plain' | 'material'>('plain');
  protected readonly material = computed(() => this.fields() === 'material');

  /** Where the caret starts (`MessageSheet.initialFocus`): To is marked
      `cdkFocusInitial` for a new message. */
  readonly initialFocus = input<'to' | 'body'>('to');

  /** The message is plain text: no inbox snippet, which is a part of the
      HTML document. */
  readonly plainText = input(false);

  /** To's label: Gmail's — shown only while focus is in its row, the row
      its addresses alone at rest (`on-focus`, a message being written) —
      or always there, From's way (`always`: a template's details, a form
      read row by row). */
  readonly toLabel = input<'on-focus' | 'always'>('on-focus');

  /** Whether the recipients merge into one line at rest, Gmail's (a
      message being written) — or stay a row each, labelled, however full
      (a template's details: a narrow pane, where a merged line is too
      cramped to read). */
  readonly mergeRecipients = input(true);

  /** The message as the rows read it. */
  protected readonly value = computed(() => this.form()().value());

  protected readonly previewId = `message-preview-${nextRowsId++}`;

  /** The copy rows, for putting the caret in one the moment it opens. They
      exist only while shown. */
  protected readonly ccField = viewChild<AddressInput>('ccField');
  protected readonly bccField = viewChild<AddressInput>('bccField');

  /** The To row: where a message starts, so the caret lands there on
      arrival. */
  protected readonly toField = viewChild<AddressInput>('toField');

  /** From and Subject, by reference: their rows forward clicks and name
      them, whichever frame the control sits in. From (like To) is optional:
      its label reads it in the very pass that creates it. */
  protected readonly fromField = viewChild<AddressInput>('fromField');
  protected readonly subjectField =
    viewChild.required<ElementRef<HTMLInputElement>>('subjectField');

  /** Puts the caret in To, where a message starts. */
  focus(): void {
    this.toField()?.focus();
  }

  /** A new message: the copy rows and the snippet folded away again. */
  reset(): void {
    this.ccOpen.set(false);
    this.bccOpen.set(false);
    this.previewOpen.set(false);
  }

  /**
   * Cc and Bcc the way Gmail does them: two text buttons at the end of the
   * To row, each opening its own row (focused) and stepping aside; a row
   * that is left empty when focus moves elsewhere folds back into its
   * button. A row with addresses in it stays whatever the button state, so
   * a message seeded with a Cc shows it from the start.
   */
  protected readonly ccOpen = signal(false);
  protected readonly bccOpen = signal(false);
  protected readonly showCc = computed(() => this.ccOpen() || this.value().cc.length > 0);
  protected readonly showBcc = computed(() => this.bccOpen() || this.value().bcc.length > 0);

  protected openCopy(which: 'cc' | 'bcc'): void {
    (which === 'cc' ? this.ccOpen : this.bccOpen).set(true);
    afterNextRender(
      { write: () => (which === 'cc' ? this.ccField() : this.bccField())?.focus() },
      { injector: this.#injector },
    );
  }

  /**
   * Preview text — the inbox snippet — the way Cc and Bcc work: a text
   * button at the end of the Subject row opens its own row (focused) and
   * steps aside; left empty, the row folds back into the button when focus
   * moves on. A personal mail never needs it, so it stays out of the way; a
   * newsletter writer finds it one click from the subject.
   */
  protected readonly previewOpen = signal(false);
  protected readonly showPreview = computed(
    () => !this.plainText() && (this.previewOpen() || this.value().previewText.length > 0),
  );
  protected readonly previewField = viewChild<ElementRef<HTMLInputElement>>('previewField');

  protected openPreview(): void {
    this.previewOpen.set(true);
    afterNextRender(
      { write: () => this.previewField()?.nativeElement.focus() },
      { injector: this.#injector },
    );
  }

  /** Focus left the preview row: an empty one folds. */
  protected leavePreview(): void {
    if (!this.value().previewText) this.previewOpen.set(false);
  }

  /**
   * The recipients merge the way Gmail's do: while focus is anywhere else,
   * To, Cc and Bcc show as one line — the names, the copies after their
   * label — and focus coming back into any of them opens the rows again.
   * The rows are never unmounted, only visually hidden: Tab still lands in
   * them, and the form's focus-on-invalid still finds its control, and
   * either way the focus is what opens them. The line itself is a pointer
   * shortcut to To, hidden from assistive tech, which reaches the rows.
   */
  protected readonly recipientsActive = signal(false);

  /** Merged only while there is something to merge: a copy row beside To.
      A lone To row already reads as a line when it is not focused, and
      swapping it for a lookalike would only move its placeholder. */
  protected readonly recipientsMerged = computed(
    () => this.mergeRecipients() && !this.recipientsActive() && (this.showCc() || this.showBcc()),
  );

  /** The merged line's groups, To first; empty groups left out. The first
      group's label is the row's label, the rest are inline. */
  protected readonly recipientSummary = computed(() => {
    const { to, cc, bcc } = this.value();
    const person = (raw: string) => {
      const mailbox = parseMailbox(raw);
      return { raw, text: mailbox.name ?? mailbox.address, valid: isEmailAddress(mailbox.address) };
    };
    return [
      { label: 'To', people: to.map(person) },
      { label: 'Cc', people: cc.map(person) },
      { label: 'Bcc', people: bcc.map(person) },
    ].filter((group) => group.people.length);
  });

  /** A press on a row anywhere but on a control — the label, the padding —
      leaves focus where it is; the row's click puts the caret in its
      control. Without this the press would take focus to the body for an
      instant, and an address row would drop from chips to text and back in
      a flash. */
  protected readonly rowControls = 'input, button, textarea';

  /** Focus left the recipients — To, Cc and Bcc together — for somewhere
      else: the rows merge into one line, and the empty copy rows fold.
      Moving between the three never does. */
  protected leaveRecipients(event: FocusEvent): void {
    const group = event.currentTarget as HTMLElement;
    // Only a real destination outside the group counts: focus going nowhere
    // (the window losing focus, a focused element removed) folds nothing.
    const destination = event.relatedTarget as Node | null;
    if (!destination || group.contains(destination)) return;
    this.recipientsActive.set(false);
    const { cc, bcc } = this.value();
    if (!cc.length) this.ccOpen.set(false);
    if (!bcc.length) this.bccOpen.set(false);
  }
}
