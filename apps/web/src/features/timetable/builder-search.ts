/** The steps of the builder that open a panel (task 5.3a): 1 to 4. */
export const BUILDER_STEPS = ['templates', 'load', 'teachers', 'rooms'] as const;

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
