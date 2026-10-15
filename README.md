# Angular Email Editor

[![npm version](https://img.shields.io/npm/v/@h-k-dev/angular-email-editor.svg)](https://www.npmjs.com/package/@h-k-dev/angular-email-editor)
[![CI](https://github.com/h-k-dev/angular-email-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/h-k-dev/angular-email-editor/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@h-k-dev/angular-email-editor.svg)](./LICENSE)

An email editor for Angular, built on ProseMirror — a visual composer and an HTML source
editor over one schema that is the vocabulary of email HTML.

**[Try the live demo →](https://h-k-dev.github.io/angular-email-editor/)** ·
**[Package README →](./projects/angular-email-editor/README.md)** ·
**[Roadmap →](./ROADMAP.md)**

> This is the workspace repository. The published package,
> [`@h-k-dev/angular-email-editor`](https://www.npmjs.com/package/@h-k-dev/angular-email-editor),
> lives in [`projects/angular-email-editor`](./projects/angular-email-editor); its README is
> what npm shows. The demo app is [`projects/app`](./projects/app).

## Workspace

| Path | What |
| --- | --- |
| `projects/angular-email-editor` | The library: the main entry (`src/`) and one folder per secondary entry point |
| `projects/app` | The demo: composer, compose windows, API reference, styling and render pages |
| `scripts/summernote-corpus.mjs` | Regenerates the Summernote fixtures from a checkout of the host app |

## Development

```bash
npm ci
```

```bash
npm start
```

`npm start` builds the library into `dist/` and serves the demo on
`http://localhost:4200/` — the demo reads the library from `dist/`, so after changing the
library either run `npm run watch:lib` beside it or restart.

| Command | What it runs |
| --- | --- |
| `npx ng test angular-email-editor --watch=false` | Library unit tests (Vitest, jsdom, against the sources) |
| `npx ng test app --watch=false` | Demo tests (needs `npm run build:lib` first) |
| `npm run test:render` | Real-browser tests in headless Chromium (`*.render.spec.ts`) |
| `npm run build:lib` | The library into `dist/angular-email-editor` |
| `npx ng build app` | The demo, production |

The render tests need Playwright's Chromium once per Playwright version:

```bash
npx playwright install chromium
```

## CI and releases

- **[`ci.yml`](./.github/workflows/ci.yml)** runs on every pull request and every push to
  `development` and `main`: library tests, library build, demo tests, Chromium tests, and
  the demo's production build. A push to `main` deploys the demo to GitHub Pages. It never
  publishes.
- **[`release.yml`](./.github/workflows/release.yml)** is started by hand (Actions →
  Release → Run workflow) on `main`. It tests and builds the library at the version in
  [`projects/angular-email-editor/package.json`](./projects/angular-email-editor/package.json)
  and **stages** it on npm through Trusted Publishing — no token in the repository. A
  staged version is not installable until a maintainer approves it with 2FA, on npmjs.com
  or with `npm stage approve`. Then it is tagged `v<version>` in git.

The library is pre-1.0 and released deliberately: bump the version in the library's
`package.json` in a commit, merge to `main`, run the release, approve it.

## License

[MIT](./LICENSE)
