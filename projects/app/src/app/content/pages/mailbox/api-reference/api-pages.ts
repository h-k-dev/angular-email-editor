import { DocPageLink } from '../../../partials/common/doc-page/doc';

/**
 * The API reference's pages, as the aside lists them — light on purpose:
 * the aside and the routes read it, the content (`api-reference.content.ts`)
 * stays in the page's own chunk.
 */
export const API_PAGES: readonly DocPageLink[] = [
  { id: 'editor', key: 'app.nav.apiPages.editor', icon: 'edit_document' },
  { id: 'menus', key: 'app.nav.apiPages.menus', icon: 'menu_open' },
  { id: 'documents', key: 'app.nav.apiPages.documents', icon: 'description' },
  { id: 'addresses', key: 'app.nav.apiPages.addresses', icon: 'alternate_email' },
  { id: 'sending', key: 'app.nav.apiPages.sending', icon: 'send' },
  { id: 'safety', key: 'app.nav.apiPages.safety', icon: 'verified_user' },
  { id: 'integration', key: 'app.nav.apiPages.integration', icon: 'extension' },
];
