import {
  dayTemplateRenameSchema,
  nextDay,
  timeText,
  type DayTemplateRename,
  type DayTemplateSummary,
  type DayTemplateVersionRecord,
  type SlotType,
} from '@sodiq/shared';
import { inForceOn } from '@sodiq/timetable-rules';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { Field } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useView } from '@/features/access/use-view';
import { VersionForm } from './day-template-form';
import { usePreview } from './template-table';
import { dayTemplateQuery, invalidateTemplates, rangeText } from './templates-api';
import { schoolDateText } from '@/lib/dates';
import { SECTION_TITLE } from '@/components/ui/control';

interface DayTemplatePanelProps {
  summary: DayTemplateSummary;
  /** Today in branch time, from the server. */
  today: string;
  slotTypes: readonly SlotType[];
  canEdit: boolean;
  canArchive: boolean;
}

/**
 * A day template in the side panel: its slots as they stand tomorrow, with
 * their times; its name; new slots or a new start time from a date (answer
 * 12), saved after the preview of the table; its versions; archive or restore.
 */
export function DayTemplatePanel({
  summary,
  today,
  slotTypes,
  canEdit,
  canArchive,
}: DayTemplatePanelProps) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const preview = usePreview();
  const tomorrow = nextDay(today);
  const template = useQuery(dayTemplateQuery(branchId, summary.id, tomorrow));
  const archived = summary.archivedAt !== null;
  const refresh = () => invalidateTemplates(queryClient);
  const path = { params: { path: { id: summary.id }, header: branchHeader() } };

  const rename = useMutation({
    mutationFn: (record: DayTemplateRename) =>
      answerOf(api.PATCH('/api/setup/day-templates/{id}', { ...path, body: record })),
    onSuccess: refresh,
  });
  const addVersion = useMutation({
    mutationFn: (record: DayTemplateVersionRecord) =>
      answerOf(api.POST('/api/setup/day-templates/{id}/versions', { ...path, body: record })),
    onSuccess: refresh,
  });
  const archive = useMutation({
    mutationFn: (restore: boolean) =>
      answerOf(
        restore
          ? api.POST('/api/setup/day-templates/{id}/restore', path)
          : api.POST('/api/setup/day-templates/{id}/archive', path),
      ),
    onSuccess: refresh,
  });

  const renameForm = useRecordForm({
    schema: dayTemplateRenameSchema,
    initial: { name: summary.name },
    save: async (record) => {
      await rename.mutateAsync(record);
    },
  });

  const askArchive = async () => {
    if (
      await confirm({
        title: archived
          ? t('setup.dayTemplates.restoreTitle', { name: summary.name })
          : t('setup.dayTemplates.archiveTitle', { name: summary.name }),
        text: archived ? undefined : t('setup.dayTemplates.archiveText'),
        names: [summary.name],
        action: archived ? t('setup.dayTemplates.restore') : t('setup.dayTemplates.archive'),
        destructive: !archived,
      })
    ) {
      archive.mutate(archived);
    }
  };

  if (template.isError) {
    return (
      <ErrorState
        error={template.error}
        onRetry={() => {
          void template.refetch();
        }}
      />
    );
  }
  if (template.data === undefined) {
    return <LoadingOutline />;
  }
  const record = template.data;
  // The version the form starts from: the one in force tomorrow, by the rule engine's reading.
  const inForce = inForceOn(record.versions, tomorrow)[0];

  return (
    <div className="grid gap-6">
      <section className="grid gap-2">
        <h3 className={SECTION_TITLE}>
          {t('setup.dayTemplates.dayOn', { date: schoolDateText(tomorrow, i18n.language) })}
        </h3>
        <ol className="grid gap-1 text-sm">
          {record.slots.map((slot) => (
            <li key={slot.position} className="flex gap-3">
              <span className="w-24 tabular-nums">{rangeText(t, slot.start, slot.end)}</span>
              <span>{slot.name}</span>
              {slot.lessonNumber !== null && (
                <span className="text-muted-foreground">
                  {t('setup.dayTemplates.lessonNumber', { n: slot.lessonNumber })}
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>
      {canEdit && !archived && (
        <>
          <RecordForm form={renameForm} label={summary.name}>
            <Field
              label={t('setup.dayTemplates.name')}
              autoComplete="off"
              {...renameForm.bind('name')}
            />
          </RecordForm>
          <section className="grid gap-3">
            <h3 className={SECTION_TITLE}>{t('setup.dayTemplates.changeSlots')}</h3>
            <VersionForm
              key={inForce?.id ?? 'none'}
              slotTypes={slotTypes}
              label={t('setup.dayTemplates.changeSlots')}
              initial={{
                from: tomorrow,
                startTime: inForce === undefined ? '08:00' : timeText(inForce.startMinutes),
                slotTypeIds: inForce?.slotTypeIds ?? [],
              }}
              onSave={async (change) => {
                await preview.confirm({
                  kind: 'template_version',
                  dayTemplateId: summary.id,
                  change,
                });
                await addVersion.mutateAsync(change);
              }}
            />
          </section>
        </>
      )}
      <section className="grid gap-3">
        <h3 className={SECTION_TITLE}>{t('setup.dayTemplates.versions')}</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('setup.dayTemplates.from')}</TableHead>
              <TableHead>{t('setup.dayTemplates.until')}</TableHead>
              <TableHead>{t('setup.dayTemplates.startTime')}</TableHead>
              <TableHead>{t('setup.dayTemplates.slotCount')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {record.versions.map((version) => (
              <TableRow key={version.id}>
                <TableCell>{schoolDateText(version.validFrom, i18n.language)}</TableCell>
                <TableCell>
                  {version.validUntil === null
                    ? ''
                    : schoolDateText(version.validUntil, i18n.language)}
                </TableCell>
                <TableCell>{timeText(version.startMinutes)}</TableCell>
                <TableCell>{version.slotTypeIds.length}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      {canArchive && (
        <div>
          <Button
            variant={archived ? 'secondary' : 'destructive'}
            disabled={archive.isPending}
            onClick={() => {
              void askArchive();
            }}
          >
            {archived ? t('setup.dayTemplates.restore') : t('setup.dayTemplates.archive')}
          </Button>
        </div>
      )}
      <FailureAlert error={archive.error} />
      {preview.dialog}
    </div>
  );
}
