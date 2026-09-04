import { Component, computed, input, model } from '@angular/core';
import { COMMA, ENTER, SEMICOLON } from '@angular/cdk/keycodes';
import { MatChipInputEvent, MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';

/** Good enough to catch a typo, loose enough to accept a real address:
    something@something.tld, no spaces. The mailer validates for real. */
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What splits a pasted or typed run into addresses: commas, semicolons,
    whitespace — a mailto list, an Outlook list, a copied column all work. */
const SEPARATORS = /[\s,;]+/;

/**
 * An address field the way Gmail does it: a label on the left, committed
 * addresses as chips, free typing after them. Enter, comma, semicolon or
 * leaving the field commits; a paste of several addresses becomes several
 * chips; Backspace on the empty input takes the last chip back; a chip that
 * is not an address is flagged, not refused — the user sees the typo, the
 * host decides what to do about it. `max` caps the count (From takes one).
 */
@Component({
  selector: '[email-address-input]',
  imports: [MatChipsModule, MatIconModule],
  templateUrl: './address-input.html',
  styleUrl: './address-input.scss',
  host: {
    '[class.is-full]': 'full()',
  },
})
export class AddressInput {
  /** The field's name — "To", "From", "Cc". */
  label = input.required<string>();
  placeholder = input('');
  /** Most addresses the field takes; the input hides once reached. */
  max = input<number>(Infinity);

  /** The committed addresses, two-way bound. */
  addresses = model<string[]>([]);

  protected readonly separators = [ENTER, COMMA, SEMICOLON] as const;
  protected readonly full = computed(() => this.addresses().length >= this.max());
  /** Ties the label to the input for assistive tech. */
  protected readonly inputId = `address-input-${nextId++}`;

  valid(address: string): boolean {
    return ADDRESS.test(address);
  }

  /** Commits what was typed, then clears the input (the chip-input event). */
  protected add(event: MatChipInputEvent): void {
    this.commit(event.value);
    event.chipInput.clear();
  }

  /** A paste of one or many addresses: split, commit, keep the input clean. */
  protected paste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') ?? '';
    if (!SEPARATORS.test(text.trim())) return; // a single token: let the input take it
    event.preventDefault();
    this.commit(text);
  }

  /** Backspace on an empty input takes the last chip back into the field. */
  protected backspace(input: HTMLInputElement): void {
    if (input.value) return;
    const last = this.addresses().at(-1);
    if (last === undefined) return;
    this.remove(last);
    input.value = last;
  }

  /** Splits a run into addresses and appends the new ones, up to `max`. */
  commit(raw: string): void {
    const incoming = raw
      .split(SEPARATORS)
      .map((token) => token.trim())
      .filter(Boolean);
    if (!incoming.length) return;
    this.addresses.update((current) => {
      const next = [...current];
      for (const address of incoming) {
        if (next.length >= this.max()) break;
        if (!next.includes(address)) next.push(address);
      }
      return next;
    });
  }

  remove(address: string): void {
    this.addresses.update((current) => current.filter((a) => a !== address));
  }
}

let nextId = 0;
