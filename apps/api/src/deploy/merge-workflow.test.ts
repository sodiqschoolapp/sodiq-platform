import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The Merge reviewed workflow (owner, 6 November 2026): it merges with the owner's token, so its
// shape is pinned here. The repository is public and the workflow runs on comments.
const root = path.resolve(import.meta.dirname, '../../../..');
const workflow = readFileSync(path.join(root, '.github/workflows/merge-reviewed.yml'), 'utf8');

describe('the Merge reviewed workflow', () => {
  it('runs only on a new comment, for a pull request, by abbosc, that starts with ready to merge', () => {
    const triggers = workflow.slice(
      workflow.indexOf('\non:\n'),
      workflow.indexOf('\npermissions:'),
    );
    expect(triggers).toBe('\non:\n  issue_comment:\n    types: [created]\n');
    expect(workflow).toContain(
      "    if: >-\n      github.event.issue.pull_request\n      && github.event.comment.user.login == 'abbosc'\n      && startsWith(github.event.comment.body, '[review] ready to merge at ')\n",
    );
  });

  it("runs main's code with no stored credentials, and passes no text of the comment to a shell", () => {
    expect(workflow).toContain(
      '        with:\n          ref: main\n          persist-credentials: false\n',
    );
    // Only the number and the id; never the body, the title or a branch name.
    const expressions = [...workflow.matchAll(/\$\{\{ ([^}]+) \}\}/g)].map((found) => found[1]);
    expect(expressions.sort()).toEqual(
      [
        'github.event.comment.id',
        'github.event.issue.number',
        'github.event.issue.number',
        'github.token',
        'secrets.MERGE_TOKEN',
      ].sort(),
    );
    expect(workflow).toContain(
      'run: node apps/api/dist/deploy/cli.js merge-reviewed "$PULL_NUMBER" "$COMMENT_ID"',
    );
  });

  it('asks for no write right but the notice and the label, and names one secret', () => {
    expect(workflow).toContain('\npermissions: {}\n');
    expect(workflow).toContain(
      '    permissions:\n      contents: read\n      checks: read\n      issues: write\n      pull-requests: write\n',
    );
    expect([...new Set(workflow.match(/secrets\.[A-Z0-9_]+/g) ?? [])]).toEqual([
      'secrets.MERGE_TOKEN',
    ]);
  });

  it('pins every action by its commit', () => {
    const uses = workflow.match(/uses: \S+/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    for (const one of uses) expect(one).toMatch(/@[0-9a-f]{40}$/);
  });
});
