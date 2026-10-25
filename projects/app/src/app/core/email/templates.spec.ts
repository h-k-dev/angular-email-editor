import { TestBed } from '@angular/core/testing';
import { stubExampleAssets } from '../../../../test/examples-fixture';
import { Templates } from './templates';

describe('Templates', () => {
  let service: Templates;

  /** A find with the latency skipped. */
  const find = async (...args: Parameters<Templates['find']>) => {
    const pending = service.find(...args);
    await vi.runAllTimersAsync();
    return pending;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    stubExampleAssets();
    TestBed.configureTestingModule({});
    service = TestBed.inject(Templates);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('answers after a latency, like a server', async () => {
    let answered = false;
    service.find({ limit: 1 }).then(() => (answered = true));
    await vi.advanceTimersByTimeAsync(100);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(answered).toBe(true);
  });

  it('holds every template set, each row its file, dialect and document', async () => {
    const rows = await find({ order: 'name ASC' });
    expect(rows.map((row) => [row.id, row.dialect])).toEqual([
      ['handlebars/0', 'handlebars'],
      ['angularjs/2', 'angularjs'],
      ['angularjs/0', 'angularjs'],
      ['angularjs/1', 'angularjs'],
      ['handlebars/1', 'handlebars'],
    ]);
    expect(rows[2].html).toContain('Platzhalter im Überblick');
  });

  it('answers a LoopBack filter: where, order, skip, limit', async () => {
    const rows = await find({ where: { name: { ilike: '%PLATZHALTER%' } } });
    expect(rows.map((row) => row.name)).toEqual(['Platzhalter im Überblick']);
    expect(await find({ where: { dialect: 'handlebars' } })).toHaveLength(2);
    const page = await find({ order: 'name ASC', skip: 2, limit: 1 });
    expect(page.map((row) => row.name)).toEqual(['Platzhalter im Überblick']);
  });

  it("carries the catalogue's envelope — the rest a new message's — and none where it gives none", async () => {
    const [code] = await find({ where: { name: 'Sign-in code' } });
    expect(code.envelope).toEqual({
      from: ['no-reply@example.com'],
      to: [],
      cc: [],
      bcc: [],
      subject: '{{ otp.code }} is your {{ company.name }} sign-in code',
      previewText: '',
      attachments: [],
    });
    const [letter] = await find({ where: { name: 'Platzhalter im Überblick' } });
    expect(letter.envelope).toBeUndefined();
  });

  it('saves a template over the one with its id, and finds it as saved', async () => {
    const [row] = await find({ where: { name: 'Sign-in code' } });
    const saving = service.save({ ...row, html: '<div>new</div>' });
    await vi.runAllTimersAsync();
    expect((await saving).html).toBe('<div>new</div>');
    const [again] = await find({ where: { name: 'Sign-in code' } });
    expect(again.html).toBe('<div>new</div>');
  });

  it('hands out copies, so a caller cannot edit the store', async () => {
    const [row] = await find({ limit: 1 });
    row.name = 'changed';
    const [again] = await find({ limit: 1 });
    expect(again.name).not.toBe('changed');
  });
});
