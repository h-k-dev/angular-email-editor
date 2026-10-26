import { EditorState } from 'prosemirror-state';
import { Schema } from 'prosemirror-model';

import { SuggestionGroup, SuggestionRequest } from '@h-k-dev/angular-email-editor';

import { BLANK } from '../../../../../core/email/envelope';
import { TemplateItem, templateGroup } from './template-group';

const schema = new Schema({ nodes: { doc: { content: 'text*' }, text: {} } });
const state = EditorState.create({ schema });
const request: SuggestionRequest = {
  query: '',
  cursor: null,
  signal: new AbortController().signal,
  session: {},
};

const envelope = { ...BLANK, subject: 'Your code', attachments: [] };
const row = (command: TemplateItem['command']): TemplateItem => ({
  id: 'angularjs/sign-in-code',
  title: 'Sign-in code',
  command,
  envelope,
});

type Children = (request: SuggestionRequest) => unknown;
const children = (group: SuggestionGroup) => group.children as unknown as Children;

describe('templateGroup', () => {
  it('tells of a template once its command has put it in the body', () => {
    const picked = vi.fn();
    const ran = vi.fn(() => true);
    const group = templateGroup(() => [row(ran)], picked);
    const [item] = children(group)(request) as TemplateItem[];

    // Asked whether it can run — no dispatch — it tells nobody.
    expect(item.command(state)).toBe(true);
    expect(picked).not.toHaveBeenCalled();

    item.command(state, () => {});
    expect(ran).toHaveBeenCalledTimes(2);
    expect(picked).toHaveBeenCalledWith(expect.objectContaining({ envelope }));
  });

  it('passes a synchronous answer through synchronously, and a page as a page', async () => {
    const page = { items: [row(() => true)], nextCursor: 'next' };
    const sync = children(templateGroup(() => page, () => {}))(request) as typeof page;
    expect(sync.nextCursor).toBe('next');
    expect(sync.items).toHaveLength(1);

    const later = children(templateGroup(async () => page, () => {}))(request);
    expect(later).toBeInstanceOf(Promise);
    expect(((await later) as typeof page).items[0].id).toBe('angularjs/sign-in-code');
  });

  it('is the source itself when nobody listens', () => {
    const source = () => [row(() => true)];
    expect(templateGroup(source).children).toBe(source);
  });
});
