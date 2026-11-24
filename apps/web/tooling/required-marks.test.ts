// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Task 11.18 (docs/spec/12-ux-standards.md, No lost work): "A field that must be
// filled is marked with a red asterisk (*) after its label, on every form ...
// A field without the mark may be left empty." The walk reads every component
// of the web app and finds every field: a field component of
// `components/field.tsx` and every raw control. Each one either takes what its
// form's schema says (a spread `form.bind(...)`, whose `required` comes from
// the schema, or `required={requiredOf(...)}` / `required={binding.required}`),
// or is a control that is not a field of a form, named below with its reason.
// A `required` written by hand, in any way, is refused: the mark comes from
// the schema, never from a person's guess.

const SRC = path.resolve(import.meta.dirname, '../src');

/** The field components of `components/field.tsx`, and the pickers drawn like them. */
const FIELDS = new Set([
  'Field',
  'DateField',
  'PhoneField',
  'NumberField',
  'SelectField',
  'TextAreaField',
  'CheckboxField',
  'CheckboxGroupField',
  'OrderedListField',
]);
/** The raw controls and their wrappers of `components/ui/`. */
const RAW = new Set(['input', 'select', 'textarea', 'Input', 'Select', 'Textarea']);

/**
 * Controls that are not a field of a form, by file, with how many there are
 * and why: they send no record that a schema checks (list filters, report and
 * view pickers, switchers, search), or are an action, not a field. A new one
 * changes the count here, with its reason.
 */
const NOT_FORM_FIELDS: Readonly<Record<string, { count: number; reason: string }>> = {};

/**
 * Files left out of the walk: the field components themselves, and tests and
 * samples of the development pages.
 */
const LEFT_OUT = new Set(['components/field.tsx']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return files(full);
    }
    return name.endsWith('.tsx') && !name.endsWith('.test.tsx') ? [full] : [];
  });
}

interface Finding {
  file: string;
  line: number;
  tag: string;
  problem: 'unmarked' | 'by hand' | 'raw control spreads a binding';
}

/** Whether an expression is a binding of `useRecordForm` (`form.bind('name')`, or a name given one). */
function isBinding(expression: ts.Expression, bindings: ReadonlySet<string>): boolean {
  if (ts.isCallExpression(expression)) {
    const callee = expression.expression;
    // `form.bind('x')`, or a form's own `bind('x')` that hands `form.bind` on with more.
    return (
      (ts.isPropertyAccessExpression(callee) && callee.name.text === 'bind') ||
      (ts.isIdentifier(callee) && callee.text === 'bind')
    );
  }
  if (ts.isIdentifier(expression)) {
    return bindings.has(expression.text);
  }
  if (ts.isParenthesizedExpression(expression)) {
    return isBinding(expression.expression, bindings);
  }
  return false;
}

/** `required={requiredOf(...)}`, `required={binding.required}`, or a `required` handed on. */
function fromSchema(expression: ts.Expression): boolean {
  if (ts.isCallExpression(expression)) {
    return ts.isIdentifier(expression.expression) && expression.expression.text === 'requiredOf';
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text === 'required';
  }
  return ts.isIdentifier(expression) && expression.text === 'required';
}

function walk(file: string): Finding[] {
  const relative = path.relative(SRC, file).split(path.sep).join('/');
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // Names given a binding: `const bound = form.bind('x')`, or a parameter typed `FieldBinding`.
  const bindings = new Set<string>();
  const findings: Finding[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (isBinding(node.initializer, new Set())) {
        bindings.add(node.name.text);
      }
    }
    if (
      (ts.isParameter(node) || ts.isPropertySignature(node)) &&
      node.type !== undefined &&
      /\bFieldBinding\b/.test(node.type.getText(source))
    ) {
      if (ts.isIdentifier(node.name)) {
        bindings.add(node.name.text);
      }
    }
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
      // `{ binding }: { binding: FieldBinding }`: the parameter's type names it.
      const parameter = node.parent.parent;
      if (
        ts.isParameter(parameter) &&
        parameter.type !== undefined &&
        new RegExp(`\\b${node.name.text}\\s*:\\s*FieldBinding\\b`).test(
          parameter.type.getText(source),
        )
      ) {
        bindings.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const check = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const field = FIELDS.has(tag);
      const raw = RAW.has(tag);
      if (field || raw) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        let spread = false;
        let marked = false;
        let hidden = false;
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxSpreadAttribute(attribute) && isBinding(attribute.expression, bindings)) {
            spread = true;
          }
          if (ts.isJsxAttribute(attribute)) {
            const name = attribute.name.getText(source);
            if (name === 'type') {
              const value = attribute.initializer;
              if (value !== undefined && ts.isStringLiteral(value) && value.text === 'hidden') {
                hidden = true;
              }
            }
            if (name === 'required') {
              const value = attribute.initializer;
              const ok =
                value !== undefined &&
                ts.isJsxExpression(value) &&
                value.expression !== undefined &&
                fromSchema(value.expression) &&
                !spread;
              if (ok) {
                marked = true;
              } else {
                findings.push({ file: relative, line, tag, problem: 'by hand' });
                marked = true;
              }
            }
          }
        }
        if (raw && spread) {
          findings.push({ file: relative, line, tag, problem: 'raw control spreads a binding' });
        } else if (!spread && !marked && !hidden) {
          findings.push({ file: relative, line, tag, problem: 'unmarked' });
        }
      }
    }
    ts.forEachChild(node, check);
  };
  check(source);
  return findings;
}

const all = files(SRC)
  .filter((file) => !LEFT_OUT.has(path.relative(SRC, file).split(path.sep).join('/')))
  .flatMap(walk);

describe('the red asterisk of every form (task 11.18)', () => {
  it('writes no required by hand: the mark comes from the schema', () => {
    expect(all.filter((finding) => finding.problem !== 'unmarked')).toEqual([]);
  });

  it('refuses a required written as an object key or a default value', () => {
    const written = files(SRC)
      .filter((file) => !LEFT_OUT.has(path.relative(SRC, file).split(path.sep).join('/')))
      .filter((file) =>
        /\brequired\s*(?::|=)\s*(?:true|false|!|\(|'|"|`)/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => path.relative(SRC, file));
    expect(written).toEqual([]);
  });

  it('marks every field of a form from its schema, or names the control that is not one', () => {
    const unmarked = new Map<string, Finding[]>();
    for (const finding of all.filter((one) => one.problem === 'unmarked')) {
      unmarked.set(finding.file, [...(unmarked.get(finding.file) ?? []), finding]);
    }
    const counts = Object.fromEntries([...unmarked].map(([file, found]) => [file, found.length]));
    const allowed = Object.fromEntries(
      Object.entries(NOT_FORM_FIELDS).map(([file, { count }]) => [file, count]),
    );
    expect(counts).toEqual(allowed);
  });

  it('gives every control left out a reason', () => {
    for (const { reason } of Object.values(NOT_FORM_FIELDS)) {
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});

export { walk };
