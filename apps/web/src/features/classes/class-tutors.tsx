import {
  classTutorEndSchema,
  classTutorGiveSchema,
  listName,
  type ClassDetail,
  type ClassTutor,
  type ClassTutorEnd,
  type ClassTutorGive,
  type ClassTutorKind,
  type TutorCandidate,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { DateField, SelectField } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { useRecordForm } from '@/components/form/use-record-form';
import type { PanelEditing } from '@/components/list/use-panel-editing';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { asFormSchema } from '@/features/people/form-schema';
import { schoolDateText } from '@/lib/dates';
import { tutorCandidatesQuery } from './classes-api';

/** The name of a Tutor row or a candidate: surname first, or the account without a record. */
export function tutorName(
  t: (key: 'classes.noRecordName') => string,
  person: { name: { firstName: string; lastName: string } | null },
): string {
  return person.name === null ? t('classes.noRecordName') : listName(person.name);
}

/** "From 14 October 2026" or "14 October 2026 – 1 November 2026". */
export function periodText(
  t: TFunction,
  language: string,
  row: { from: string; until: string | null },
): string {
  const from = schoolDateText(row.from, language);
  return row.until === null
    ? t('classes.periodOpen', { from })
    : t('classes.period', { from, until: schoolDateText(row.until, language) });
}

interface ClassTutorsProps {
  schoolClass: ClassDetail;
  /** Gives and ends Tutors: `classes` `edit`, a class that is active in an open year. */
  canEdit: boolean;
  panel: PanelEditing;
  onGive: (give: ClassTutorGive) => Promise<void>;
  onEnd: (tutorId: string, end: ClassTutorEnd) => Promise<void>;
}

/**
 * The Tutors of a class with their dates (edge/students-classes-groups: "The
 * Tutor of a class is recorded with dates ... An acting Tutor can be set for a
 * period"; task 3.1a, decisions 8, 9 and 15): every row, newest start first,
 * with "End" on a row not ended, and "Give Tutor" and "Set acting Tutor".
 */
export function ClassTutors({ schoolClass, canEdit, panel, onGive, onEnd }: ClassTutorsProps) {
  const { t, i18n } = useTranslation();
  const editing = panel.editing;
  const giving: ClassTutorKind | null =
    editing === 'give:tutor' ? 'tutor' : editing === 'give:acting' ? 'acting' : null;
  return (
    <section className="grid gap-3">
      <h3 className={SECTION_TITLE}>{t('classes.tutors')}</h3>
      {schoolClass.tutors.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('classes.noTutorRows')}</p>
      ) : (
        <ul className="grid gap-3">
          {schoolClass.tutors.map((row) => (
            <li key={row.id} className="grid gap-1 text-sm">
              <span className="font-semibold">
                {t('classes.kindOf', {
                  kind: t(`classes.kinds.${row.kind}`),
                  name: tutorName(t, row),
                })}
              </span>
              <span>{periodText(t, i18n.language, row)}</span>
              <span className="text-muted-foreground">
                {row.state === 'ended' && row.endCause !== null && row.endCause !== 'ended'
                  ? t('classes.stateWithCause', {
                      state: t(`classes.states.${row.state}`),
                      cause: t(`classes.endCauses.${row.endCause}`),
                    })
                  : t(`classes.states.${row.state}`)}
              </span>
              {canEdit && row.state !== 'ended' && editing === `end:${row.id}` ? (
                <EndForm
                  row={row}
                  today={schoolClass.today}
                  onEnd={async (end) => {
                    await onEnd(row.id, end);
                    panel.stop({ saved: true, key: `end:${row.id}` });
                  }}
                  onCancel={() => {
                    panel.stop();
                  }}
                />
              ) : (
                canEdit &&
                row.state !== 'ended' &&
                editing === null && (
                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      {...panel.opener(`end:${row.id}`)}
                      onClick={() => {
                        panel.start(`end:${row.id}`);
                      }}
                    >
                      {t('classes.endTutor')}
                    </Button>
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && giving !== null && (
        <GiveForm
          key={giving}
          kind={giving}
          schoolClass={schoolClass}
          onGive={async (give) => {
            await onGive(give);
            panel.stop({ saved: true, key: `give:${giving}` });
          }}
          onCancel={() => {
            panel.stop();
          }}
        />
      )}
      {canEdit && editing === null && (
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            {...panel.opener('give:tutor')}
            onClick={() => {
              panel.start('give:tutor');
            }}
          >
            {t('classes.giveTutor')}
          </Button>
          <Button
            variant="secondary"
            {...panel.opener('give:acting')}
            onClick={() => {
              panel.start('give:acting');
            }}
          >
            {t('classes.setActing')}
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * A Tutor or an acting Tutor from a date: a person holding the Tutor role in
 * the branch (decision 8). One who does not teach in the class's language is
 * shown, with the reason, and cannot be chosen (`05`: "blocked, not a
 * warning"); the server refuses it too.
 */
function GiveForm({
  kind,
  schoolClass,
  onGive,
  onCancel,
}: {
  kind: ClassTutorKind;
  schoolClass: ClassDetail;
  onGive: (give: ClassTutorGive) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const candidates = useQuery(tutorCandidatesQuery(branchId, true));
  const form = useRecordForm({
    schema: asFormSchema<ClassTutorGive>(classTutorGiveSchema, (path) => [...path]),
    initial: { assignmentId: '', from: schoolClass.today, until: '' },
    read: (typed) => ({
      assignmentId: typed.assignmentId,
      kind,
      from: typed.from,
      until: typed.until === '' ? null : typed.until,
    }),
    save: onGive,
  });
  const label = kind === 'tutor' ? t('classes.giveTutor') : t('classes.setActing');
  if (candidates.isError) {
    return (
      <ErrorState
        error={candidates.error}
        onRetry={() => {
          void candidates.refetch();
        }}
      />
    );
  }
  if (candidates.data === undefined) {
    return <LoadingOutline lines={2} />;
  }
  const language = t(`people.staff.languages.${schoolClass.language}`);
  const option = (candidate: TutorCandidate) => {
    const name = tutorName(t, candidate);
    const held = candidate.classes.map((one) => `${String(one.grade)} ${one.name}`).join(', ');
    const teaches = candidate.languages.includes(schoolClass.language);
    return {
      value: candidate.assignmentId,
      label: !teaches
        ? t('classes.lacksLanguage', { name, language })
        : held === ''
          ? name
          : t('classes.holds', { name, classes: held }),
      disabled: !teaches,
    };
  };
  return (
    <RecordForm form={form} label={label} onCancel={onCancel}>
      {candidates.data.candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('classes.noCandidates')}</p>
      ) : (
        <SelectField
          label={t('classes.person')}
          options={[
            { value: '', label: t('classes.choosePerson') },
            ...candidates.data.candidates.map(option),
          ]}
          {...form.bind('assignmentId')}
        />
      )}
      <DateField label={t('classes.from')} min={schoolClass.today} {...form.bind('from')} />
      <DateField label={t('classes.until')} min={schoolClass.today} {...form.bind('until')} />
    </RecordForm>
  );
}

/** The end of a Tutor row from a date, after a confirmation naming the person. */
function EndForm({
  row,
  today,
  onEnd,
  onCancel,
}: {
  row: ClassTutor;
  today: string;
  onEnd: (end: ClassTutorEnd) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const form = useRecordForm({
    schema: asFormSchema<ClassTutorEnd>(classTutorEndSchema, (path) => [...path]),
    initial: { from: today },
    save: async (end) => {
      const go = await confirm({
        title: t('classes.endTitle'),
        text: t('classes.endText'),
        names: [
          t('classes.kindOf', {
            kind: t(`classes.kinds.${row.kind}`),
            name: `${tutorName(t, row)}, ${schoolDateText(end.from, i18n.language)}`,
          }),
        ],
        action: t('classes.end'),
        destructive: true,
      });
      if (!go) {
        throw new SaveCancelled();
      }
      await onEnd(end);
    },
  });
  return (
    <RecordForm form={form} label={t('classes.endTutor')} onCancel={onCancel}>
      <DateField label={t('classes.endOn')} min={today} {...form.bind('from')} />
    </RecordForm>
  );
}
