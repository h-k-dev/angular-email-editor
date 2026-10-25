import { evaluateExpression } from './expression-evaluator';

describe('evaluateExpression', () => {
  const fields = new Map<string, unknown>([
    ['firstName', 'Ada'],
    ['custom.field1', 'swoosh'],
    ['custom.field5', '12'],
  ]);
  const value = (expression: string) => evaluateExpression(expression, (path) => fields.get(path));

  it('reads a field by its dotted path', () => {
    expect(value(' firstName ')).toBe('Ada');
    expect(value('custom.field1')).toBe('swoosh');
    expect(value("custom['field1']")).toBe('swoosh');
  });

  it('answers a field without a value, or a missing object, as empty', () => {
    expect(value('lastName')).toBe('');
    expect(value('company.name')).toBe('');
    expect(value('constructor')).toBe('');
  });

  it('walks a ternary chain to the branch the field picks', () => {
    const chain =
      'custom.field1 == "nike" ? "NIKE (word mark)" : custom.field1 == "swoosh" ? "Swoosh" : "—"';
    expect(value(chain)).toBe('Swoosh');
    expect(value('custom.field9 ? custom.field9 : "—"')).toBe('—');
  });

  it("compares loosely, as AngularJS does: a field's text equals its number", () => {
    expect(value('custom.field5 == 12 ? "yes" : "no"')).toBe('yes');
    expect(value('custom.field5 === 12 ? "yes" : "no"')).toBe('no');
  });

  it('computes operators, and keeps a local assigned in an earlier statement', () => {
    expect(value('custom.field5 * 2 + 1')).toBe('25');
    expect(value('!firstName')).toBe('false');
    expect(value('lastName || firstName && "both"')).toBe('both');
    expect(value('n = custom.field5 * 2; n + 1')).toBe('25');
  });

  it("leaves a helper call, a filter or a broken expression empty — the backend's own", () => {
    expect(value('round(custom.field5)')).toBe('');
    expect(value('custom.field4 | formatDateDE')).toBe('');
    expect(value('custom.field1 == ')).toBe('');
  });
});
