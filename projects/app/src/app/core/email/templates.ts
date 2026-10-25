import { Service, inject } from '@angular/core';

import { AttachmentRef } from './attachment-uploads';
import { BLANK } from './envelope';
import { ExampleEnvelope, ExampleSet, Examples, exampleId } from './examples';
import { Filter, applyFilter, respond } from './loopback-filter';

/** A stored email template, as the backend's `Template` model returns it. */
export interface EmailTemplate {
  id: string;
  name: string;
  /** The templating dialect its tokens are written in. */
  dialect: 'angularjs' | 'handlebars';
  /** The body, as canonical email HTML with the tokens verbatim. */
  html: string;
  /** The message round the body, as the designer last saved it — none on
      a template no one has designed yet: a new message's rows then. */
  envelope?: TemplateEnvelope;
}

/** The dialects by name — a template's category tag; names, the same in
    every language. */
export const DIALECT_NAMES: Record<EmailTemplate['dialect'], string> = {
  angularjs: 'AngularJS',
  handlebars: 'Handlebars',
};

/** A catalogue entry's envelope, whole: what it says, over a new message's
    rows. */
function envelopeOf(envelope: ExampleEnvelope): TemplateEnvelope {
  const { from, to, cc, bcc, subject, previewText } = BLANK;
  return { from, to, cc, bcc, subject, previewText, attachments: [], ...envelope };
}

/** What a template keeps of the message round its body: the rows — which
    may hold merge tags (`{{ client.email }}` is pending, not invalid) — and
    the files every message written on it carries. */
export interface TemplateEnvelope {
  from: string[];
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  previewText: string;
  attachments: AttachmentRef[];
}

/**
 * The template store. Stands in for `GET /api/templates?filter=…` on a
 * LoopBack 3 backend: `find(filter)` is the one call, answered by the shared
 * filter mock (`where` with `like` / `ilike` / `inq` / `and` / `or`,
 * `order`, `skip`, `limit`) after a small latency, and cancelled by an
 * `AbortSignal`; `save(template)` writes one back (the designer's). A real
 * host swaps the bodies for
 *
 *     firstValueFrom(this.#http.get<EmailTemplate[]>('/api/templates', {
 *       params: { filter: JSON.stringify(filter) },
 *     }))
 *     firstValueFrom(this.#http.patch<EmailTemplate>(`/api/templates/${id}`, template))
 *
 * Demo data: every example set written in a dialect (`Examples`), loaded
 * on the first find.
 */
@Service()
export class Templates {
  readonly #examples = inject(Examples);

  #rows: Promise<EmailTemplate[]> | null = null;

  async find(
    filter: Filter<EmailTemplate> = {},
    signal?: AbortSignal,
  ): Promise<EmailTemplate[]> {
    return respond(applyFilter(await this.#all(), filter), signal);
  }

  /** Stores `template` over the one with its id and answers it as stored,
      after the same latency a find takes. */
  async save(template: EmailTemplate, signal?: AbortSignal): Promise<EmailTemplate> {
    const rows = await this.#all();
    const at = rows.findIndex((row) => row.id === template.id);
    if (at < 0) throw new Error(`No template ${template.id}`);
    const [stored] = await respond([structuredClone(template)], signal);
    rows[at] = structuredClone(stored);
    return stored;
  }

  #all(): Promise<EmailTemplate[]> {
    return (this.#rows ??= this.#load());
  }

  async #load(): Promise<EmailTemplate[]> {
    const sets = (await this.#examples.sets()).filter((set) => set.dialect);
    const rows = await Promise.all(sets.map((set) => this.#rowsOf(set)));
    return rows.flat();
  }

  async #rowsOf(set: ExampleSet): Promise<EmailTemplate[]> {
    return Promise.all(
      set.examples.map(async (example) => ({
        id: exampleId(example),
        name: example.name,
        dialect: set.dialect!,
        html: await this.#examples.document(set, example),
        envelope: example.envelope && envelopeOf(example.envelope),
      })),
    );
  }
}
