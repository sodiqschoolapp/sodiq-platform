// Formats the file that Claude Code has just written or edited, so that the
// Prettier check of `pnpm lint` and of CI never fails on a file a session
// forgot to format (two commits of task 1.1 were only that).
//
// Registered in .claude/settings.json as a PostToolUse hook of Edit, Write and
// MultiEdit. The hook's JSON arrives on stdin and names the file in
// `tool_input.file_path`. When the file is inside the repository and Prettier
// knows its type, `pnpm exec prettier --write --ignore-unknown --log-level
// warn <file>` runs from the repository root; `.prettierignore` still applies,
// so the docs, the spec and the Claude Code pack are never touched.
//
// A hook must never block the tool: every error is swallowed and the exit
// code is always 0.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The types Prettier formats in this repository; `--ignore-unknown` covers the rest. */
const KNOWN_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.json',
  '.jsonc',
  '.json5',
  '.css',
  '.scss',
  '.less',
  '.html',
  '.yaml',
  '.yml',
  '.md',
  '.graphql',
]);

/** The repository root: this file is scripts/hooks/<name>.mjs. */
const root = path.resolve(import.meta.dirname, '..', '..');

/** The file the tool wrote, or null when the input does not name one. */
function writtenFile(input) {
  const parsed = JSON.parse(input);
  const file =
    typeof parsed === 'object' && parsed !== null && typeof parsed.tool_input === 'object'
      ? parsed.tool_input?.file_path
      : undefined;
  return typeof file === 'string' && file.length > 0 ? path.resolve(root, file) : null;
}

function insideRepository(file) {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

try {
  const file = writtenFile(readFileSync(0, 'utf8'));
  if (
    file !== null &&
    insideRepository(file) &&
    KNOWN_EXTENSIONS.has(path.extname(file).toLowerCase())
  ) {
    // On Windows pnpm is pnpm.cmd, which Node runs only through the shell;
    // the shell gets the path quoted.
    const windows = process.platform === 'win32';
    spawnSync(
      'pnpm',
      [
        'exec',
        'prettier',
        '--write',
        '--ignore-unknown',
        '--log-level',
        'warn',
        windows ? `"${file}"` : file,
      ],
      { cwd: root, stdio: 'ignore', shell: windows, timeout: 25_000 },
    );
  }
} catch {
  // A hook never blocks the tool.
}
process.exit(0);
