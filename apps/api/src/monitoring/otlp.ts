/**
 * The numbers pushed to Grafana Cloud (task 10.2a, plan decision 8), as OpenTelemetry metrics in
 * OTLP's JSON (`POST <otlp gateway>/otlp/v1/metrics`). New Grafana Cloud stacks take OTLP and no
 * longer the Influx line protocol (the first backup of 30 October 2026 was answered 530). Each
 * field of a point is a gauge named `<measurement>_<field>`, with the tags as the attributes of
 * its data point, so Grafana stores the same series and labels as before (`series.ts`). Every
 * value is a whole number: the numbers of a minute, counts and moments in seconds.
 */

export interface Point {
  measurement: string;
  tags: Readonly<Record<string, string>>;
  fields: Readonly<Record<string, number>>;
  /** Milliseconds since 1970, from the injected clock. */
  at: number;
}

const NAME = /^[a-z][a-z0-9_]*$/;

interface DataPoint {
  asInt: string;
  timeUnixNano: string;
  attributes: { key: string; value: { stringValue: string } }[];
}

/**
 * The JSON body of one push. The data points of one name are one gauge; the attributes in the
 * order of their keys, an empty tag left out. Times and values are strings, as OTLP's JSON
 * writes 64-bit numbers.
 */
export function metricsBody(points: readonly Point[]): string {
  const gauges = new Map<string, DataPoint[]>();
  for (const point of points) {
    if (!NAME.test(point.measurement)) {
      throw new Error(`Not a measurement name: ${point.measurement}`);
    }
    const fields = Object.entries(point.fields);
    if (fields.length === 0) {
      throw new Error('A point needs a field.');
    }
    const attributes = Object.entries(point.tags)
      .filter(([, value]) => value !== '')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => ({ key, value: { stringValue: value } }));
    for (const [field, value] of fields) {
      if (!NAME.test(field) || !Number.isSafeInteger(value)) {
        throw new Error(`Not a whole-number field: ${field}`);
      }
      const name = `${point.measurement}_${field}`;
      const dataPoints = gauges.get(name) ?? [];
      dataPoints.push({
        asInt: String(value),
        timeUnixNano: `${String(point.at)}000000`,
        attributes,
      });
      gauges.set(name, dataPoints);
    }
  }
  return JSON.stringify({
    resourceMetrics: [
      {
        resource: { attributes: [] },
        scopeMetrics: [
          {
            scope: { name: 'sodiq' },
            metrics: [...gauges].map(([name, dataPoints]) => ({ name, gauge: { dataPoints } })),
          },
        ],
      },
    ],
  });
}
