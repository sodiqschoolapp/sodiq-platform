/**
 * Every series the API, the worker and the backup workflow push to Grafana
 * (task 10.2a), by the name Grafana stores: `<measurement>_<field>`, the name of
 * each gauge (`otlp.ts`). `monitoring/grafana/alert-rules.yaml` reads only
 * these; `alert-rules.test.ts` keeps the two lists together.
 */
export const MEASUREMENTS = {
  /** Answered requests of one minute: `method`, `route`, `status` (2xx…5xx), `branch`. */
  requests: { name: 'sodiq_requests', fields: ['count', 'ms_sum'] },
  /** The same requests per upper bound in seconds (`le`, `+Inf` included), not cumulative over minutes. */
  requestDuration: { name: 'sodiq_request_duration', fields: ['bucket'] },
  /** One a minute from each process (`service`: api or worker). */
  process: { name: 'sodiq_process', fields: ['up'] },
  /** What the database knows per branch, every minute (`counts.job.ts`). */
  branch: {
    name: 'sodiq_branch',
    fields: [
      'refused_saves',
      'failed_exports',
      'check_finished',
      'check_differences',
      'daily_enqueued',
      'first_slot_lessons',
      'first_slot_marked',
      'first_slot_baseline_lessons',
      'first_slot_baseline_marked',
    ],
  },
  /** Failed jobs of the last hour per job `name` and `branch` (`none` for a job of no branch). */
  jobs: { name: 'sodiq_jobs', fields: ['failed'] },
  /** One a minute from the counts job itself: the counts are arriving. */
  counts: { name: 'sodiq_counts', fields: ['pushed'] },
  /** The moment, in seconds, of the last daily export that was proved and stored (`backup.yml`). */
  backup: { name: 'sodiq_backup', fields: ['last_success'] },
} as const;

/** The stored names of every series. */
export const SERIES: readonly string[] = Object.values(MEASUREMENTS).flatMap((measurement) =>
  measurement.fields.map((field) => `${measurement.name}_${field}`),
);

/** The upper bounds of the request durations, in seconds (`12`, Speed targets). */
export const DURATION_BOUNDS = [0.1, 0.2, 0.3, 0.5, 1, 2, 5] as const;
