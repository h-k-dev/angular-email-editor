import { toInboundMessage } from './reply';
import { type ThreadHeaders, messageIds, threadMessages } from './thread';

describe('threadMessages', () => {
  const kickoff = { name: 'kickoff', messageId: '<a@x>', date: '2026-08-17T09:00:00Z' };
  const answer = {
    name: 'answer',
    messageId: '<b@x>',
    inReplyTo: '<a@x>',
    references: '<a@x>',
    date: '2026-08-18T10:12:00Z',
  };
  const second = {
    name: 'second',
    messageId: '<c@x>',
    inReplyTo: '<b@x>',
    references: '<a@x> <b@x>',
    date: '2026-08-18T11:40:00Z',
  };
  const other = { name: 'other', messageId: '<z@x>', date: '2026-08-18T08:00:00Z' };
  const names = (threads: { name: string }[][]) =>
    threads.map((thread) => thread.map((m) => m.name));

  it('gathers a conversation by its headers, oldest first, every message once', () => {
    // As an inbox lists them: latest on top.
    expect(names(threadMessages([second, other, answer, kickoff]))).toEqual([
      ['kickoff', 'answer', 'second'],
      ['other'],
    ]);
  });

  it('joins two answers through a message that is not there', () => {
    // The kickoff was never received: both still name it.
    expect(
      names(threadMessages([answer, { ...second, inReplyTo: undefined, references: '<a@x>' }])),
    ).toEqual([['answer', 'second']]);
  });

  it('never threads by subject, or by nothing at all', () => {
    const bare: (ThreadHeaders & { name: string; subject: string })[] = [
      { name: 'one', subject: 'Re: Invoice' },
      { name: 'two', subject: 'Re: Invoice' },
    ];
    expect(names(threadMessages(bare))).toEqual([['one'], ['two']]);
  });

  it('keeps the order given where a date is missing', () => {
    const undated = { ...kickoff, date: undefined };
    expect(names(threadMessages([answer, undated]))).toEqual([['answer', 'kickoff']]);
  });

  it('reads a header’s ids with or without their brackets', () => {
    expect(messageIds('<a@x>', undefined, '<b@x>\r\n <c@x>')).toEqual(['a@x', 'b@x', 'c@x']);
    expect(messageIds('a@x')).toEqual(['a@x']);
  });

  it('reads no word of a header’s prose or comments as an id', () => {
    expect(messageIds('Your message of Mon, 17 Aug 2026 <a@x>')).toEqual(['a@x']);
    expect(messageIds('<a@x> (Sam’s message of Monday)')).toEqual(['a@x']);
    expect(messageIds('(no brackets) a@x b@x')).toEqual(['a@x', 'b@x']);
    // Two messages answered in prose that shares a word stay apart.
    const one = { name: 'one', messageId: '<1@x>', inReplyTo: 'Your message of Monday <a@x>' };
    const two = { name: 'two', messageId: '<2@x>', inReplyTo: 'Your message of Friday <b@x>' };
    expect(names(threadMessages([one, two]))).toEqual([['one'], ['two']]);
  });

  it('threads what a parser hands over, through toInboundMessage', () => {
    const parsed = (messageId: string, inReplyTo?: string) =>
      toInboundMessage({ html: '<p>x</p>', messageId, inReplyTo, references: inReplyTo });
    const threads = threadMessages([parsed('<a@x>'), parsed('<b@x>', '<a@x>')]);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.[1]?.inReplyTo).toBe('<a@x>');
  });
});
