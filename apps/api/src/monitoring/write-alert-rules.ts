import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { alertRulesYaml } from './alert-rules.js';

// `pnpm --filter @sodiq/api monitoring:rules` (task 10.2a): writes the rule file that the owner
// imports into Grafana from `alert-rules.ts`; `alert-rules.test.ts` fails while they differ.
const target = path.resolve(import.meta.dirname, '../../../../monitoring/grafana/alert-rules.yaml');
writeFileSync(target, alertRulesYaml());
console.log(`Written: ${path.relative(process.cwd(), target)}`);
