import { createSchema } from '../schema';
import { parseHTML, serializeToHTML } from '../html';
import { createEditor } from '../editor';
import { emailExtensions } from './kits';
import { UNKNOWN_MARKUP_ATTR, UNKNOWN_MARKUP_CLASS, unknownMarkup } from './unknown-markup';

const schema = createSchema(emailExtensions);
const found = (html: string) =>
  unknownMarkup(parseHTML(html, schema)).map(({ kind, label, inline }) => ({
    kind,
    label,
    inline,
  }));

describe('unknown markup — what the library does not know yet, marked', () => {
  it('marks nothing on our own blocks', () => {
    expect(
      found('<div>plain</div><div><strong style="font-weight: bold;">bold</strong></div>'),
    ).toEqual([]);
  });

  it('marks markup only the verbatim fallback holds as kept, named by its class', () => {
    expect(found('<div class="notion-email"><div>words</div></div>')).toEqual([
      { kind: 'kept', label: 'Kept as written: <div class="notion-email">', inline: false },
    ]);
  });

  it('names a tag, an attribute and a style property outside the vocabulary', () => {
    const [entry] = found(
      '<x-card data-id="7" style="color: red; colr: blue"><div>a</div></x-card>',
    );
    expect(entry.kind).toBe('unknown');
    expect(entry.label).toBe(
      'Not known yet: <x-card>, data-id, style colr\nKept as written: <x-card>',
    );
  });

  it('reads our own blocks’ authored markup too', () => {
    const [entry] = found('<p class="lead" data-track="1">lead</p>');
    expect(entry).toMatchObject({ kind: 'unknown', label: 'Not known yet: data-track' });
  });

  it('marks a kept inline run as a run', () => {
    const marks = found('<div>a <span class="pill">b</span> c</div>');
    expect(marks).toEqual([
      { kind: 'kept', label: 'Kept as written: <span class="pill">', inline: true },
    ]);
  });

  it('never reaches the email', () => {
    const html = '<div class="notion-email"><div>words</div></div>';
    expect(serializeToHTML(parseHTML(html, schema), schema)).toBe(html);
  });

  it('decorates the editor’s view', () => {
    const host = document.createElement('div');
    const editor = createEditor({
      parent: host,
      extensions: emailExtensions,
      content: '<div class="notion-email"><div>words</div></div>',
    });
    const marked = host.querySelector(`.${UNKNOWN_MARKUP_CLASS}`);
    expect(marked?.getAttribute(UNKNOWN_MARKUP_ATTR)).toBe('kept');
    expect(marked?.getAttribute('title')).toBe('Kept as written: <div class="notion-email">');
    expect(editor.getHTML()).not.toContain(UNKNOWN_MARKUP_CLASS);
    editor.destroy();
  });
});
