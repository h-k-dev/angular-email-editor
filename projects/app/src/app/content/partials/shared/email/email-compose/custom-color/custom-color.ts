import { Component, computed, input, linkedSignal, output } from '@angular/core';

// Angular Signal Forms
import { FormField, FormRoot, form, maxLength, submit, validate } from '@angular/forms/signals';

// Material
import { MatButtonModule } from '@angular/material/button';

// Library
import { cssColorToHex } from '@h-k-dev/angular-email-editor';
import { TranslatePipe } from '@ngx-translate/core';

/** A colour as the panel moves it: hue in degrees, saturation and value
    0–1 — the hue kept while a grey has none. */
interface Hsv {
  readonly h: number;
  readonly s: number;
  readonly v: number;
}

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

function hexToHsv(hex: string): Hsv {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? delta / max : 0, v: max };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    const value = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

/** What the hex field holds, as `#rrggbb` — three digits or six, with or
    without the `#` — or null. */
function parseHex(raw: string): string | null {
  const digits = raw.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(digits)) return `#${digits}`;
  if (/^[0-9a-f]{3}$/.test(digits)) return `#${[...digits].map((d) => d + d).join('')}`;
  return null;
}

/** How far an arrow moves the shade: a step, ten with Shift. */
const STEP = 0.01;

/**
 * A custom colour, our own picker: a shade square (saturation across,
 * brightness down), a hue slider, and the hex field — typed in, pasted,
 * read off. Apply (and Enter) hands the colour over (`picked`, `#rrggbb`):
 * one colour, one undo step, nothing while the thumb is dragged.
 *
 * It sits inside a menu or a dropdown, in place of the row that opened it:
 * the keys it uses — the arrows, Home/End, letters typed in the field —
 * stay with it, so a menu round it neither moves nor searches; Escape and
 * Tab go on.
 */
@Component({
  selector: 'div[custom-color]',
  imports: [FormField, FormRoot, MatButtonModule, TranslatePipe],
  templateUrl: './custom-color.html',
  styleUrl: './custom-color.scss',
  host: {
    role: 'group',
    '[attr.aria-label]': 'label()',
    '[style.--custom-color-hue]': 'hsv().h',
    '(keydown)': 'keep($event)',
  },
})
export class CustomColor {
  /** The colour to start from — the one in effect, in any CSS spelling;
      white when none. */
  readonly value = input<string | null>(null);
  /** What it picks — "Custom background color" — its group's name: the
      row's words that opened it, its ellipsis dropped. */
  readonly label = input.required({ transform: (words: string) => words.replace(/\s*…$/, '') });

  /** The colour applied, as `#rrggbb`. */
  readonly picked = output<string>();

  protected readonly hsv = linkedSignal<Hsv>(() =>
    hexToHsv(cssColorToHex(this.value() ?? '') ?? '#ffffff'),
  );
  protected readonly hex = computed(() => hsvToHex(this.hsv()));

  /** The thumb's place in the square, as percentages. */
  protected readonly thumb = computed(() => ({
    x: this.hsv().s * 100,
    y: (1 - this.hsv().v) * 100,
  }));

  /** The shade, in words, for a screen reader. */
  protected readonly shade = computed(
    () =>
      `${Math.round(this.hsv().s * 100)}% saturation, ${Math.round(this.hsv().v * 100)}% brightness`,
  );

  /** The field: the colour's six digits, following the square and the
      slider — and leading them once it holds a whole colour. */
  readonly #model = linkedSignal(() => ({ hex: this.hex().slice(1) }));

  protected readonly hexForm = form(
    this.#model,
    (p) => {
      // Six digits and a `#` at most — the field stops there.
      maxLength(p.hex, 7);
      validate(p.hex, ({ value }) => (parseHex(value()) ? null : { kind: 'color.hex' }));
    },
    {
      name: 'custom-color',
      submission: {
        action: async () => {
          this.#apply();
          return undefined;
        },
        onInvalid: (field) => field().errorSummary()[0]?.fieldTree().focusBoundControl(),
      },
    },
  );

  /** The field, refused: touched and no colour. */
  protected readonly refused = computed(() => {
    const field = this.hexForm.hex();
    return field.touched() && field.invalid();
  });

  /** A whole colour typed: the square and the slider go to it. Three
      digits wait for Apply — they may be the start of six. */
  protected follow(raw: string): void {
    const digits = raw.trim().replace(/^#/, '');
    const hex = digits.length === 6 ? parseHex(digits) : null;
    if (hex && hex !== this.hex()) this.hsv.set(hexToHsv(hex));
  }

  protected setHue(value: number): void {
    this.hsv.update((hsv) => ({ ...hsv, h: value }));
  }

  /** A press in the square moves the thumb there — and so does the
      pointer while it is held. */
  protected press(event: PointerEvent): void {
    const area = event.currentTarget as HTMLElement;
    area.setPointerCapture(event.pointerId);
    area.focus();
    this.#moveTo(event, area);
  }

  protected drag(event: PointerEvent): void {
    const area = event.currentTarget as HTMLElement;
    if (area.hasPointerCapture(event.pointerId)) this.#moveTo(event, area);
  }

  #moveTo(event: PointerEvent, area: HTMLElement): void {
    const box = area.getBoundingClientRect();
    this.hsv.update((hsv) => ({
      ...hsv,
      s: clamp((event.clientX - box.left) / box.width),
      v: 1 - clamp((event.clientY - box.top) / box.height),
    }));
  }

  /** The arrows move the thumb: across for saturation, up and down for
      brightness; Enter applies. */
  protected shadeKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? STEP * 10 : STEP;
    const move: Partial<Record<string, (hsv: Hsv) => Hsv>> = {
      ArrowLeft: (hsv) => ({ ...hsv, s: clamp(hsv.s - step) }),
      ArrowRight: (hsv) => ({ ...hsv, s: clamp(hsv.s + step) }),
      ArrowUp: (hsv) => ({ ...hsv, v: clamp(hsv.v + step) }),
      ArrowDown: (hsv) => ({ ...hsv, v: clamp(hsv.v - step) }),
    };
    if (event.key === 'Enter') {
      event.preventDefault();
      this.#apply();
      return;
    }
    const to = move[event.key];
    if (!to) return;
    event.preventDefault();
    this.hsv.update(to);
  }

  /** Enter in the field submits, as Apply does — but not the Enter that
      confirms an IME's text. */
  protected onEnter(event: Event): void {
    if ((event as KeyboardEvent).isComposing) return;
    event.preventDefault();
    void submit(this.hexForm);
  }

  /** The panel's keys stay with it: a menu round it neither moves on an
      arrow nor searches on a letter. Escape and Tab go on. */
  protected keep(event: KeyboardEvent): void {
    if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
  }

  #apply(): void {
    this.picked.emit(parseHex(this.#model().hex) ?? this.hex());
  }
}
