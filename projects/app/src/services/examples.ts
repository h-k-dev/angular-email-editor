import { DOCUMENT, Service, inject, signal } from '@angular/core';
import { InboundMessage, replyDocument } from 'angular-email-editor';

/** One example document, as the catalogue lists it: a name for the strip
    and the file it is in, under {@link EXAMPLES_PATH}. */
export interface ExampleEntry {
  name: string;
  file: string;
}

/** A set of examples — one scenario: the replies, one templating dialect. */
export interface ExampleSet {
  key: string;
  /** Menu entry / resting label of the cycler's split button. */
  label: string;
  /** Prefix of the cycling label ("Reply 2/4 — Gmail thread"). */
  short: string;
  /** What a file holds: `reply` — an inbound message as JSON, rendered by
      `replyDocument`; `html` — the document itself, canonical email HTML
      with the tokens verbatim. */
  kind: 'reply' | 'html';
  /** The templating dialect an `html` set's tokens are written in — what
      makes it a template set, for the template store. */
  dialect?: 'angularjs' | 'handlebars';
  examples: ExampleEntry[];
}

/** The catalogue, as `examples/index.json` holds it. */
export interface ExampleCatalogue {
  sets: ExampleSet[];
}

/** An example, loaded: where it is listed and the document it holds. */
export interface ExampleDocument {
  set: ExampleSet;
  entry: ExampleEntry;
  /** Canonical email HTML — a reply example rendered into its reply. */
  html: string;
}

/** Where the examples live: `public/examples`, served under the app's base. */
export const EXAMPLES_PATH = 'examples/';

/**
 * The example documents — demo data: the composer's example cycler seeds
 * the sheet from them, the template store lists them. They are assets,
 * not code: a catalogue (`index.json`) naming the sets and their files,
 * and a file per example beside it — a reply example as the inbound
 * message in JSON, a template as its HTML — so an example is added by
 * dropping a file in and a line in the catalogue, and none of them is
 * bundled. Fetched once — all of them, when the app starts, so the `/`
 * menu's Examples group is a plain local list the moment it is opened
 * ({@link documents}); each file once, whoever asks.
 */
@Service()
export class Examples {
  readonly #document = inject(DOCUMENT);

  #catalogue: Promise<ExampleSet[]> | null = null;

  readonly #files = new Map<string, Promise<string>>();

  /** Every example, loaded — empty until the assets have come, and empty
      for good where they cannot (nothing serves them in a unit test). */
  readonly documents = signal<readonly ExampleDocument[]>([]);

  /** The HTML of the example last loaded into a message, as the file holds
      it — the message's *original*, for the preview to draw beside the
      editor's reading. Null until one is. */
  readonly loaded = signal<string | null>(null);

  constructor() {
    void this.#preload();
  }

  /** The catalogue's sets, in its order. */
  sets(): Promise<ExampleSet[]> {
    return (this.#catalogue ??= this.#fetch('index.json').then(
      (text) => (JSON.parse(text) as ExampleCatalogue).sets,
    ));
  }

  /** The set with this key, if the catalogue has it. */
  async set(key: string): Promise<ExampleSet | undefined> {
    return (await this.sets()).find((set) => set.key === key);
  }

  /** An example's document, as canonical email HTML — a reply example's
      inbound message rendered into the reply it seeds. */
  async document(set: ExampleSet, entry: ExampleEntry): Promise<string> {
    const text = await this.#file(entry.file);
    if (set.kind !== 'reply') return text;
    const inbound = JSON.parse(text) as InboundMessage;
    // A date written as ISO is a `Date`, formatted by the locale; anything
    // else is a preformatted string, shown as it is.
    if (typeof inbound.date === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(inbound.date)) {
      inbound.date = new Date(inbound.date);
    }
    return replyDocument(inbound);
  }

  /** All the examples, once: the catalogue, then every file. */
  async #preload(): Promise<void> {
    try {
      const sets = await this.sets();
      const documents = await Promise.all(
        sets.flatMap((set) =>
          set.examples.map(async (entry) => ({
            set,
            entry,
            html: await this.document(set, entry),
          })),
        ),
      );
      this.documents.set(documents);
    } catch {
      // Nothing serves the assets (a unit test, an offline start): the
      // examples stay away; a later ask through `sets()` says why.
    }
  }

  #file(file: string): Promise<string> {
    let pending = this.#files.get(file);
    if (!pending) {
      pending = this.#fetch(file);
      this.#files.set(file, pending);
    }
    return pending;
  }

  async #fetch(file: string): Promise<string> {
    const url = new URL(EXAMPLES_PATH + file, this.#document.baseURI);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Example ${file}: ${response.status} ${response.statusText}`);
    return response.text();
  }
}
