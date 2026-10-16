import { Directive } from '@angular/core';

/**
 * Scopes chip drag and drop to the address inputs inside it: they trade
 * chips with each other and refuse anyone else's — a writer's From, To, Cc
 * and Bcc, and not the rows of another writer on the same page. Put it on
 * whatever holds the rows:
 *
 *     <form emailAddressDragGroup [formRoot]="envelope">
 *       <div email-address-input [formField]="envelope.from" limit="1"></div>
 *       <div email-address-input [formField]="envelope.to"></div>
 *       …
 *     </form>
 *
 * The nearest group around an input is its group. Inputs in no group make
 * up one group of their own, so a page with a single writer needs none.
 * Behaviour only: it renders nothing and sets no attribute.
 *
 * A chip lands in an address input or nowhere — it carries no plain text,
 * so a subject line, an editor or any other field leaves it alone.
 */
@Directive({ selector: '[emailAddressDragGroup]', exportAs: 'emailAddressDragGroup' })
export class AddressDragGroup {}
