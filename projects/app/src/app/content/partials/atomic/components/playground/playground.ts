import {
  DestroyRef,
  Directive,
  ElementRef,
  Injectable,
  Signal,
  WritableSignal,
  afterNextRender,
  inject,
  input,
  signal,
} from '@angular/core';
import { Editor, EditorOptions, createEditor } from '@h-k-dev/angular-email-editor';

/**
 * An editor for a stage — mounted into `parent` once it has rendered,
 * destroyed with the playground. `undefined` until then, which is what the
 * entries that follow an editor (`injectActions`, `[emailImageAlt]`,
 * `injectProposal`) take for "none yet". Call in an injection context.
 */
export function playgroundEditor(
  parent: Signal<ElementRef<HTMLElement>>,
  options: Omit<EditorOptions, 'parent'>,
): Signal<Editor | undefined> {
  const editor = signal<Editor | undefined>(undefined);
  afterNextRender(() => editor.set(createEditor({ ...options, parent: parent().nativeElement })));
  inject(DestroyRef).onDestroy(() => editor()?.destroy());
  return editor.asReadonly();
}

/** A knob: one input of the component on the stage, and the control that
    sets it. The knob holds the playground's own signal, so the stage binds
    that signal as it would anywhere — nothing about it is generic. */
export type Knob =
  | { readonly kind: 'boolean'; readonly name: string; readonly value: WritableSignal<boolean> }
  | { readonly kind: 'text'; readonly name: string; readonly value: WritableSignal<string> }
  | {
      readonly kind: 'number';
      readonly name: string;
      readonly value: WritableSignal<number>;
      readonly min?: number;
      readonly max?: number;
      readonly step?: number;
    }
  | {
      readonly kind: 'choice';
      readonly name: string;
      readonly value: WritableSignal<string>;
      readonly options: readonly string[];
    };

/** Something to do to the component — a method of its (`focus()`), or a
    change of the world around it (add a file, fail an upload). */
export interface PlaygroundAction {
  readonly name: string;
  readonly run: () => void;
}

/** One line of the event log. */
export interface PlaygroundEvent {
  /** Counts up for the whole page: what the log tracks by. */
  readonly id: number;
  /** When, to the millisecond — `12:04:31.207`. */
  readonly time: string;
  readonly name: string;
  /** The payload, as JSON; empty for none. */
  readonly detail: string;
}

/** An element whose attributes the state panel shows, under a name. */
export interface PlaygroundSubjectRef {
  readonly label: string;
  readonly element: HTMLElement;
}

/** How many lines the log keeps. */
const LOG_LIMIT = 100;

/** The payload as one line of JSON: a DOM event by its type, a function
    by its name, a cycle cut — never a throw from the log. */
export function describe(detail: unknown): string {
  if (detail === undefined) return '';
  if (detail instanceof Event) return detail.type;
  try {
    const seen = new WeakSet<object>();
    return (
      JSON.stringify(detail, (_key, value: unknown) => {
        if (typeof value === 'function') return `ƒ ${value.name || 'anonymous'}`;
        if (value instanceof Node) return `<${value.nodeName.toLowerCase()}>`;
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[cycle]';
          seen.add(value);
        }
        return value;
      }) ?? String(detail)
    );
  } catch {
    return String(detail);
  }
}

let counter = 0;

/**
 * A playground's own bench, provided by the playground component and read
 * by its frame: what the stage's components emitted (`log`), and which of
 * their elements the state panel watches (`PlaygroundSubject`).
 */
@Injectable()
export class Playground {
  readonly #events = signal<readonly PlaygroundEvent[]>([]);
  /** Newest first. */
  readonly events = this.#events.asReadonly();

  readonly #subjects = signal<readonly PlaygroundSubjectRef[]>([]);
  readonly subjects = this.#subjects.asReadonly();

  /** Writes an output, a method's answer — anything — to the log. */
  log(name: string, detail?: unknown): void {
    const now = new Date();
    const time =
      now.toLocaleTimeString('en-GB', { hour12: false }) +
      '.' +
      String(now.getMilliseconds()).padStart(3, '0');
    const event = { id: ++counter, time, name, detail: describe(detail) };
    this.#events.update((events) => [event, ...events].slice(0, LOG_LIMIT));
  }

  clear(): void {
    this.#events.set([]);
  }

  watch(subject: PlaygroundSubjectRef): void {
    this.#subjects.update((subjects) => [...subjects, subject]);
  }

  unwatch(subject: PlaygroundSubjectRef): void {
    this.#subjects.update((subjects) => subjects.filter((one) => one !== subject));
  }
}

/** Puts its element on the state panel: its `data-*`, `aria-*` and other
    state attributes, live. The value names it there. */
@Directive({ selector: '[playgroundSubject]' })
export class PlaygroundSubject {
  // Not required: the subject is on the panel from its constructor, before
  // a bound label is in — the panel reads it as a signal and catches up.
  readonly label = input('', { alias: 'playgroundSubject' });

  constructor() {
    const playground = inject(Playground);
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    // A getter, so the panel shows whatever the label says now.
    const label = this.label;
    const subject: PlaygroundSubjectRef = {
      get label() {
        return label();
      },
      element,
    };
    playground.watch(subject);
    inject(DestroyRef).onDestroy(() => playground.unwatch(subject));
  }
}

/** Knob makers, so a playground's list reads as its inputs do. */
export const knob = {
  boolean: (name: string, value: WritableSignal<boolean>): Knob => ({
    kind: 'boolean',
    name,
    value,
  }),
  text: (name: string, value: WritableSignal<string>): Knob => ({ kind: 'text', name, value }),
  number: (
    name: string,
    value: WritableSignal<number>,
    range: { min?: number; max?: number; step?: number } = {},
  ): Knob => ({ kind: 'number', name, value, ...range }),
  choice: <T extends string>(
    name: string,
    value: WritableSignal<T>,
    options: readonly T[],
  ): Knob => ({
    kind: 'choice',
    name,
    value: value as unknown as WritableSignal<string>,
    options,
  }),
};
