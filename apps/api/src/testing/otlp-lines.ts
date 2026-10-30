import { MEASUREMENTS } from '../monitoring/series.js';

/** The measurement names, longest first, so that `sodiq_request_duration` wins over a prefix. */
const NAMES = Object.values(MEASUREMENTS)
  .map((measurement) => measurement.name as string)
  .sort((a, b) => b.length - a.length);

interface Body {
  resourceMetrics: {
    scopeMetrics: {
      metrics: {
        name: string;
        gauge: {
          dataPoints: {
            asInt: string;
            timeUnixNano: string;
            attributes: { key: string; value: { stringValue: string } }[];
          }[];
        };
      }[];
    }[];
  }[];
}

/**
 * The pushed numbers of one OTLP body (`otlp.ts`) as readable lines,
 * `<measurement>,<tag>=<value>,… <field>=<n>i,… <nanoseconds>`: the data points of one
 * measurement, tags and moment joined into one line, the fields in the order they were sent.
 * For the tests only; a body that is not OTLP metrics gives no line.
 */
export function linesOfMetrics(body: string): string[] {
  let parsed: Partial<Body>;
  try {
    parsed = JSON.parse(body) as Partial<Body>;
  } catch {
    return [];
  }
  const lines = new Map<string, string[]>();
  for (const resource of parsed.resourceMetrics ?? []) {
    for (const scope of resource.scopeMetrics) {
      for (const metric of scope.metrics) {
        const measurement = NAMES.find((name) => metric.name.startsWith(`${name}_`));
        if (measurement === undefined) {
          throw new Error(`No measurement of ${metric.name}`);
        }
        const field = metric.name.slice(measurement.length + 1);
        for (const point of metric.gauge.dataPoints) {
          const tags = point.attributes
            .map((attribute) => `,${attribute.key}=${attribute.value.stringValue}`)
            .join('');
          const key = `${measurement}${tags} ${point.timeUnixNano}`;
          const fields = lines.get(key) ?? [];
          fields.push(`${field}=${point.asInt}i`);
          lines.set(key, fields);
        }
      }
    }
  }
  return [...lines].map(([key, fields]) => {
    const [head = '', moment = ''] = key.split(/ (?=\d+$)/);
    return `${head} ${fields.join(',')} ${moment}`;
  });
}
