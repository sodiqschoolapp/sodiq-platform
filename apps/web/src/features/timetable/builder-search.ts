/** The steps of the builder that open a panel (tasks 5.3a and 5.3b-1): 1 to 5, and 7, the grid (task 5.4a). */
export const BUILDER_STEPS = ['templates', 'load', 'teachers', 'rooms', 'rules', 'grid'] as const;

/** The steps whose readiness the server reads (`draftReadinessSchema`); the grid's comes with its conflict panel (5.4b, decision 13). */
export const READINESS_STEPS = ['templates', 'load', 'teachers', 'rooms', 'rules'] as const;

export type BuilderStep = (typeof BUILDER_STEPS)[number];

/** The address of the draft builder: the version and the step shown. */
export interface BuilderSearch {
  version?: string;
  step?: BuilderStep;
}

/** `validateSearch` of the builder page. */
export function builderSearch(search: Record<string, unknown>): BuilderSearch {
  const result: BuilderSearch = {};
  if (typeof search.version === 'string' && search.version !== '') {
    result.version = search.version;
  }
  const step = BUILDER_STEPS.find((one) => one === search.step);
  if (step !== undefined) {
    result.step = step;
  }
  return result;
}
