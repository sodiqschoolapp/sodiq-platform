// Runs Gradle for the solver: the wrapper (./gradlew, the version and checksum
// of gradle/wrapper/gradle-wrapper.properties), or a `gradle` on the PATH of
// that same version, which needs no download (the cloud session has one in
// /opt/gradle and may not reach downloads.gradle.org). Java 21 is needed
// (Timefold Solver 2): Gradle finds it as the running Java or through
// JAVA_HOME_21_X64 (gradle.properties).
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wrapper = readFileSync(join(root, 'gradle/wrapper/gradle-wrapper.properties'), 'utf8');
const version = /gradle-([\d.]+)-bin\.zip/.exec(wrapper)?.[1];

function installedGradle() {
  try {
    const out = execFileSync('gradle', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.includes(`Gradle ${version}\n`) ? 'gradle' : null;
  } catch {
    return null;
  }
}

const gradle = installedGradle() ?? join(root, 'gradlew');
const result = spawnSync(gradle, ['--quiet', '--console=plain', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
});
if (result.status !== 0) {
  console.error(
    `Gradle failed in apps/solver (${gradle}). The solver needs Java 21 (Timefold Solver 2): ` +
      'the running Java or JAVA_HOME_21_X64.',
  );
}
process.exit(result.status ?? 1);
