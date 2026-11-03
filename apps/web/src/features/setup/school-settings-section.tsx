import {
  ratingExamsPrimaryPreviewSchema,
  schoolSettingsSchema,
  type GradeChanges,
  type RatingExamsPrimaryPreview,
} from '@sodiq/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { useChangeReason } from '@/features/results/change-reason';
import { cn } from 'cn';
import { SETUP_KEY } from './setup-api';

/** `GET /api/setup/school-settings`: the setting, read by the readers of the settings. */
export const schoolSettingsQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...SETUP_KEY, 'schoolSettings', branchId],
    queryFn: async () =>
      schoolSettingsSchema.parse(
        await answerOf(
          api.GET('/api/setup/school-settings', { params: { header: branchHeader() } }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The preview's journals as the reason dialog of 9.1 lists them, every branch together. */
const changesOf = (preview: RatingExamsPrimaryPreview): GradeChanges => ({
  reasonRequired: true,
  quarters: preview.branches.flatMap((branch) => branch.quarters),
});

/**
 * Task 9.4f (`05`, Grading weights on a subject, Grades 0–4): the school setting "Rating exams in
 * grades 0–4", read by the readers of the settings and turned by the Super Admin alone (the
 * server's `mayChange`). Turning it shows the grades that change and asks for the reason; a
 * turn-off that is refused lists the journals with rating exam entries and the groups of grades 4
 * and 5 in the way, and the subjects that miss their distribution without the rating exam.
 */
export function SchoolSettingsSection({ branchId }: { branchId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const settings = useQuery(schoolSettingsQuery(branchId));
  const reasons = useChangeReason();
  const [shown, setShown] = useState<RatingExamsPrimaryPreview | null>(null);
  const title = t('setup.settings.school.title');

  const turn = useMutation({
    mutationFn: async (on: boolean) => {
      const preview = ratingExamsPrimaryPreviewSchema.parse(
        await answerOf(
          api.POST('/api/setup/school-settings/rating-exams-primary/preview', { body: { on } }),
        ),
      );
      setShown(preview);
      if (preview.entries.length > 0 || preview.groups.length > 0) return;
      const reason = await reasons.ask(changesOf(preview));
      if (reason === null || reason === undefined) return;
      await answerOf(
        api.PUT('/api/setup/school-settings/rating-exams-primary', { body: { on, reason } }),
      );
      setShown(null);
      await queryClient.invalidateQueries({ queryKey: SETUP_KEY });
    },
  });

  let body;
  if (settings.isError) {
    body = (
      <ErrorState
        error={settings.error}
        onRetry={() => {
          void settings.refetch();
        }}
      />
    );
  } else if (settings.data === undefined) {
    body = <LoadingOutline lines={2} />;
  } else {
    const { ratingExamsPrimary, differing, mayChange } = settings.data;
    body = (
      <>
        <p className="text-sm">
          <span className="font-medium">{t('setup.settings.school.ratingExamsPrimary')}</span>
          {': '}
          <span data-testid="rating-exams-primary">
            {ratingExamsPrimary ? t('setup.settings.school.on') : t('setup.settings.school.off')}
          </span>
        </p>
        <p className="text-sm text-muted-foreground">{t('setup.settings.school.note')}</p>
        {differing.length > 0 && (
          <ul className="list-disc pl-5 text-sm">
            {differing.map((quarter) => (
              <li key={quarter.quarterId}>
                {t('setup.settings.school.differing', {
                  branch: quarter.branchName,
                  number: quarter.number,
                  state: quarter.ratingExamsPrimary
                    ? t('setup.settings.school.on')
                    : t('setup.settings.school.off'),
                })}
              </li>
            ))}
          </ul>
        )}
        {mayChange && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              disabled={turn.isPending}
              onClick={() => {
                turn.mutate(!ratingExamsPrimary);
              }}
            >
              {ratingExamsPrimary
                ? t('setup.settings.school.turnOff')
                : t('setup.settings.school.turnOn')}
            </Button>
            {differing.length > 0 && (
              <Button
                variant="secondary"
                disabled={turn.isPending}
                onClick={() => {
                  turn.mutate(ratingExamsPrimary);
                }}
              >
                {t('setup.settings.school.applyEverywhere')}
              </Button>
            )}
            <FailureAlert error={turn.error} />
          </div>
        )}
        {shown !== null && <PreviewNotes preview={shown} />}
        {reasons.dialog}
      </>
    );
  }
  return (
    <section aria-label={title} className={cn(PANEL, 'grid max-w-prose gap-3')}>
      <h2 className={SECTION_TITLE}>{title}</h2>
      {body}
    </section>
  );
}

/** What refuses a turn-off, and the subjects whose distribution without the exam is missing. */
function PreviewNotes({ preview }: { preview: RatingExamsPrimaryPreview }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'ru' ? 'ru' : i18n.language === 'en' ? 'en' : 'uz';
  const refused = preview.entries.length > 0 || preview.groups.length > 0;
  return (
    <div className="grid gap-2" role={refused ? 'alert' : undefined}>
      {refused && <p className="text-sm text-destructive">{t('setup.settings.school.refused')}</p>}
      {preview.entries.length > 0 && (
        <>
          <h3 className={SECTION_TITLE}>{t('setup.settings.school.entries')}</h3>
          <ul className="list-disc pl-5 text-sm">
            {preview.entries.map((one) => (
              <li key={`${one.quarterId}-${one.journalId}`}>
                {t('setup.settings.school.entryLine', {
                  branch: one.branchName,
                  number: one.number,
                  unit: one.unit.name,
                  subject: one.subject.names[language],
                })}
              </li>
            ))}
          </ul>
        </>
      )}
      {preview.groups.length > 0 && (
        <>
          <h3 className={SECTION_TITLE}>{t('setup.settings.school.groups')}</h3>
          <ul className="list-disc pl-5 text-sm">
            {preview.groups.map((one) => (
              <li key={one.groupId}>
                {t('setup.settings.school.groupLine', {
                  branch: one.branchName,
                  name: one.name,
                  subject: one.subject.names[language],
                })}
              </li>
            ))}
          </ul>
        </>
      )}
      {preview.weightsMissing.length > 0 && (
        <>
          <h3 className={SECTION_TITLE}>{t('setup.settings.school.weightsMissing')}</h3>
          <ul className="list-disc pl-5 text-sm">
            {preview.weightsMissing.map((one) => (
              <li key={`${one.quarterId}-${one.subject.id}`}>
                {t('setup.settings.school.weightsLine', {
                  branch: one.branchName,
                  number: one.number,
                  subject: one.subject.names[language],
                })}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
