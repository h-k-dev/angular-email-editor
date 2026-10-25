import { DocPageLink } from '../../../partials/common/doc-page/doc';

/**
 * The styling reference's pages, as the aside lists them — light on
 * purpose: the aside and the routes read it, the content
 * (`styling.content.ts`) stays in the page's own chunk.
 */
export const STYLING_PAGES: readonly DocPageLink[] = [
  { id: 'theming', key: 'app.nav.stylingPages.theming', icon: 'contrast' },
  { id: 'editor-surface', key: 'app.nav.stylingPages.editorSurface', icon: 'select' },
  { id: 'composer-chrome', key: 'app.nav.stylingPages.composerChrome', icon: 'web' },
  { id: 'source-scrollbars', key: 'app.nav.stylingPages.source', icon: 'code' },
  { id: 'layout-spacing', key: 'app.nav.stylingPages.layout', icon: 'space_dashboard' },
  { id: 'material-form-field', key: 'app.nav.stylingPages.material', icon: 'input' },
  { id: 'class-hooks', key: 'app.nav.stylingPages.hooks', icon: 'data_object' },
];
