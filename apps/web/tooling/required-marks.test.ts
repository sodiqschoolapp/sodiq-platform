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
  // A hand-drawn group of radios or ticks (`components/field.tsx`): its controls
  // are marked by the group.
  'RequiredGroup',
]);
/** The raw controls and their wrappers of `components/ui/`. */
const RAW = new Set(['input', 'select', 'textarea', 'Input', 'Select', 'Textarea']);

/**
 * Controls that are not a field of a form, by file, with how many there are
 * and why: they send no record that a schema checks (list filters, report and
 * view pickers, switchers, search), or are an action, not a field. A new one
 * changes the count here, with its reason.
 */
const NOT_FORM_FIELDS: Readonly<Record<string, { count: number; reason: string }>> = {
  'components/language-chooser.tsx': {
    count: 1,
    reason: 'The language switch of the top bar acts at once; it sends no record a schema checks.',
  },
  'components/list/data-table.tsx': {
    count: 2,
    reason:
      'The row and all-rows checkboxes of a list choose rows for bulk actions; not a field of a form.',
  },
  'components/list/list-page.tsx': {
    count: 2,
    reason: 'The search box and a filter select of a list; they send no record.',
  },
  'components/search/command-search.tsx': {
    count: 1,
    reason: 'The Ctrl+K search box; it sends no record.',
  },
  'components/ui/segmented.tsx': {
    count: 1,
    reason: 'The primitive of a segmented switch; the field that uses it carries the mark.',
  },
  'components/ui/select.tsx': {
    count: 1,
    reason: 'The primitive select that the field components draw; the mark is drawn by the field.',
  },
  'components/ui/textarea.tsx': {
    count: 1,
    reason:
      'The primitive text area that the field components draw; the mark is drawn by the field.',
  },
  'features/access/integration-keys-page.tsx': {
    count: 1,
    reason:
      'The search box of the people picker: it finds people, the group of ticks below it is the field.',
  },
  'features/access/switchers.tsx': {
    count: 1,
    reason: 'The branch switcher of the top bar acts at once; it sends no record.',
  },
  'features/assistant/assistant-chat.tsx': {
    count: 1,
    reason:
      "The chat's question box; Send stays off while it is empty, a message box rather than a field of a record form.",
  },
  'features/audit/audit-page.tsx': {
    count: 6,
    reason: 'Filters of the audit log list; they send no record.',
  },
  'features/auth/account/language-section.tsx': {
    count: 1,
    reason: 'The account language select saves at once on change; it always holds a language.',
  },
  'features/auth/account/photo-section.tsx': {
    count: 1,
    reason: 'The hidden file input behind the photo buttons is an action, not a field.',
  },
  'features/auth/parent-home-page.tsx': {
    count: 1,
    reason: 'The digest frequency radios save at once on change; always one is chosen.',
  },
  'features/auth/second-step-set-up.tsx': {
    count: 1,
    reason: 'The "I saved the codes" tick switches Finish on; it is not sent.',
  },
  'features/auth/sign-in-page.tsx': {
    count: 1,
    reason:
      'The "Trust this device" switch is optional (trustDevice is optional in the schema); a raw checkbox, so no mark is needed.',
  },
  'features/classes/group-placement-page.tsx': {
    count: 3,
    reason:
      "The subject, grades and date choose which placement table the page shows; the save sends the table's rows.",
  },
  'features/journal/branch-exports-page.tsx': {
    count: 2,
    reason: 'Quarter and month of a branch export: the choice of a report, not a record.',
  },
  'features/journal/discipline-page.tsx': {
    count: 3,
    reason: 'Filters of the discipline report.',
  },
  'features/journal/exemptions-page.tsx': {
    count: 1,
    reason: 'The hidden upload input of a document: an action behind a button, not a field.',
  },
  'features/journal/journal-page.tsx': {
    count: 7,
    reason: 'Quarter, view, search and filter pickers of the journal page.',
  },
  'features/journal/journals-page.tsx': {
    count: 1,
    reason: 'Filter of the journals list.',
  },
  'features/journal/lesson-editor.tsx': {
    count: 1,
    reason: 'The total of a work in the lesson card, saved as it is typed like a journal cell.',
  },
  'features/journal/lesson-mode-score.tsx': {
    count: 1,
    reason: 'A score cell of lesson mode, saved as it is typed like a journal cell.',
  },
  'features/journal/student-absences-page.tsx': {
    count: 4,
    reason: 'Class and date filters of the page, and the hidden upload input behind a button.',
  },
  'features/journal/support-page.tsx': {
    count: 3,
    reason: 'Filters of the support view.',
  },
  'features/people/parent-account-part.tsx': {
    count: 1,
    reason:
      'The language of a printed slip picks how the reset prints; it always holds a language.',
  },
  'features/people/parent-slips-page.tsx': {
    count: 1,
    reason: 'The language of the printed slips picks how they print; it always holds a language.',
  },
  'features/people/reset-entries-page.tsx': {
    count: 2,
    reason: "The from and to dates are a report filter of the page's address.",
  },
  'features/people/staff-import-page.tsx': {
    count: 2,
    reason:
      "A row's warning tick decides the row at once, and the hidden file input is the upload action.",
  },
  'features/people/staff-panel.tsx': {
    count: 1,
    reason: 'The hidden file input behind the photo buttons is an action, not a field.',
  },
  'features/people/student-import-page.tsx': {
    count: 3,
    reason:
      "A row's warning tick and relative-link tick decide the row at once, and the hidden file input is the upload action.",
  },
  'features/people/student-photo-section.tsx': {
    count: 1,
    reason: 'The hidden file input behind the photo buttons is an action, not a field.',
  },
  'features/people/vacancy-acting.tsx': {
    count: 1,
    reason:
      'The language confirmation tick appears only when the check asks it and switches the Save on; it is not a field of the record.',
  },
  'features/people/vacancy-fill-dialog.tsx': {
    count: 2,
    reason:
      'The row choice: all rows when left as is (rows is optional in vacancyFillCheckBodySchema); the ticks only narrow it.',
  },
  'features/plans/plan-item-editor.tsx': {
    count: 1,
    reason:
      'A hidden file input behind its button: adding a file is an action, not a field to fill.',
  },
  'features/plans/plan-masters-page.tsx': {
    count: 1,
    reason: 'The year picker of the list, a view choice that always holds a year.',
  },
  'features/plans/plan-parallel-page.tsx': {
    count: 3,
    reason: 'The subject, grade and quarter pickers of the view, filters that send no record.',
  },
  'features/plans/plan-reports-page.tsx': {
    count: 2,
    reason: 'The quarter and department filters of the report.',
  },
  'features/plans/plan-sharing.tsx': {
    count: 2,
    reason: 'The year and quarter that narrow the sources offered; only the bound source is sent.',
  },
  'features/plans/plans-page.tsx': {
    count: 1,
    reason: 'The year picker of the list, a view choice.',
  },
  'features/portal/digest-log-page.tsx': {
    count: 2,
    reason: 'Filters of the digest log.',
  },
  'features/results/close-quarter-dialog.tsx': {
    count: 2,
    reason:
      'The "acknowledge the warnings" and "lock now" ticks are confirmations asked before the close, not fields to fill.',
  },
  'features/results/reopening.tsx': {
    count: 2,
    reason:
      'The "acknowledge the warnings" and "lock now" ticks of the close-again dialog are confirmations, not fields to fill.',
  },
  'features/results/attendance-report-page.tsx': {
    count: 7,
    reason: 'Filters of the attendance report.',
  },
  'features/results/closing-page.tsx': {
    count: 1,
    reason: 'The quarter picker of the closing page.',
  },
  'features/results/early-warning-page.tsx': {
    count: 1,
    reason: 'The quarter picker of the early-warning list.',
  },
  'features/results/load-report-page.tsx': {
    count: 2,
    reason: 'Filters of the load report.',
  },
  'features/results/rating-page.tsx': {
    count: 6,
    reason: 'Filters of the rating report.',
  },
  'features/results/results-table-page.tsx': {
    count: 2,
    reason: 'Filters of the results table.',
  },
  'features/results/student-results-tab.tsx': {
    count: 1,
    reason: "The year picker of a student's results tab.",
  },
  'features/results/subject-mastery-page.tsx': {
    count: 5,
    reason: 'Filters of the subject mastery report.',
  },
  'features/setup/calendar-page.tsx': {
    count: 1,
    reason: 'The date of the day check, a query, not a record.',
  },
  'features/setup/calendar-shortened.tsx': {
    count: 1,
    reason:
      'The lesson ticks of a shortened day in a preview: the default stands until one is ticked.',
  },
  'features/setup/rooms-by-floor.tsx': {
    count: 1,
    reason: 'The building navigation on a phone, a view choice.',
  },
  'features/setup/subject-import-page.tsx': {
    count: 1,
    reason: 'A hidden file input behind the upload button: an action.',
  },
  'features/setup/subject-panel.tsx': {
    count: 1,
    reason: 'The year the panel shows, a view choice.',
  },
  'features/setup/template-settings-page.tsx': {
    count: 1,
    reason: 'The date the table shows, a query.',
  },
  'features/timetable/builder-page.tsx': {
    count: 1,
    reason: 'The version picker, navigation.',
  },
  'features/timetable/day-page.tsx': {
    count: 2,
    reason: 'The date and class the day page shows, navigation.',
  },
  'features/timetable/exam-form.tsx': {
    count: 3,
    reason:
      'The optional rating switch, the warning tick that confirms a save and the optional keep ticks.',
  },
  'features/timetable/exams-page.tsx': {
    count: 1,
    reason: 'The date the exams page shows, navigation.',
  },
  'features/timetable/grid-conflicts.tsx': {
    count: 1,
    reason: 'The filter of the conflict list.',
  },
  'features/timetable/grid-locks.tsx': {
    count: 2,
    reason: 'The day and teacher a lock button acts on; each always holds a value.',
  },
  'features/timetable/grid-step.tsx': {
    count: 4,
    reason: 'The view, class, teacher and room the grid shows.',
  },
  'features/timetable/grid-to-place.tsx': {
    count: 2,
    reason: 'The optional pairing and the optional double switch of a lesson to place.',
  },
  'features/timetable/load-import-page.tsx': {
    count: 1,
    reason: 'A hidden file input behind the upload button: an action.',
  },
  'features/timetable/load-page.tsx': {
    count: 1,
    reason: 'The version picker, navigation.',
  },
  'features/timetable/pattern-import-page.tsx': {
    count: 1,
    reason: 'A hidden file input behind the upload button: an action.',
  },
  'features/timetable/publish-impact.tsx': {
    count: 1,
    reason: 'The tick that confirms the transition week, a confirmation, not a field.',
  },
  'features/timetable/publish-shortened.tsx': {
    count: 1,
    reason: 'The lesson ticks of a shortened day: the default stands until one is ticked.',
  },
  'features/timetable/version-files.tsx': {
    count: 1,
    reason: 'What to print, a choice of a file button that always holds a value.',
  },
  'features/timetable/versions-page.tsx': {
    count: 2,
    reason: 'The year picker and the version to compare with, view choices.',
  },
  'features/timetable/views-page.tsx': {
    count: 2,
    reason: 'The record and date the view shows, navigation.',
  },
};

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
function isBinding(
  expression: ts.Expression,
  bindings: ReadonlySet<string>,
  binders: ReadonlySet<string> = new Set(),
): boolean {
  if (ts.isCallExpression(expression)) {
    const callee = expression.expression;
    // `form.bind('x')`; a form's own `bind('x')`, or another local function
    // that hands `form.bind` on with more; or a wrapper given a binding
    // (`fromStaff(bind('x'), value)`), which keeps what it does not change.
    const first = expression.arguments[0];
    return (
      (ts.isPropertyAccessExpression(callee) && callee.name.text === 'bind') ||
      (ts.isIdentifier(callee) && (callee.text === 'bind' || binders.has(callee.text))) ||
      (first !== undefined && isBinding(first, bindings, binders))
    );
  }
  if (ts.isIdentifier(expression)) {
    return bindings.has(expression.text);
  }
  if (ts.isParenthesizedExpression(expression)) {
    return isBinding(expression.expression, bindings, binders);
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      isBinding(expression.whenTrue, bindings, binders) &&
      isBinding(expression.whenFalse, bindings, binders)
    );
  }
  if (ts.isObjectLiteralExpression(expression)) {
    // `{ ...form.bind('x'), onChange }`: what the spread does not change it keeps.
    return expression.properties.some(
      (property) =>
        ts.isSpreadAssignment(property) && isBinding(property.expression, bindings, binders),
    );
  }
  return false;
}

/** The body a local function gives back, when it is one expression or one `return`. */
function returned(node: ts.Node): ts.Expression | undefined {
  const body =
    ts.isArrowFunction(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
      ? node.body
      : undefined;
  if (body === undefined) {
    return undefined;
  }
  if (!ts.isBlock(body)) {
    return body;
  }
  const last = body.statements.at(-1);
  return last !== undefined && ts.isReturnStatement(last) ? last.expression : undefined;
}

/**
 * `required={requiredOf(...)}`, `required={binding.required}`, a `required`
 * handed on, or a local name or function that gives `requiredOf(...)` back.
 */
function fromSchema(
  expression: ts.Expression,
  requirers: ReadonlySet<string> = new Set(),
): boolean {
  if (ts.isCallExpression(expression)) {
    return (
      ts.isIdentifier(expression.expression) &&
      (expression.expression.text === 'requiredOf' || requirers.has(expression.expression.text))
    );
  }
  if (ts.isIdentifier(expression) && requirers.has(expression.text)) {
    return true;
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
  // Local functions that give back a binding (`const untick = (field) => ({ ...form.bind(field) })`).
  const binders = new Set<string>();
  // Local names and functions that give back `requiredOf(...)`.
  const requirers = new Set<string>();
  const findings: Finding[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const result = returned(node.initializer) ?? node.initializer;
      if (fromSchema(result, requirers) && !ts.isIdentifier(result)) {
        requirers.add(node.name.text);
      }
      const gives = returned(node.initializer);
      // A local `const bound = form.bind('x')` is read after a returning function
      // that names it, so the bound names are known first.
      if (gives !== undefined) {
        const inner = new Set(bindings);
        if (ts.isBlock((node.initializer as ts.ArrowFunction).body)) {
          ((node.initializer as ts.ArrowFunction).body as ts.Block).statements.forEach(
            (statement) => {
              if (ts.isVariableStatement(statement)) {
                for (const declaration of statement.declarationList.declarations) {
                  if (
                    ts.isIdentifier(declaration.name) &&
                    declaration.initializer !== undefined &&
                    isBinding(declaration.initializer, inner, binders)
                  ) {
                    inner.add(declaration.name.text);
                  }
                }
              }
            },
          );
        }
        if (isBinding(gives, inner, binders)) {
          binders.add(node.name.text);
        }
      } else if (isBinding(node.initializer, bindings, binders)) {
        bindings.add(node.name.text);
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      const gives = returned(node);
      if (gives !== undefined && isBinding(gives, bindings, binders)) {
        binders.add(node.name.text);
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
      // `{ label, ...bound }: FieldBinding & { label: string }`: the rest is the binding.
      if (
        node.dotDotDotToken !== undefined &&
        ts.isParameter(parameter) &&
        parameter.type !== undefined &&
        /^FieldBinding\b/.test(parameter.type.getText(source))
      ) {
        bindings.add(node.name.text);
      }
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

  // A raw control inside `<RequiredGroup required={...}>` is marked by the group.
  const insideGroup = (node: ts.Node): boolean => {
    for (let up = node.parent; up !== undefined; up = up.parent) {
      if (ts.isJsxElement(up) && up.openingElement.tagName.getText(source) === 'RequiredGroup') {
        return true;
      }
    }
    return false;
  };
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
          if (
            ts.isJsxSpreadAttribute(attribute) &&
            isBinding(attribute.expression, bindings, binders)
          ) {
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
            if (name === 'aria-required' && raw) {
              // A raw control drawn with its own label and `RequiredMark`.
              const value = attribute.initializer;
              if (
                value !== undefined &&
                ts.isJsxExpression(value) &&
                value.expression !== undefined &&
                fromSchema(value.expression, requirers)
              ) {
                marked = true;
              } else {
                findings.push({ file: relative, line, tag, problem: 'by hand' });
                marked = true;
              }
            }
            if (name === 'required') {
              const value = attribute.initializer;
              const ok =
                value !== undefined &&
                ts.isJsxExpression(value) &&
                value.expression !== undefined &&
                fromSchema(value.expression, requirers) &&
                !spread &&
                // A raw control would take it as the browser's own `required`.
                !raw;
              if (ok) {
                marked = true;
              } else {
                findings.push({ file: relative, line, tag, problem: 'by hand' });
                marked = true;
              }
            }
          }
        }
        if (raw && insideGroup(node)) {
          marked = true;
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

/**
 * The schemas with requirements that only a refine or the server states, and
 * the `requiredWhen` maps of `packages/shared` beside them: a form that checks
 * with such a schema passes its map, or the marks of those fields never show.
 */
const MAPS: Readonly<Record<string, readonly string[]>> = {
  announcementFormSchema: ['announcementFormRequiredWhen'],
  assignmentRecordSchema: ['assignmentRequiredWhen'],
  calendarEntryRecordSchema: ['calendarEntryRequiredWhen'],
  examBodySchema: ['examRequiredWhen'],
  examCreateBodySchema: ['examRequiredWhen'],
  exemptionCreateSchema: ['exemptionCreateRequiredWhen'],
  loadRowRecordSchema: ['loadRowRecordRequiredWhen'],
  planRequestDecisionSchema: ['planRequestDecisionRequiredWhen'],
  ratingEntrySaveSchema: ['ratingEntrySaveRequiredWhen'],
  roleGiveSchema: ['roleGiveRequiredWhen'],
  roomRecordSchema: ['roomRecordRequiredWhen'],
  scholarshipSchema: ['scholarshipRequiredWhen'],
  staffTeachingSchema: ['staffTeachingRequiredWhen'],
  studentCreateSchema: ['studentCreateRequiredWhen'],
  studentRecordSchema: ['studentRecordRequiredWhen', 'studentCreateRequiredWhen'],
  vacancyRecordSchema: ['vacancyRecordRequiredWhen'],
};

describe('the red asterisk of every form (task 11.18)', () => {
  it('passes the requiredWhen map of every schema that has one to the forms that check with it', () => {
    const forgotten = files(SRC).flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      if (!/\buseRecordForm\b|\brequiredOf\(/.test(text)) {
        return [];
      }
      return Object.entries(MAPS)
        .filter(([schema]) => new RegExp(`\\b${schema}\\b`).test(text))
        .filter(([, maps]) => !maps.some((map) => new RegExp(`\\b${map}\\b`).test(text)))
        .map(([schema]) => `${path.relative(SRC, file)}: ${schema}`);
    });
    expect(forgotten).toEqual([]);
  });

  it('knows every requiredWhen map of packages/shared', () => {
    const shared = path.resolve(SRC, '../../../packages/shared/src');
    const declared = readdirSync(shared)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .flatMap((name) =>
        [
          ...readFileSync(path.join(shared, name), 'utf8').matchAll(
            /export const (\w+RequiredWhen)\b/g,
          ),
        ].map((match) => match[1]),
      );
    expect([...new Set(declared)].sort()).toEqual([...new Set(Object.values(MAPS).flat())].sort());
  });

  it('writes no required by hand: the mark comes from the schema', () => {
    expect(all.filter((finding) => finding.problem !== 'unmarked')).toEqual([]);
  });

  it('refuses a required written as an object key or a default value', () => {
    // Every `required:` or `required =` in a component, matched over the whole
    // text (Prettier may break the value onto the next line), is a type, a
    // value read from the schema, or the number of a text: anything else is a
    // mark typed by hand.
    const fromSchemaValue =
      /^(?:boolean\b|requiredOf\(|[\w.()'"]+\.required\b|required\b|number\.format\()/;
    const written = files(SRC)
      .filter((file) => !LEFT_OUT.has(path.relative(SRC, file).split(path.sep).join('/')))
      .flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(/\brequired\??\s*(?::|=(?![={]))\s*([^,;}\n]*)/g)]
          .filter((match) => !fromSchemaValue.test(match[1] ?? ''))
          .map((match) => `${path.relative(SRC, file)}: ${match[0]}`),
      );
    expect(written).toEqual([]);
  });

  it('refuses every way of writing a required by hand', () => {
    const pattern = /\brequired\??\s*(?::|=(?![={]))\s*([^,;}\n]*)/g;
    const fromSchemaValue =
      /^(?:boolean\b|requiredOf\(|[\w.()'"]+\.required\b|required\b|number\.format\()/;
    const handTyped = (code: string) =>
      [...code.matchAll(pattern)].some((match) => !fromSchemaValue.test(match[1] ?? ''));
    for (const code of [
      'const a = { required: true };',
      'const a = { required: someCondition };',
      'function F({ required = true }) {}',
      'const a = {\n  required:\n    x > 1,\n};',
    ]) {
      expect(handTyped(code.replace(/\n\s*/g, ' ')), code).toBe(true);
    }
    for (const code of [
      'interface A { required?: boolean }',
      'const a = { required: requiredOf(schema, typed, "x") };',
      'const a = { required: form.bind("x").required };',
    ]) {
      expect(handTyped(code), code).toBe(false);
    }
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
