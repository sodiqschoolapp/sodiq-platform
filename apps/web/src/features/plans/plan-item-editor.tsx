import {
  PLAN_FILE_MAX_BYTES,
  PLAN_FILE_TYPES,
  PLAN_FILES_MAX,
  PLAN_WORKS_MAX,
  type PlanItem,
  type PlanItemFile,
} from '@sodiq/shared';
import { useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { failureText } from '@/api/failure-text';
import { FailureAlert } from '@/components/failure-alert';
import { Field, TextAreaField } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { Button } from '@/components/ui/button';
import {
  baseOf,
  filledSlots,
  initialOf,
  noteField,
  planFormSchema,
  titleField,
  WORK_KINDS,
  type PlanField,
  type WorkKind,
} from './plan-item-form';
import { addPlanFile, createPlanItem, invalidatePlans, savePlanItem } from './plans-api';

/**
 * Task 10.8: the form of a plan item, shared by the plan's row panel and the lesson card (`09`,
 * In the journal: "The lesson card is a second way into the plan item of its lesson"). Files can
 * be attached while the row is written (`09`, What a plan contains: "Files, of the materials and
 * of each work, can be attached while a row is being written"): they are held here and uploaded
 * once the save answers with the ids of the works (plan decision 10), so none is ever left
 * unbound; a file that fails is handed back as "not uploaded", never dropped.
 */

/** Where a held file goes: the item's materials, or the work of a slot of the form. */
export type FilePlace = 'materials' | `${WorkKind}:${number}`;

/** A file the person picked and the server has not taken (yet). */
export interface HeldFile {
  readonly key: string;
  readonly file: File;
  readonly place: FilePlace;
  /** The work it belongs to once the item is saved, `null` for the materials. */
  readonly workId?: string | null;
  /** Why the upload failed; absent while it waits for the save. */
  readonly failure?: unknown;
}

let heldCount = 0;

/** The browser's check of a picked file against the plan's limits (the server decides again). */
export function fileProblem(t: TFunction, file: File, taken: number): string | null {
  if (taken >= PLAN_FILES_MAX) return t('plans.files.full');
  if (file.size > PLAN_FILE_MAX_BYTES) return t('plans.files.tooLarge', { name: file.name });
  if (!(PLAN_FILE_TYPES as readonly string[]).includes(file.type)) {
    return t('plans.files.wrongType', { name: file.name });
  }
  return null;
}

/** Uploads held files to the saved item; gives back the ones that failed, with the reason. */
export async function uploadHeld(itemId: string, held: readonly HeldFile[]): Promise<HeldFile[]> {
  const failed: HeldFile[] = [];
  for (const one of held) {
    if (one.workId === undefined) {
      // Its slot no longer held a work when the row was saved.
      failed.push({ ...one, failure: new ApiFailure('plan_work_not_found') });
      continue;
    }
    try {
      await addPlanFile(itemId, one.file, one.workId);
    } catch (error) {
      failed.push({ ...one, failure: error });
    }
  }
  return failed;
}

/** A small file picker; `onPick` gets the file chosen. */
export function FilePicker({
  label,
  disabled,
  onPick,
}: {
  label: string;
  disabled?: boolean;
  onPick: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input
        ref={input}
        type="file"
        className="sr-only"
        aria-label={label}
        accept={PLAN_FILE_TYPES.join(',')}
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          event.target.value = '';
          if (chosen !== undefined) onPick(chosen);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => {
          input.current?.click();
        }}
      >
        {label}
      </Button>
    </div>
  );
}

/** The files a place holds now: the stored ones, then the held ones waiting for the save. */
function PlaceFiles({
  stored,
  held,
  onDrop,
}: {
  stored: readonly PlanItemFile[];
  held: readonly HeldFile[];
  onDrop: (key: string) => void;
}) {
  const { t } = useTranslation();
  if (stored.length === 0 && held.length === 0) return null;
  return (
    <ul className="grid gap-1 text-sm">
      {stored.map((file) => (
        <li key={file.id}>{file.name}</li>
      ))}
      {held.map((one) => (
        <li key={one.key} className="flex flex-wrap items-center gap-2">
          <span>{one.file.name}</span>
          <span className="text-muted-foreground">{t('plans.files.pending')}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('plans.files.dropOf', { name: one.file.name })}
            onClick={() => {
              onDrop(one.key);
            }}
          >
            {t('plans.files.drop')}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** The files not uploaded after a save, with a retry and a remove for each. */
export function NotUploaded({
  itemId,
  failed,
  onChange,
}: {
  itemId: string | null;
  failed: readonly HeldFile[];
  onChange: (next: HeldFile[]) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (failed.length === 0) return null;
  return (
    <div className="grid gap-2" role="alert" data-not-uploaded="true">
      <p className="font-semibold">{t('plans.files.notUploaded')}</p>
      <ul className="grid gap-2 text-sm">
        {failed.map((one) => (
          <li key={one.key} className="flex flex-wrap items-center gap-2">
            <span>{one.file.name}</span>
            <span className="text-muted-foreground">{failureText(t, one.failure)}</span>
            {itemId !== null && one.workId !== undefined && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void uploadHeld(itemId, [one])
                    .then(async (still) => {
                      onChange([...failed.filter((other) => other.key !== one.key), ...still]);
                      await invalidatePlans(queryClient);
                    })
                    .finally(() => {
                      setBusy(false);
                    });
                }}
              >
                {t('plans.files.retry')}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('plans.files.dropOf', { name: one.file.name })}
              onClick={() => {
                onChange(failed.filter((other) => other.key !== one.key));
              }}
            >
              {t('plans.files.drop')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The form of one row: topic, objectives, links, the works with their files and the materials.
 * `onSaved` gets the saved item and the files that could not be uploaded.
 */
export function PlanItemEditor({
  journalId,
  quarterId,
  position,
  lessonId,
  item,
  label,
  notes = {},
  sameTopic,
  checkedToday,
  onSaved,
  onCancel,
  failureNotes,
}: {
  journalId: string;
  quarterId: string;
  position: number;
  lessonId: string;
  item: PlanItem | null;
  label: string;
  notes?: Partial<Record<PlanField, string>>;
  /** The topic of the lesson before on the same day ("same topic as the previous lesson"). */
  sameTopic?: string;
  checkedToday?: string;
  onSaved: (saved: PlanItem, failed: HeldFile[]) => void;
  onCancel: () => void;
  /** The notes of fields a save was refused for, from the failure (the row panel's). */
  failureNotes?: (failure: unknown, item: PlanItem | null) => Partial<Record<PlanField, string>>;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [shown, setShown] = useState<Record<WorkKind, number>>({
    classwork: item?.classworks.length ?? 0,
    homework: item?.homeworks.length ?? 0,
  });
  const [held, setHeldState] = useState<HeldFile[]>([]);
  // The save reads the files held when it runs, not when the form was first drawn.
  const heldNow = useRef<HeldFile[]>([]);
  const setHeld = (next: (before: HeldFile[]) => HeldFile[]) => {
    heldNow.current = next(heldNow.current);
    setHeldState(heldNow.current);
  };
  const [pickProblem, setPickProblem] = useState<string | null>(null);

  const form = useRecordForm({
    schema: planFormSchema(item),
    initial: initialOf(item),
    message: (field) => (field === 'links' ? t('plans.panel.linksInvalid') : undefined),
    save: async (values) => {
      const saved =
        item === null
          ? await createPlanItem(journalId, {
              quarterId,
              position,
              // Task 7.1b: refused `plan_row_moved` when the rows shifted meanwhile.
              lessonId,
              values: {
                ...values,
                classworks: values.classworks.map(({ title, description }) => ({
                  title,
                  description,
                })),
                homeworks: values.homeworks.map(({ title, description }) => ({
                  title,
                  description,
                })),
              },
            })
          : await savePlanItem(item.id, { base: baseOf(item), values });
      // Each held file goes to the work its slot holds now, in the order the save sent them.
      const slotsNow: Record<WorkKind, number[]> = {
        classwork: filledSlots(typedRef.current, 'classwork'),
        homework: filledSlots(typedRef.current, 'homework'),
      };
      const bound = heldNow.current.map((one): HeldFile => {
        if (one.place === 'materials') return { ...one, workId: null };
        const [kind, slotText] = one.place.split(':') as [WorkKind, string];
        const index = slotsNow[kind].indexOf(Number(slotText));
        const work = (kind === 'classwork' ? saved.classworks : saved.homeworks)[index];
        return work === undefined
          ? { key: one.key, file: one.file, place: one.place }
          : { ...one, workId: work.id };
      });
      const failed = await uploadHeld(saved.id, bound);
      setHeld(() => []);
      await invalidatePlans(queryClient);
      onSaved(saved, failed);
    },
  });
  // The typed values as the form holds them (the slots that hold a work).
  const typedNow = (): Record<string, string> => {
    const typed: Record<string, string> = {};
    for (const kind of WORK_KINDS) {
      for (let slot = 0; slot < PLAN_WORKS_MAX; slot += 1) {
        typed[titleField(kind, slot)] = form.bind(titleField(kind, slot)).value;
        typed[noteField(kind, slot)] = form.bind(noteField(kind, slot)).value;
      }
    }
    return typed;
  };
  // The typed values of this render, for the save that runs later (its closure is older).
  const typedRef = useRef<Record<string, string>>({});
  const typedValues = typedNow();
  useEffect(() => {
    typedRef.current = typedValues;
  });
  const shownNotes = { ...notes, ...(failureNotes?.(form.failure, item) ?? {}) };

  const storedOf = (place: FilePlace): PlanItemFile[] => {
    if (item === null) return [];
    if (place === 'materials') return item.files.filter((file) => file.workId === null);
    const [kind, slotText] = place.split(':') as [WorkKind, string];
    const work = (kind === 'classwork' ? item.classworks : item.homeworks)[Number(slotText)];
    return work === undefined ? [] : item.files.filter((file) => file.workId === work.id);
  };
  const heldOf = (place: FilePlace) => held.filter((one) => one.place === place);
  const pick = (place: FilePlace, file: File) => {
    const problem = fileProblem(t, file, storedOf(place).length + heldOf(place).length);
    setPickProblem(problem);
    if (problem !== null) return;
    heldCount += 1;
    setHeld((before) => [...before, { key: `held-${String(heldCount)}`, file, place }]);
  };
  const drop = (key: string) => {
    setHeld((before) => before.filter((one) => one.key !== key));
  };

  return (
    <RecordForm form={form} label={label} onCancel={onCancel}>
      {sameTopic !== undefined && (
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              form.bind('topic').onChange({ target: { value: sameTopic } });
            }}
          >
            {t('plans.panel.sameTopic')}
          </Button>
        </div>
      )}
      <Field label={t('plans.plan.topic')} note={shownNotes.topic} {...form.bind('topic')} />
      <TextAreaField
        label={t('plans.panel.objectives')}
        note={shownNotes.objectives}
        rows={3}
        {...form.bind('objectives')}
      />
      <TextAreaField
        label={t('plans.panel.links')}
        note={shownNotes.links ?? t('plans.panel.linksNote')}
        rows={2}
        {...form.bind('links')}
      />
      {WORK_KINDS.map((kind) => {
        const count = Math.max(
          shown[kind],
          ...filledSlots(initialOf(item), kind).map((slot) => slot + 1),
        );
        return (
          <fieldset key={kind} className="grid gap-3">
            <legend className="font-semibold">
              {kind === 'classwork' ? t('plans.plan.classworks') : t('plans.plan.homeworks')}
            </legend>
            {kind === 'homework' && checkedToday !== undefined && (
              <p className="text-sm text-muted-foreground">{checkedToday}</p>
            )}
            {Array.from({ length: count }, (_, slot) => {
              const place: FilePlace = `${kind}:${String(slot)}`;
              const title = form.bind(titleField(kind, slot)).value;
              return (
                <div key={slot} className="grid gap-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field
                      label={t(`plans.panel.${kind}Title`, { number: slot + 1 })}
                      note={shownNotes[titleField(kind, slot)]}
                      autoComplete="off"
                      {...form.bind(titleField(kind, slot))}
                    />
                    <Field
                      label={t('plans.panel.description')}
                      autoComplete="off"
                      {...form.bind(noteField(kind, slot))}
                    />
                  </div>
                  <PlaceFiles stored={storedOf(place)} held={heldOf(place)} onDrop={drop} />
                  {title.trim() !== '' && (
                    <FilePicker
                      label={t('plans.files.attachTo', { name: title.trim() })}
                      onPick={(file) => {
                        pick(place, file);
                      }}
                    />
                  )}
                </div>
              );
            })}
            {count < PLAN_WORKS_MAX && (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShown((before) => ({ ...before, [kind]: count + 1 }));
                  }}
                >
                  {kind === 'classwork'
                    ? t('plans.panel.addClasswork')
                    : t('plans.panel.addHomework')}
                </Button>
              </div>
            )}
          </fieldset>
        );
      })}
      <fieldset className="grid gap-2">
        <legend className="font-semibold">{t('plans.files.materials')}</legend>
        <p className="text-sm text-muted-foreground">{t('plans.files.materialsNote')}</p>
        <PlaceFiles stored={storedOf('materials')} held={heldOf('materials')} onDrop={drop} />
        <FilePicker
          label={t('plans.files.attachMaterial')}
          onPick={(file) => {
            pick('materials', file);
          }}
        />
      </fieldset>
      <FailureAlert error={pickProblem} text={pickProblem ?? undefined} />
    </RecordForm>
  );
}
