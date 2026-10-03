/** The answer of `GET /api/health`. */
export interface HealthResponse {
  status: 'ok';
}

/**
 * Reads an answer of the health route. Returns null for anything that is not the
 * expected shape, for example an error page from a proxy while the API is down.
 * Task 0.4 replaces this with the shared validation schemas and the generated client.
 */
export function parseHealthResponse(value: unknown): HealthResponse | null {
  if (typeof value !== 'object' || value === null) return null;
  if (!('status' in value) || value.status !== 'ok') return null;
  return { status: 'ok' };
}
