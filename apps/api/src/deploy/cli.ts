import { deployServices, DeployError } from './render.js';
import { smokeTest, SmokeError } from './smoke.js';

// Command line of the deploy job (.github/workflows/ci.yml, task 0.10):
//
//   node dist/deploy/cli.js deploy --commit <sha> <serviceId> [<serviceId> ...]
//     RENDER_API_KEY in the environment. Starts the deploys and waits.
//   node dist/deploy/cli.js smoke <url>
//     The checks against the address of the environment.
//
// Compiled with the API; the services never run it.

const [command, ...rest] = process.argv.slice(2);

function usage(): never {
  console.error(
    'Usage: node dist/deploy/cli.js deploy --commit <sha> <serviceId>... | smoke <url>',
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
  } else {
    usage();
  }
} catch (error) {
  const known = error instanceof DeployError || error instanceof SmokeError;
  console.error(
    known ? error.message : `Failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
