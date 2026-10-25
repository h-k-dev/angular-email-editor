import { DocPageLink } from '../../../partials/common/doc-page/doc';

/**
 * The library's components, a page each, as the aside lists them — one
 * per secondary entry point that renders something, its id the entry's
 * name (`@h-k-dev/angular-email-editor/<id>`). Light on purpose: the aside
 * and the routes read it, the words (`components.content.ts`) and the
 * playgrounds (`PLAYGROUNDS`) stay in their own chunks.
 */
export const COMPONENT_PAGES: readonly DocPageLink[] = [
  { id: 'address-input', key: 'app.nav.componentPages.addressInput', icon: 'alternate_email' },
  { id: 'address-chip', key: 'app.nav.componentPages.addressChip', icon: 'label' },
  { id: 'attachment-chip', key: 'app.nav.componentPages.attachmentChip', icon: 'attach_file' },
  { id: 'attachment-chips', key: 'app.nav.componentPages.attachmentChips', icon: 'attachment' },
  { id: 'chat-input', key: 'app.nav.componentPages.chatInput', icon: 'chat' },
  { id: 'split-button', key: 'app.nav.componentPages.splitButton', icon: 'call_split' },
  { id: 'suggestion-menu', key: 'app.nav.componentPages.suggestionMenu', icon: 'menu_open' },
  {
    id: 'toggle-button-group',
    key: 'app.nav.componentPages.toggleButtonGroup',
    icon: 'toggle_on',
  },
  { id: 'material', key: 'app.nav.componentPages.material', icon: 'input' },
];

/**
 * The entry points that render nothing of their own — directives on the
 * host's elements, functions, data — a page each too, under their own
 * aside group: what they do is shown on a bench of the same kind.
 */
export const UTILITY_PAGES: readonly DocPageLink[] = [
  { id: 'actions', key: 'app.nav.utilityPages.actions', icon: 'bolt' },
  { id: 'focus', key: 'app.nav.utilityPages.focus', icon: 'center_focus_strong' },
  { id: 'anchor', key: 'app.nav.utilityPages.anchor', icon: 'anchor' },
  { id: 'image', key: 'app.nav.utilityPages.image', icon: 'image' },
  { id: 'proposal', key: 'app.nav.utilityPages.proposal', icon: 'auto_awesome' },
  { id: 'metrics', key: 'app.nav.utilityPages.metrics', icon: 'straighten' },
  { id: 'address', key: 'app.nav.utilityPages.address', icon: 'rule' },
  { id: 'palette', key: 'app.nav.utilityPages.palette', icon: 'palette' },
  { id: 'fonts', key: 'app.nav.utilityPages.fonts', icon: 'font_download' },
];

/** Every page under `/components/…`, whichever group lists it. */
export const ENTRY_PAGES: readonly DocPageLink[] = [...COMPONENT_PAGES, ...UTILITY_PAGES];
