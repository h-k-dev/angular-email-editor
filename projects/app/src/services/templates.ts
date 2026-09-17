import { Service } from '@angular/core';

import {
  ANGULAR_EXPRESSION_EXAMPLES,
  EVERYDAY_EXAMPLES,
  HANDLEBARS_EXAMPLES,
  TemplateExample,
} from '../../test/template-examples';
import { Filter, FindOptions, applyFilter, respond } from './loopback-filter';

/** A stored email template, as the backend's `Template` model returns it. */
export interface EmailTemplate {
  id: string;
  name: string;
  /** The templating dialect its tokens are written in. */
  dialect: 'angularjs' | 'handlebars';
  /** The body, as canonical email HTML with the tokens verbatim. */
  html: string;
}

/**
 * The template store. Stands in for `GET /api/templates?filter=…` on a
 * LoopBack 3 backend: `find(filter)` is the one call, answered by the shared
 * filter mock (`where` with `like` / `ilike` / `inq` / `and` / `or`,
 * `order`, `skip`, `limit`) after a small latency, and cancelled by an
 * `AbortSignal`. A real host swaps the body for
 *
 *     firstValueFrom(this.#http.get<EmailTemplate[]>('/api/templates', {
 *       params: { filter: JSON.stringify(filter) },
 *     }))
 *
 * Demo data: every example the app has, both dialects.
 */
@Service()
export class Templates {
  readonly #rows: EmailTemplate[] = [
    ...rows(ANGULAR_EXPRESSION_EXAMPLES, 'angularjs'),
    ...rows(EVERYDAY_EXAMPLES, 'angularjs'),
    ...rows(HANDLEBARS_EXAMPLES, 'handlebars'),
  ];

  find(filter: Filter<EmailTemplate> = {}, options: FindOptions = {}): Promise<EmailTemplate[]> {
    return respond(applyFilter(this.#rows, filter), options);
  }
}

function rows(examples: TemplateExample[], dialect: EmailTemplate['dialect']): EmailTemplate[] {
  return examples.map((example, index) => ({
    id: `${dialect}-${index}-${example.name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-')}`,
    name: example.name,
    dialect,
    html: example.html,
  }));
}
