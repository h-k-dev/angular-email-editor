/** A file imported as text (`import html from './x.html' with { loader: 'text' }`)
    — the render specs read the catalogue's example documents this way. Specs
    only: the app build excludes this file. */
declare module '*.html' {
  const text: string;
  export default text;
}
