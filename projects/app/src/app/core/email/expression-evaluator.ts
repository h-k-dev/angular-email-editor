import { AngularNode, parseAngularExpression } from '@h-k-dev/angular-email-editor';

/** A value the stand-in does not compute — a helper call, a filter. */
class Unsupported extends Error {}

/**
 * One placeholder's value, the way iusta's TextParser computes it: the
 * expression read as AngularJS (the library's own parser) and evaluated
 * against the case, `lookup` answering a field by its dotted path. Enough
 * of `$parse` for a template's own logic — fields, literals, operators,
 * the ternary, `;` statements with assigned locals; a helper call
 * (`round(…)`) or a filter (`| formatDateDE`) is the backend's own and comes
 * back empty, as does anything that does not parse — the way the real
 * evaluator answers what it cannot compute.
 */
export function evaluateExpression(expression: string, lookup: (path: string) => unknown): string {
  try {
    const value = evaluate(parseAngularExpression(expression), lookup, new Map());
    return value === null || value === undefined ? '' : String(value);
  } catch {
    return '';
  }
}

/** A member chain as the dotted path the catalogue names it by —
    `custom.field1`; null where a step is computed from a value. */
function path(node: AngularNode): string | null {
  if (node.type === 'Identifier') return node.name;
  if (node.type !== 'Member') return null;
  const object = path(node.object);
  if (object === null) return null;
  if (!node.computed && node.property.type === 'Identifier') {
    return `${object}.${node.property.name}`;
  }
  if (node.property.type === 'Literal') return `${object}.${String(node.property.value)}`;
  return null;
}

function evaluate(
  node: AngularNode,
  lookup: (path: string) => unknown,
  locals: Map<string, unknown>,
): unknown {
  const value = (child: AngularNode) => evaluate(child, lookup, locals);
  switch (node.type) {
    case 'Literal':
      return node.value;
    case 'Identifier':
      return locals.has(node.name) ? locals.get(node.name) : lookup(node.name);
    case 'Member': {
      const dotted = path(node);
      if (dotted !== null && !locals.has(dotted.split('.')[0])) return lookup(dotted);
      // AngularJS reads through a missing object as undefined, never throws.
      const object = value(node.object) as Record<string, unknown> | null | undefined;
      const key = node.computed
        ? String(value(node.property))
        : (node.property as { name: string }).name;
      return object == null || !Object.hasOwn(object, key) ? undefined : object[key];
    }
    case 'Unary': {
      const argument = value(node.argument);
      if (node.operator === '!') return !argument;
      if (node.operator === '-') return -Number(argument);
      return Number(argument);
    }
    case 'Binary':
      return binary(node.operator, node.left, node.right, value);
    case 'Conditional':
      return value(node.test) ? value(node.consequent) : value(node.alternate);
    case 'Assignment': {
      const assigned = value(node.value);
      if (node.target.type === 'Identifier') locals.set(node.target.name, assigned);
      return assigned;
    }
    case 'Array':
      return node.elements.map(value);
    case 'Program':
      return node.statements.reduce<unknown>((_, statement) => value(statement), undefined);
    case 'Call':
    case 'Filter':
      throw new Unsupported(node.type);
  }
}

function binary(
  operator: string,
  leftNode: AngularNode,
  rightNode: AngularNode,
  value: (node: AngularNode) => unknown,
): unknown {
  // Short-circuit first: the right side may not be read at all.
  if (operator === '&&') return value(leftNode) && value(rightNode);
  if (operator === '||') return value(leftNode) || value(rightNode);
  const left = value(leftNode) as never;
  const right = value(rightNode) as never;
  switch (operator) {
    case '==':
      return loose(left, right);
    case '!=':
      return !loose(left, right);
    case '===':
      return left === right;
    case '!==':
      return left !== right;
    case '<':
      return left < right;
    case '>':
      return left > right;
    case '<=':
      return left <= right;
    case '>=':
      return left >= right;
    case '+':
      // AngularJS adds an undefined side as nothing: `undefined + 'x'` is 'x'.
      return left === undefined ? right : right === undefined ? left : left + right;
    case '-':
      return Number(left) - Number(right);
    case '*':
      return Number(left) * Number(right);
    case '/':
      return Number(left) / Number(right);
    case '%':
      return Number(left) % Number(right);
  }
  throw new Unsupported(operator);
}

/** JavaScript's `==`, which AngularJS keeps: a field holds text, so
    `custom.field5 == 12` must hold for '12'. */
function loose(left: unknown, right: unknown): boolean {
  if (left == null || right == null) return left == null && right == null;
  if (typeof left === typeof right) return left === right;
  return Number(left) === Number(right);
}
