// Stands in for a root script whose substance is built by a later task.
// Usage: node scripts/not-built-yet.mjs <script name> <task id>
const [script, task] = process.argv.slice(2);

console.error(
  `"pnpm ${script}" is not built yet. It arrives in task ${task} (see docs/build-plan.md).`,
);
process.exit(1);
