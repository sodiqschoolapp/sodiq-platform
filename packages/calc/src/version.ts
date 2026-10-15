/**
 * The version of the calculation module (docs/spec/edge-cases/calculation.md, "A bug is found
 * after results were closed and exported": "The calculation module has a version, stored with
 * every final result"; docs/spec/edge-cases/developer-rules.md, Calculation). A whole number,
 * raised by one with every change of the module's source outside tests, a refactor included
 * (task 4.3, decision 11): a needless raise costs a "recalculate and compare" that finds nothing,
 * a missed one could hide a changed result. `version.test.ts` pins the source of each version.
 */
export const CALC_VERSION = 1;
