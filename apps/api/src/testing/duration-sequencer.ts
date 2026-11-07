import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * The CI parts of the API tests by time, not by count (owner, 7 November 2026: "speed
 * up CI without lowering quality"). Vitest's own `--shard` cuts the files into parts of
 * the same number of files, so one part could hold the slowest files and finish minutes
 * after the others. Here every file goes, slowest first, to the least loaded worker of all
 * the parts (`--shard` count × `maxWorkers`), using the seconds each file took in CI
 * (`test-durations.json`; a file not listed counts as the median). Every part reads the
 * same list in the same order, so each file runs in exactly one part. Inside a part the
 * slowest files start first, so a long file never starts last.
 *
 * Nothing about what runs changes: the same files, the same tests, the same database.
 */

/** Seconds per test file in CI, keyed by the path from the package root (`src/...`). */
export type Durations = Readonly<Record<string, number>>;

/** The part (0-based) of each file: slowest first, onto the least loaded worker. */
export function partsOf(
  files: readonly string[],
  durations: Durations,
  parts: number,
  workersPerPart: number,
): Map<string, number> {
  const known = Object.values(durations).sort((a, b) => a - b);
  const median = known.length === 0 ? 1 : (known[Math.floor(known.length / 2)] ?? 1);
  const timeOf = (file: string) => durations[file] ?? median;
  const ordered = [...files].sort((a, b) => timeOf(b) - timeOf(a) || (a < b ? -1 : a > b ? 1 : 0));
  const load = Array.from({ length: parts * workersPerPart }, () => 0);
  const partLoad = Array.from({ length: parts }, () => 0);
  const partOf = new Map<string, number>();
  const partOfSlot = (slot: number) => Math.floor(slot / workersPerPart);
  for (const file of ordered) {
    // The least loaded worker; on a tie, the one of the least loaded part.
    let slot = 0;
    for (let at = 1; at < load.length; at += 1) {
      const [mine, best] = [load[at] ?? 0, load[slot] ?? 0];
      if (
        mine < best ||
        (mine === best && (partLoad[partOfSlot(at)] ?? 0) < (partLoad[partOfSlot(slot)] ?? 0))
      ) {
        slot = at;
      }
    }
    load[slot] = (load[slot] ?? 0) + timeOf(file);
    const part = partOfSlot(slot);
    partLoad[part] = (partLoad[part] ?? 0) + timeOf(file);
    partOf.set(file, part);
  }
  return partOf;
}

function readDurations(root: string): Durations {
  try {
    return JSON.parse(readFileSync(resolve(root, 'test-durations.json'), 'utf8')) as Durations;
  } catch {
    // No list: every file counts the same, which still gives parts of equal size.
    return {};
  }
}

export default class DurationSequencer extends BaseSequencer {
  private durations: Durations | null = null;

  private known(): Durations {
    this.durations ??= readDurations(this.ctx.config.root);
    return this.durations;
  }

  private pathOf(spec: TestSpecification): string {
    return relative(this.ctx.config.root, spec.moduleId).split('\\').join('/');
  }

  override shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { shard, maxWorkers } = this.ctx.config;
    if (shard === undefined) return Promise.resolve(files);
    const parts = partsOf(
      files.map((spec) => this.pathOf(spec)),
      this.known(),
      shard.count,
      Math.max(1, maxWorkers),
    );
    return Promise.resolve(
      files.filter((spec) => parts.get(this.pathOf(spec)) === shard.index - 1),
    );
  }

  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const durations = this.known();
    const sorted = await super.sort(files);
    // Slowest first, as known; the base order for the rest.
    return [...sorted].sort(
      (a, b) => (durations[this.pathOf(b)] ?? 0) - (durations[this.pathOf(a)] ?? 0),
    );
  }
}
