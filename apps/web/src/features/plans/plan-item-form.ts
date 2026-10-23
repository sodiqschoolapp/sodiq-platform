import {
  PLAN_WORKS_MAX,
  planItemValuesSchema,
  type PlanItem,
  type PlanItemValues,
  type PlanWork,
} from '@sodiq/shared';
import type { FormIssue, FormSchema } from '@/components/form/form-messages';

/**
 * The form of a plan row (task 7.1a): the item's values as text fields, one
 * slot per possible work (`PLAN_WORKS_MAX` classworks and homeworks), checked
 * with `planItemValuesSchema` of `packages/shared`. A work keeps its id in
 * its slot, so renaming it keeps its identity (decision 9: works are compared
 * by id); emptying a slot removes the work.
 */

export type WorkKind = 'classwork' | 'homework';

export const WORK_KINDS: readonly WorkKind[] = ['classwork', 'homework'];

const listOf = (kind: WorkKind) => (kind === 'classwork' ? 'classworks' : 'homeworks');

export type PlanField = 'topic' | 'objectives' | 'links' | `${WorkKind}${string}`;

export const titleField = (kind: WorkKind, slot: number): PlanField => `${kind}${String(slot)}`;
export const noteField = (kind: WorkKind, slot: number): PlanField => `${kind}Note${String(slot)}`;

/** The content of an item a form shows: a plan item, or a master item (task 7.3). */
export type ItemContent = Pick<PlanItem, 'topic' | 'objectives' | 'links' | 'classworks' | 'homeworks'>;

const SLOTS = Array.from({ length: PLAN_WORKS_MAX }, (_, slot) => slot);

/** What the form opens with: the item's values, or an empty row. */
export function initialOf(item: ItemContent | null): Record<PlanField, string> {
  const typed: Record<string, string> = {
    topic: item?.topic ?? '',
    objectives: item?.objectives ?? '',
    links: (item?.links ?? []).join('\n'),
  };
  for (const kind of WORK_KINDS) {
    const works: readonly PlanWork[] = item?.[listOf(kind)] ?? [];
    for (const slot of SLOTS) {
      typed[titleField(kind, slot)] = works[slot]?.title ?? '';
      typed[noteField(kind, slot)] = works[slot]?.description ?? '';
    }
  }
  return typed;
}

/** The slots of a kind that hold a work: a title or a description typed. */
export const filledSlots = (typed: Readonly<Record<string, string>>, kind: WorkKind): number[] =>
  SLOTS.filter(
    (slot) =>
      (typed[titleField(kind, slot)] ?? '') !== '' || (typed[noteField(kind, slot)] ?? '') !== '',
  );

/**
 * The schema of the form: the typed text becomes the values of the item
 * (each work with the id its slot held), checked by `planItemValuesSchema`;
 * an issue goes back to the field it came from.
 */
export function planFormSchema(item: ItemContent | null): FormSchema<PlanItemValues> {
  return {
    safeParse: (input: unknown) => {
      const typed = input as Readonly<Record<string, string>>;
      const slotsOf: Record<WorkKind, number[]> = { classwork: [], homework: [] };
      const works = (kind: WorkKind) => {
        const stored = item?.[listOf(kind)] ?? [];
        slotsOf[kind] = filledSlots(typed, kind);
        return slotsOf[kind].map((slot) => {
          const id = stored[slot]?.id;
          return {
            ...(id === undefined ? {} : { id }),
            title: typed[titleField(kind, slot)] ?? '',
            description: typed[noteField(kind, slot)] ?? '',
          };
        });
      };
      const links = (typed.links ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
      const values = {
        topic: typed.topic ?? '',
        objectives: typed.objectives ?? '',
        links,
        classworks: works('classwork'),
        homeworks: works('homework'),
      };
      const checked = planItemValuesSchema.safeParse(values);
      if (checked.success) return { success: true, data: checked.data };
      const issues: FormIssue[] = checked.error.issues.map((issue) => {
        const [first, index, part] = issue.path;
        const kind: WorkKind | undefined =
          first === 'classworks' ? 'classwork' : first === 'homeworks' ? 'homework' : undefined;
        if (kind !== undefined && typeof index === 'number') {
          const slot = slotsOf[kind][index] ?? 0;
          return {
            ...issue,
            path: [part === 'description' ? noteField(kind, slot) : titleField(kind, slot)],
          };
        }
        return { ...issue, path: [first ?? 'topic'] };
      });
      return { success: false, error: { issues } };
    },
  };
}

/** The values of an item as a save sends them as its base. */
export const baseOf = (item: PlanItem) => ({
  topic: item.topic,
  objectives: item.objectives,
  links: item.links,
  classworks: item.classworks,
  homeworks: item.homeworks,
});
