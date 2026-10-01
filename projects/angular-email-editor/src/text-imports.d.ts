/** A file imported as text (`import html from './x.html' with { loader: 'text' }`)
    — the render specs read the app's example documents this way. Specs only:
    the library build excludes this file. */
declare module '*.html' {
  const text: string;
  export default text;
}
