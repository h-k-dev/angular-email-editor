/** Whether the HTML is a whole document — its own `<!doctype>`, `<html>`,
    `<head>` or `<body>` — rather than a fragment (a message body). */
export function hasDocumentEnvelope(html: string): boolean {
  return /<(?:!doctype|html|head|body)(?=[\s>/])/i.test(html);
}
