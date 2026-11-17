# @h-k-dev/dawn

Dawn is the email render engine of [@h-k-dev/angular-email-editor](https://www.npmjs.com/package/@h-k-dev/angular-email-editor): an email drawn as a mail client draws it, light and dark. It has no framework in it and no dependencies. It runs in a browser, or on a server with a DOM.

Dark mode is rendering, never declaring. An email carries its light colours only. In dark, Dawn draws every colour the way a WebKit-based client draws an email that declares no dark mode: lightness inverted, hue kept, pictures untouched, on a dark surface. What is dark already stays as written, as a mail client on a phone keeps it: a background is never drawn lighter and text is never drawn darker, so an ink band stays ink and a white logo on it stays readable. A border follows the band it lies on: as written on a band kept as written, drawn on any other. An email that does declare dark mode keeps its own rules. The editor uses the same engine for its dark paper, its swatches, its reader and its thumbnails, so they never disagree.

## Install

```sh
npm install @h-k-dev/dawn
```

The editor depends on it already: an app using the editor imports Dawn from `@h-k-dev/angular-email-editor` too.

## Draw an email

```ts
import { renderDawn } from '@h-k-dev/dawn';

// A fragment (a message body) or a whole document, drawn as a document for
// a sandboxed frame.
const html = renderDawn(body, { scheme: 'dark', pane: 'phone' });
```

## On a server

Dawn reads HTML with the DOM (`DOMParser`, `<template>`). Give it one, for example with [linkedom](https://www.npmjs.com/package/linkedom), [happy-dom](https://www.npmjs.com/package/happy-dom) or [jsdom](https://www.npmjs.com/package/jsdom), set as the globals:

```ts
import { JSDOM } from 'jsdom';
const { window } = new JSDOM('');
Object.assign(globalThis, { window, document: window.document, DOMParser: window.DOMParser });

const { renderDawn } = await import('@h-k-dev/dawn');
const thumbnail = renderDawn(body, { scheme: 'dark' });
```

## What is in it

- `renderDawn(html, { scheme, pane? })`: an email as Dawn draws it, light or dark.
- `dawnDarkColor(token, role?)`: one CSS colour as Dawn draws it dark, for example to show a swatch on a dark page. With a role (`'surface'` for a background, `'ink'` for text) a colour that is dark already, or light already, is returned as written.
- `dawnDarkDeclarations`, `dawnDarkStyleSheet`, `dawnDarkDocument`: the dark drawing applied to a style attribute, a style sheet or a whole document. `declaresDark(doc)` tells whether an email declares its own dark mode.
- `renderForClient(html, client, { dark?, pane? })`: what Gmail, classic Outlook and an Apple client keep of an email, drawn for a frame. `CSS_SUPPORT` and `findCssIssues` hold the client-support data it reads.
- `sentBody(html)`: a fragment as the editor sends it, with images fitted and stacking columns marked.

The colour transform follows WebKit's invert-lightness filter, used under WebKit's BSD licence (Copyright © Apple Inc.). Dawn is not made, approved or endorsed by Apple.
