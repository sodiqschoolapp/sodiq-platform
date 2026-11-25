import path from 'node:path';
import ts from 'typescript';

// Task 11.19 (docs/spec/02-roles-and-access.md, Assistant, "Knows the platform": "from a map
// generated from the code of the app, so the map always matches the app"). The walk reads the
// web app with the TypeScript compiler, as the walk of the required marks (task 11.18) does:
// every page of the staff layout in `app/router.tsx`, and in the files each page draws its
// tabs, panels and dialogs, buttons, fields and list columns, each with its label key. It reads
// no data and renders nothing, so it sees every control whatever the data (plan decision 1).

/** The kinds of a node of the map. */
export type NodeKind = 'page' | 'tab' | 'panel' | 'button' | 'field' | 'column';

/** A page of the router under the staff layout. */
export interface WalkedPage {
  /** The route's template, `/journal/$journalId`. */
  path: string;
  /** The file of the page's component, relative to `src/`. */
  file: string;
  /** `guarded(area, Page, action)`: the area and action that decide who opens it. */
  guard: { area: string; action: string } | null;
  /** The path parameters, `journalId`, in order. */
  params: string[];
  /** The search keys the address takes and the type each has (`validateSearch`). */
  search: Record<string, SearchType>;
  /** The label key of the page's title (`PageHeader title={t(...)}`), when the walk reads one. */
  titleKey: string | null;
  /** Every file the page draws (its own and those it imports), relative to `src/`. */
  files: string[];
}

/** A search key's type as the compiler reads it. */
export type SearchType =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'record' }
  | { kind: 'enum'; values: string[] };

/** A control or a panel found in one file. */
export interface WalkedControl {
  /** `people/student-panel.tsx#button:people.students.archive`, `:2` for a second one. */
  id: string;
  kind: Exclude<NodeKind, 'page'>;
  file: string;
  /** The label keys: the first is the label; more when the label is one of a few. */
  keys: string[];
  /** The panel the control is inside, by id, when it is inside one. */
  parent: string | null;
  /** Area and action of a `permits(...)` or `useMayView(...)` that guards it in its component. */
  shownWith: Array<{ area: string; action: string }>;
  /** The API calls of its file (`api.POST('/api/…')`) as `POST /api/…`. */
  line: number;
}

export interface WalkProblem {
  file: string;
  line: number;
  problem: string;
}

export interface Walk {
  pages: WalkedPage[];
  /** The shell of the staff layout: its files, drawn on every page. */
  shellFiles: string[];
  controls: WalkedControl[];
  /** The API calls each file makes, as `METHOD /api/path`. */
  calls: Record<string, string[]>;
  /** The files under `components/` that call `t()` in a control. */
  componentFilesWithControls: string[];
  problems: WalkProblem[];
}

export interface WalkOptions {
  /** The `src` directory of the app (or of a fixture). */
  src: string;
  /** The router file, relative to `src`. */
  router: string;
  /** The layout route whose children are the staff pages. */
  layoutRoute: string;
  /** Files under `components/` walked as parts of the pages that draw them (plan, review should fix 5). */
  sharedParts: readonly string[];
  /** Tsconfig for the compiler options; a fixture passes none. */
  tsconfig?: string;
}

const BUTTONS = new Set(['Button', 'button', 'DropdownMenuItem']);
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
  'RequiredGroup',
]);
const TABS = new Set(['Segmented']);
const DIALOGS = new Set(['Dialog', 'AlertDialog', 'ConfirmDialog', 'ForcedDeleteDialog']);
const DIALOG_TITLES = new Set(['DialogTitle', 'AlertDialogTitle']);
const LABEL_ATTRIBUTES = ['label', 'aria-label', 'title'];
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function programOf(options: WalkOptions): ts.Program {
  if (options.tsconfig !== undefined) {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      options.tsconfig,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
          throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
        },
      },
    );
    if (parsed === undefined) throw new Error(`Cannot read ${options.tsconfig}`);
    return ts.createProgram(parsed.fileNames, parsed.options);
  }
  const files = ts.sys
    .readDirectory(options.src, ['.ts', '.tsx'])
    .filter((file) => !/\.test\.tsx?$/.test(file));
  return ts.createProgram(files, {
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    baseUrl: options.src,
    paths: { '@/*': ['./*'] },
  });
}

function rel(src: string, file: string): string {
  return path.relative(src, file).split(path.sep).join('/');
}

function lineOf(node: ts.Node): number {
  const source = node.getSourceFile();
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function tagName(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string {
  const tag = node.tagName;
  if (ts.isIdentifier(tag)) return tag.text;
  if (ts.isPropertyAccessExpression(tag)) return tag.name.text;
  return tag.getText();
}

function attribute(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  name: string,
): ts.Expression | ts.StringLiteral | undefined {
  for (const property of node.attributes.properties) {
    if (ts.isJsxAttribute(property) && property.name.getText() === name) {
      const value = property.initializer;
      if (value === undefined) return undefined;
      if (ts.isStringLiteral(value)) return value;
      if (ts.isJsxExpression(value)) return value.expression;
    }
  }
  return undefined;
}

/** The declaration file of an identifier, through its import. */
function declarationFile(checker: ts.TypeChecker, node: ts.Node): ts.SourceFile | undefined {
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol === undefined) return undefined;
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol.declarations?.[0]?.getSourceFile();
}

/** The string literals of a type that is a union of them, or `undefined`. */
function literalsOf(type: ts.Type): string[] | undefined {
  const parts = type.isUnion() ? type.types : [type];
  const out: string[] = [];
  for (const part of parts) {
    if (part.isStringLiteral()) out.push(part.value);
    else if (part.flags & ts.TypeFlags.Undefined) continue;
    else return undefined;
  }
  return out.length > 0 && out.length <= 40 ? out : undefined;
}

type Label = { keys: string[] } | { dynamic: true } | null;

/** Is this call `t(...)` or `i18n.t(...)`? */
function isTranslate(call: ts.CallExpression): boolean {
  const callee = call.expression;
  return (
    (ts.isIdentifier(callee) && callee.text === 't') ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === 't')
  );
}

/** The label keys of one `t(...)` call. */
function keysOfCall(checker: ts.TypeChecker, call: ts.CallExpression): Label {
  const argument = call.arguments[0];
  if (argument === undefined) return { dynamic: true };
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
    return { keys: [argument.text] };
  }
  const literals = literalsOf(checker.getTypeAtLocation(argument));
  return literals === undefined ? { dynamic: true } : { keys: literals };
}

/** The label keys an expression gives: `t('k')`, a choice of two, or a value. */
function labelOf(checker: ts.TypeChecker, expression: ts.Node | undefined, depth = 0): Label {
  if (expression === undefined) return null;
  // A label held in a constant of the same component: `const title = t('…')`.
  if (ts.isIdentifier(expression) && depth < 3) {
    const initializer = localInitializer(checker, expression);
    if (initializer !== undefined) return labelOf(checker, initializer, depth + 1);
  }
  if (ts.isStringLiteral(expression)) return { dynamic: true };
  const found: string[] = [];
  let dynamic = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTranslate(node)) {
      const label = keysOfCall(checker, node);
      if (label === null || 'dynamic' in label) dynamic = true;
      else found.push(...label.keys);
      return;
    }
    // A nested element is its own control (an icon, a badge): its texts are not this label.
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return;
    ts.forEachChild(node, visit);
  };
  visit(expression);
  if (found.length > 0) return { keys: [...new Set(found)] };
  if (dynamic) return { dynamic: true };
  if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) {
    return { dynamic: true };
  }
  return null;
}

/** The initializer of a local constant an identifier names, in the same file. */
function localInitializer(checker: ts.TypeChecker, name: ts.Identifier): ts.Expression | undefined {
  const symbol = checker.getSymbolAtLocation(name);
  const declaration = symbol?.valueDeclaration;
  if (
    declaration !== undefined &&
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer !== undefined &&
    declaration.getSourceFile() === name.getSourceFile() &&
    ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0
  ) {
    return declaration.initializer;
  }
  return undefined;
}

/** Does an element draw a Button through `render={<Button …/>}` (a dialog's Close)? */
function rendersButton(opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement): boolean {
  const render = attribute(opening, 'render');
  return (
    render !== undefined &&
    (ts.isJsxSelfClosingElement(render) || ts.isJsxElement(render)) &&
    BUTTONS.has(tagName(ts.isJsxElement(render) ? render.openingElement : render))
  );
}

/** Is a node inside the `render` attribute of another element? */
function inRender(node: ts.Node): boolean {
  const up = node.parent;
  return (
    up !== undefined &&
    ts.isJsxExpression(up) &&
    up.parent !== undefined &&
    ts.isJsxAttribute(up.parent) &&
    up.parent.name.getText() === 'render'
  );
}

/** The label of a button: an attribute, or the `t(...)` of its children. */
function buttonLabel(
  checker: ts.TypeChecker,
  element: ts.JsxElement | ts.JsxSelfClosingElement,
): Label {
  const opening = ts.isJsxElement(element) ? element.openingElement : element;
  for (const name of LABEL_ATTRIBUTES) {
    const label = labelOf(checker, attribute(opening, name));
    if (label !== null) return label;
  }
  // A trigger drawn as `render={<Button aria-label={t('…')} />}`: the Button's own label.
  const render = attribute(opening, 'render');
  if (render !== undefined && (ts.isJsxSelfClosingElement(render) || ts.isJsxElement(render))) {
    const inner = buttonLabel(checker, render);
    if (inner !== null && 'keys' in inner) return inner;
  }
  if (!ts.isJsxElement(element)) return null;
  let label: Label = null;
  const visit = (node: ts.Node): void => {
    if (label !== null && 'keys' in label) return;
    if (ts.isJsxExpression(node) && node.expression !== undefined) {
      const found = labelOf(checker, node.expression);
      if (found !== null && (label === null || 'keys' in found)) label = found;
      return;
    }
    if (ts.isJsxText(node) && node.text.trim() !== '') {
      label = { dynamic: true };
      return;
    }
    ts.forEachChild(node, visit);
  };
  element.children.forEach(visit);
  return label;
}

/** The `permits(…, 'area', 'action')` or `useMayView('area', 'action')` in an expression. */
function permitsIn(expression: ts.Node): Array<{ area: string; action: string }> {
  const out: Array<{ area: string; action: string }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      const literal = (index: number): string | undefined => {
        const argument = node.arguments[index];
        return argument !== undefined && ts.isStringLiteral(argument) ? argument.text : undefined;
      };
      if (name === 'permits') {
        const area = literal(2);
        const action = literal(3);
        if (area !== undefined && action !== undefined) out.push({ area, action });
      }
      if (name === 'useMayView') {
        const area = literal(0);
        if (area !== undefined) out.push({ area, action: literal(1) ?? 'view' });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return out;
}

/** The names a condition tests as true: `a`, `a && b`, `(a)`. */
function namesOfCondition(expression: ts.Expression): string[] {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isParenthesizedExpression(expression)) return namesOfCondition(expression.expression);
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return [...namesOfCondition(expression.left), ...namesOfCondition(expression.right)];
  }
  return [];
}

/** The permission guards of the conditions around a node, up to its component. */
function guardsAround(
  node: ts.Node,
  guards: ReadonlyMap<string, Array<{ area: string; action: string }>>,
): Array<{ area: string; action: string }> {
  const out: Array<{ area: string; action: string }> = [];
  let child: ts.Node = node;
  let up: ts.Node | undefined = node.parent;
  while (up !== undefined && !ts.isSourceFile(up)) {
    let condition: ts.Expression | undefined;
    if (
      ts.isBinaryExpression(up) &&
      up.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      up.right === child
    ) {
      condition = up.left;
    }
    if (ts.isConditionalExpression(up) && up.whenTrue === child) condition = up.condition;
    if (condition !== undefined) {
      out.push(...permitsIn(condition));
      for (const name of namesOfCondition(condition)) out.push(...(guards.get(name) ?? []));
    }
    child = up;
    up = up.parent;
  }
  return out;
}

function isPanelFile(file: string): boolean {
  return /-(panel|dialog)\.tsx$/.test(file);
}

/** The controls of one file. */
function controlsOf(
  checker: ts.TypeChecker,
  source: ts.SourceFile,
  file: string,
  problems: WalkProblem[],
): WalkedControl[] {
  const out: WalkedControl[] = [];
  const counts = new Map<string, number>();
  const guards = new Map<string, Array<{ area: string; action: string }>>();
  const collectGuards = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const found = permitsIn(node.initializer);
      if (found.length === 1) guards.set(node.name.text, found);
    }
    ts.forEachChild(node, collectGuards);
  };
  collectGuards(source);

  const filePanel = isPanelFile(file) ? `${file}#panel` : null;
  const panelOf = new Map<ts.Node, string>();
  const idOf = (kind: string, key: string): string => {
    const base = `${file}#${kind}:${key}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base}:${String(count)}`;
  };
  const parentOf = (node: ts.Node): string | null => {
    let up: ts.Node | undefined = node.parent;
    while (up !== undefined) {
      const panel = panelOf.get(up);
      if (panel !== undefined) return panel;
      up = up.parent;
    }
    return filePanel;
  };
  const push = (
    node: ts.Node,
    kind: WalkedControl['kind'],
    label: Label,
    what: string,
  ): string | undefined => {
    if (label === null || 'dynamic' in label) {
      problems.push({
        file,
        line: lineOf(node),
        problem:
          label === null
            ? `${what} has no label the walk can read`
            : `${what} has a label the walk cannot read (not a literal key)`,
      });
      return undefined;
    }
    const id = idOf(kind, label.keys[0] ?? '');
    out.push({
      id,
      kind,
      file,
      keys: label.keys,
      parent: parentOf(node),
      shownWith: guardsAround(node, guards),
      line: lineOf(node),
    });
    return id;
  };

  if (filePanel !== null) {
    out.push({
      id: filePanel,
      kind: 'panel',
      file,
      keys: [],
      parent: null,
      shownWith: [],
      line: 1,
    });
  }

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const name = tagName(opening);
      if (DIALOGS.has(name) || name === 'SidePanel') {
        let label: Label = labelOf(checker, attribute(opening, 'title'));
        if (label === null && ts.isJsxElement(node)) {
          const findTitle = (inner: ts.Node): void => {
            if (label !== null) return;
            if (ts.isJsxElement(inner) && DIALOG_TITLES.has(tagName(inner.openingElement))) {
              label = buttonLabel(checker, inner);
              return;
            }
            ts.forEachChild(inner, findTitle);
          };
          node.children.forEach(findTitle);
        }
        // A record panel's title is the record's name: the panel is named by its file.
        if (name === 'SidePanel' && filePanel !== null) {
          panelOf.set(node, filePanel);
        } else if (label !== null && 'keys' in label) {
          const id = push(node, 'panel', label, `The ${name}`);
          if (id !== undefined) panelOf.set(node, id);
        } else if (name !== 'SidePanel') {
          push(node, 'panel', label, `The ${name}`);
        }
      } else if (BUTTONS.has(name) && inRender(node)) {
        // Drawn by the element that renders it: that element is the control.
      } else if (BUTTONS.has(name) || rendersButton(opening)) {
        push(node, 'button', buttonLabel(checker, node), `The ${name}`);
      } else if (FIELDS.has(name)) {
        push(
          node,
          'field',
          labelOf(checker, attribute(opening, 'label') ?? attribute(opening, 'legend')),
          `The ${name}`,
        );
      } else if (TABS.has(name)) {
        push(node, 'tab', labelOf(checker, attribute(opening, 'label')), `The ${name}`);
      }
    }
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      if (
        (name === 'header' || name === 'headerName') &&
        ts.isObjectLiteralExpression(node.parent)
      ) {
        // A column of a list (`key` and `cell`) or of the journal's grid (`field`, `colId`).
        const siblings = new Set(
          node.parent.properties.map((property) => property.name?.getText() ?? ''),
        );
        const isColumn =
          (siblings.has('key') && siblings.has('cell')) ||
          siblings.has('field') ||
          siblings.has('colId');
        if (isColumn) push(node, 'column', labelOf(checker, node.initializer), 'The column');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** The API calls of a file, `api.POST('/api/…')`, as `POST /api/…`. */
function callsOf(source: ts.SourceFile): string[] {
  const out = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      METHODS.has(node.expression.name.text)
    ) {
      const first = node.arguments[0];
      if (first !== undefined && ts.isStringLiteral(first) && first.text.startsWith('/api/')) {
        out.add(`${node.expression.name.text} ${first.text}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...out].sort();
}

function searchOf(
  checker: ts.TypeChecker,
  expression: ts.Expression | undefined,
): Record<string, SearchType> {
  if (expression === undefined) return {};
  const type = checker.getTypeAtLocation(expression);
  const signature = type.getCallSignatures()[0];
  if (signature === undefined) return {};
  const returned = signature.getReturnType();
  const out: Record<string, SearchType> = {};
  for (const property of returned.getProperties()) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (declaration === undefined) continue;
    const propertyType = checker.getNonNullableType(
      checker.getTypeOfSymbolAtLocation(property, declaration),
    );
    const literals = literalsOf(propertyType);
    if (literals !== undefined) {
      out[property.name] = { kind: 'enum', values: literals };
    } else if (propertyType.flags & ts.TypeFlags.NumberLike) {
      out[property.name] = { kind: 'number' };
    } else if (propertyType.flags & ts.TypeFlags.BooleanLike) {
      out[property.name] = { kind: 'boolean' };
    } else if (propertyType.flags & ts.TypeFlags.Object) {
      // The filters of a list: `f`, a key to the chosen value.
      out[property.name] = { kind: 'record' };
    } else {
      out[property.name] = { kind: 'string' };
    }
  }
  return out;
}

const namesCache = new WeakMap<ts.SourceFile, Set<string>>();

/** The names a file uses as an element (`<Name>`) or hands on as a component (`Name`). */
function componentNamesOf(source: ts.SourceFile): Set<string> {
  const cached = namesCache.get(source);
  if (cached !== undefined) return cached;
  const out = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName)
    ) {
      out.add(node.tagName.text);
    } else if (
      ts.isIdentifier(node) &&
      /^[A-Z][a-z]/.test(node.text) &&
      !ts.isImportSpecifier(node.parent) &&
      !ts.isImportClause(node.parent)
    ) {
      out.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  namesCache.set(source, out);
  return out;
}

/** The value names an import takes. */
function importedNames(statement: ts.ImportDeclaration): string[] {
  const clause = statement.importClause;
  if (clause === undefined) return [];
  const out: string[] = [];
  if (clause.name !== undefined) out.push(clause.name.text);
  const bindings = clause.namedBindings;
  if (bindings !== undefined && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      if (!element.isTypeOnly) out.push(element.name.text);
    }
  }
  return out;
}

/** Every file a file draws: its imports inside `features/` and the shared parts, followed. */
function filesFrom(
  program: ts.Program,
  start: ts.SourceFile,
  options: WalkOptions,
  stopAt: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  const queue = [start];
  const shared = new Set(options.sharedParts);
  while (queue.length > 0) {
    const source = queue.pop();
    if (source === undefined) break;
    const file = rel(options.src, source.fileName);
    if (seen.has(file)) continue;
    seen.add(file);
    for (const statement of source.statements) {
      if (
        (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) ||
        statement.moduleSpecifier === undefined ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue;
      }
      if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly === true)
        continue;
      const resolved = ts.resolveModuleName(
        statement.moduleSpecifier.text,
        source.fileName,
        program.getCompilerOptions(),
        ts.sys,
      ).resolvedModule;
      if (resolved === undefined) continue;
      const target = rel(options.src, resolved.resolvedFileName);
      if (target.startsWith('..') || stopAt.has(target)) continue;
      if (!target.startsWith('features/') && !shared.has(target)) continue;
      const next = program.getSourceFile(resolved.resolvedFileName);
      if (next === undefined) continue;
      // A file with elements is drawn only when a component taken from it is used here: a
      // helper function taken from a component's file does not draw that file's controls.
      if (
        ts.isImportDeclaration(statement) &&
        next.fileName.endsWith('.tsx') &&
        !importedNames(statement).some((name) => componentNamesOf(source).has(name))
      ) {
        continue;
      }
      queue.push(next);
    }
  }
  return [...seen].sort();
}

/** The file of the page component a router function draws (not a refusal page). */
function drawnBy(
  checker: ts.TypeChecker,
  body: ts.Node,
  router: ts.SourceFile,
): ts.SourceFile | undefined {
  let found: ts.SourceFile | undefined;
  const find = (child: ts.Node): void => {
    if (found !== undefined) return;
    if (
      (ts.isJsxSelfClosingElement(child) || ts.isJsxOpeningElement(child)) &&
      ts.isIdentifier(child.tagName) &&
      !/^(NotFoundPage|NoAccessPage)$/.test(child.tagName.text)
    ) {
      const file = declarationFile(checker, child.tagName);
      if (file !== undefined && file !== router) found = file;
    }
    ts.forEachChild(child, find);
  };
  find(body);
  return found;
}

/** The walk of the app. */
export function walkApp(options: WalkOptions): Walk {
  const program = programOf(options);
  const checker = program.getTypeChecker();
  const problems: WalkProblem[] = [];
  const routerPath = path.join(options.src, options.router);
  const router = program.getSourceFile(routerPath);
  if (router === undefined) throw new Error(`No router at ${routerPath}`);

  const pages: WalkedPage[] = [];
  let layoutFile: ts.SourceFile | undefined;
  const pageStarts: Array<{ page: Omit<WalkedPage, 'files' | 'titleKey'>; source: ts.SourceFile }> =
    [];
  const visitRouter = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'createRoute'
    ) {
      const object = node.initializer.arguments[0];
      if (object === undefined || !ts.isObjectLiteralExpression(object)) return;
      const property = (name: string): ts.Expression | undefined => {
        for (const item of object.properties) {
          if (ts.isPropertyAssignment(item) && item.name.getText() === name)
            return item.initializer;
        }
        return undefined;
      };
      const component = property('component');
      if (node.name.text === options.layoutRoute) {
        if (component !== undefined && ts.isIdentifier(component)) {
          layoutFile = declarationFile(checker, component);
        }
        return;
      }
      const parent = property('getParentRoute');
      const parentName =
        parent !== undefined && ts.isArrowFunction(parent) && ts.isIdentifier(parent.body)
          ? parent.body.text
          : undefined;
      if (parentName !== options.layoutRoute) return;
      const pathNode = property('path');
      if (pathNode === undefined || !ts.isStringLiteral(pathNode)) {
        problems.push({
          file: options.router,
          line: lineOf(node),
          problem: 'A route with no literal path',
        });
        return;
      }
      let guard: WalkedPage['guard'] = null;
      let pageNode: ts.Expression | undefined = component;
      if (
        component !== undefined &&
        ts.isCallExpression(component) &&
        ts.isIdentifier(component.expression) &&
        component.expression.text === 'guarded'
      ) {
        const [area, page, action] = component.arguments;
        if (area !== undefined && ts.isStringLiteral(area)) {
          guard = {
            area: area.text,
            action: action !== undefined && ts.isStringLiteral(action) ? action.text : 'view',
          };
        }
        pageNode = page;
      }
      let source: ts.SourceFile | undefined;
      if (pageNode !== undefined && ts.isIdentifier(pageNode)) {
        source = declarationFile(checker, pageNode);
        // A page drawn by a function of the router: the component that function draws.
        if (source === router) {
          let symbol = checker.getSymbolAtLocation(pageNode);
          if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) {
            symbol = checker.getAliasedSymbol(symbol);
          }
          const body = symbol?.declarations?.[0];
          source = body === undefined ? undefined : drawnBy(checker, body, router);
        }
      } else if (pageNode !== undefined && ts.isFunctionExpression(pageNode)) {
        // A page drawn by a function of the router: the component it draws.
        let inner: ts.Identifier | undefined;
        const find = (child: ts.Node): void => {
          if (inner !== undefined) return;
          if (ts.isJsxSelfClosingElement(child) && ts.isIdentifier(child.tagName))
            inner = child.tagName;
          ts.forEachChild(child, find);
        };
        find(pageNode);
        if (inner !== undefined) source = drawnBy(checker, pageNode, router);
      }
      if (source === undefined) {
        problems.push({
          file: options.router,
          line: lineOf(node),
          problem: `The page of ${pathNode.text} cannot be read`,
        });
        return;
      }
      const params = [...pathNode.text.matchAll(/\$([A-Za-z]+)/g)].map((match) => match[1] ?? '');
      pageStarts.push({
        page: {
          path: pathNode.text,
          file: rel(options.src, source.fileName),
          guard,
          params,
          search: searchOf(checker, property('validateSearch')),
        },
        source,
      });
      return;
    }
    ts.forEachChild(node, visitRouter);
  };
  visitRouter(router);

  // The shell's own files are walked once, not as part of each page (they draw the page).
  const shellFiles =
    layoutFile === undefined ? [] : filesFrom(program, layoutFile, options, new Set());
  const pageFiles = new Set(pageStarts.map((start) => start.page.file));
  const shellOnly = new Set(shellFiles.filter((file) => !pageFiles.has(file)));
  for (const { page, source } of pageStarts) {
    const files = filesFrom(
      program,
      source,
      options,
      new Set([...shellOnly].filter((file) => file !== page.file)),
    );
    let titleKey: string | null = null;
    const findTitle = (node: ts.Node): void => {
      if (titleKey !== null) return;
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        tagName(node) === 'PageHeader'
      ) {
        const label = labelOf(checker, attribute(node, 'title'));
        if (label !== null && 'keys' in label) titleKey = label.keys[0] ?? null;
      }
      ts.forEachChild(node, findTitle);
    };
    findTitle(source);
    pages.push({ ...page, titleKey, files });
  }

  const allFiles = new Set<string>([...shellFiles, ...pages.flatMap((page) => page.files)]);
  const controls: WalkedControl[] = [];
  const calls: Record<string, string[]> = {};
  for (const file of [...allFiles].sort()) {
    const source = program.getSourceFile(path.join(options.src, file));
    if (source === undefined) continue;
    controls.push(...controlsOf(checker, source, file, problems));
    const made = callsOf(source);
    if (made.length > 0) calls[file] = made;
  }

  // Every file of `components/` with a control: a shared part, or named as a primitive.
  const componentFilesWithControls: string[] = [];
  for (const source of program.getSourceFiles()) {
    const file = rel(options.src, source.fileName);
    if (!file.startsWith('components/') || /\.test\.tsx?$/.test(file)) continue;
    const found = controlsOf(checker, source, file, []);
    if (found.some((control) => control.kind !== 'panel' || control.keys.length > 0)) {
      componentFilesWithControls.push(file);
    }
  }

  return {
    pages: pages.sort((a, b) => a.path.localeCompare(b.path)),
    shellFiles,
    controls,
    calls,
    componentFilesWithControls: componentFilesWithControls.sort(),
    problems,
  };
}
