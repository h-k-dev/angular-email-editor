import { Service, inject } from '@angular/core';

import { AttachmentRef } from './attachment-uploads';
import { BLANK } from './envelope';
import { ExampleEnvelope, ExampleSet, Examples, exampleId } from './examples';
import { Filter, applyFilter, respond } from './loopback-filter';

/** A stored email template, as the backend's `Template` model returns it. */
export interface EmailTemplate {
  id: string;
  name: string;
  /** The templating dialect its tokens are written in — none for a
      template without tokens (an MJML newsletter). */
  dialect?: 'angularjs' | 'handlebars';
  /** Its category tag: its dialect's name, or its set's (`templateTag`). */
  tag: string;
  /** The body, as canonical email HTML with the tokens verbatim. */
  html: string;
  /** The message round the body, as the designer last saved it — none on
      a template no one has designed yet: a new message's rows then. */
  envelope?: TemplateEnvelope;
}

/** The dialects by name — a template's category tag; names, the same in
    every language. */
export const DIALECT_NAMES: Record<NonNullable<EmailTemplate['dialect']>, string> = {
  angularjs: 'AngularJS',
  handlebars: 'Handlebars',
};

/** A set of templates: every set of documents in the catalogue (`html`) —
    the dialect ones, and the MJML newsletters. */
export const isTemplateSet = (set: ExampleSet): boolean => set.kind === 'html';

/** A set's category tag: its dialect's name, else its own short name. */
export const templateTag = (set: ExampleSet): string =>
  set.dialect ? DIALECT_NAMES[set.dialect] : set.short;

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

/** What a new template is made of: its name, and the set it joins — written
    in that set's dialect, under its tag. Its body and its rows start empty. */
export interface TemplateDraft {
  name: string;
  set: string;
  dialect?: EmailTemplate['dialect'];
  tag: string;
}

/**
 * The template store. Stands in for `GET /api/templates?filter=…` on a
 * LoopBack 3 backend: `find(filter)` is the one call, answered by the shared
 * filter mock (`where` with `like` / `ilike` / `inq` / `and` / `or`,
 * `order`, `skip`, `limit`) after a small latency, and cancelled by an
 * `AbortSignal`; `save(template)` writes one back (the designer's), and
 * `create(draft)` adds one (the gallery's +). A real host swaps the bodies
 * for
 *
 *     firstValueFrom(this.#http.get<EmailTemplate[]>('/api/templates', {
 *       params: { filter: JSON.stringify(filter) },
 *     }))
 *     firstValueFrom(this.#http.patch<EmailTemplate>(`/api/templates/${id}`, template))
 *     firstValueFrom(this.#http.post<EmailTemplate>('/api/templates', draft))
 *
 * Demo data: every set of documents in the catalogue (`Examples`) — the
 * dialect ones and the MJML newsletters — loaded on the first find.
 */
@Service()
export class Templates {
  readonly #examples = inject(Examples);

  #rows: Promise<EmailTemplate[]> | null = null;
  #next = 1;

  async find(filter: Filter<EmailTemplate> = {}, signal?: AbortSignal): Promise<EmailTemplate[]> {
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

  /** Stores a new template — its set's, empty — and answers it with its
      id, after the same latency a find takes. */
  async create(draft: TemplateDraft, signal?: AbortSignal): Promise<EmailTemplate> {
    const rows = await this.#all();
    let id: string;
    do id = `${draft.set}/template-${this.#next++}`;
    while (rows.some((row) => row.id === id));
    const template: EmailTemplate = {
      id,
      name: draft.name,
      dialect: draft.dialect,
      tag: draft.tag,
      html: '',
    };
    const [stored] = await respond([template], signal);
    rows.push(structuredClone(stored));
    return stored;
  }

  #all(): Promise<EmailTemplate[]> {
    return (this.#rows ??= this.#load());
  }

  async #load(): Promise<EmailTemplate[]> {
    const sets = (await this.#examples.sets()).filter(isTemplateSet);
    const rows = await Promise.all(sets.map((set) => this.#rowsOf(set)));
    return rows.flat();
  }

  async #rowsOf(set: ExampleSet): Promise<EmailTemplate[]> {
    return Promise.all(
      set.examples.map(async (example) => ({
        id: exampleId(example),
        name: example.name,
        dialect: set.dialect,
        tag: templateTag(set),
        html: await this.#examples.document(set, example),
        envelope: example.envelope && envelopeOf(example.envelope),
      })),
    );
  }
}
