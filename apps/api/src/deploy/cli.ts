import { SystemClock } from '../clock/system-clock.js';
import { ChromiumPdfRenderer } from '../http/pdf.js';
import { pdfCheck, PdfCheckError } from './pdf-check.js';
import { checkRelease, ReleaseCheckError } from './release-check.js';
import { releaseWindowOpen, tashkentTime } from './release-window.js';
import { deployServices, DeployError } from './render.js';
import { smokeTest, SmokeError } from './smoke.js';

// Command line of the deploy jobs (.github/workflows/ci.yml, task 0.10;
// .github/workflows/deploy-production.yml, task 10.4):
//
//   node dist/deploy/cli.js deploy --commit <sha> <serviceId> [<serviceId> ...]
//     RENDER_API_KEY in the environment. Starts the deploys and waits.
//   node dist/deploy/cli.js smoke <url>
//     The checks against the address of the environment.
//   node dist/deploy/cli.js window
//     Fails outside the release window of production (release-window.ts).
//   node dist/deploy/cli.js release-check <sha>
//     GITHUB_TOKEN and GITHUB_REPOSITORY in the environment. Fails unless the
//     commit passed checks, e2e and deploy-test on main (release-check.ts).
//   node dist/deploy/cli.js pdf-check
//     Makes one PDF with the Chromium of this machine (pdf-check.ts); the job
//     `image` runs it inside the production image.
//
// Compiled with the API; the services never run it.

const [command, ...rest] = process.argv.slice(2);

function usage(): never {
  console.error(
    'Usage: node dist/deploy/cli.js deploy --commit <sha> <serviceId>... | smoke <url> | window | release-check <sha> | pdf-check',
  );
  process.exit(2);
}

try {
  if (command === 'deploy') {
    const commitIndex = rest.indexOf('--commit');
    const commitId = commitIndex === -1 ? undefined : rest[commitIndex + 1];
    const serviceIds = rest.filter(
      (_, index) => index !== commitIndex && index !== commitIndex + 1,
    );
    const apiKey = process.env.RENDER_API_KEY;
    if (commitId === undefined || serviceIds.length === 0) {
      usage();
    }
    if (apiKey === undefined || apiKey === '') {
      console.error('RENDER_API_KEY is not set.');
      process.exit(2);
    }
    const results = await deployServices({
      apiKey,
      serviceIds,
      commitId,
      log: (line) => {
        console.log(line);
      },
    });
    console.log(`Live: ${results.map((result) => result.serviceId).join(', ')} at ${commitId}.`);
  } else if (command === 'smoke') {
    const [url] = rest;
    if (url === undefined) {
      usage();
    }
    const results = await smokeTest(url);
    for (const result of results) {
      console.log(`ok: ${result.name}`);
    }
  } else if (command === 'window') {
    // The moment the owner's run starts, from the server's clock.
    const now = new SystemClock().now();
    if (!releaseWindowOpen(now)) {
      console.error(
        `It is ${tashkentTime(now)} in Tashkent: production is deployed only from 18:00 to 06:00 and at the weekend (docs/deploy.md, Production).`,
      );
      process.exit(1);
    }
    console.log(`Release window open: ${tashkentTime(now)} in Tashkent.`);
  } else if (command === 'release-check') {
    const [commitId] = rest;
    const token = process.env.GITHUB_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY;
    if (commitId === undefined) {
      usage();
    }
    if (token === undefined || token === '' || repository === undefined || repository === '') {
      console.error('GITHUB_TOKEN and GITHUB_REPOSITORY must be set.');
      process.exit(2);
    }
    const runId = await checkRelease({ token, repository, commitId });
    console.log(`${commitId} passed checks, e2e and deploy-test in CI run ${String(runId)}.`);
  } else if (command === 'pdf-check') {
    const renderer = new ChromiumPdfRenderer({
      chromiumPath: process.env.CHROMIUM_PATH || undefined,
    });
    try {
      const bytes = await pdfCheck(renderer);
      console.log(`A PDF of ${String(bytes)} bytes was made.`);
    } finally {
      await renderer.onModuleDestroy();
    }
  } else {
    usage();
  }
} catch (error) {
  const known =
    error instanceof DeployError ||
    error instanceof SmokeError ||
    error instanceof ReleaseCheckError ||
    error instanceof PdfCheckError;
  console.error(
    known ? error.message : `Failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
