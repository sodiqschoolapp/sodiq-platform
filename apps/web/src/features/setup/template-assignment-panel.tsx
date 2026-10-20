import { assignmentEndSchema, type Assignment, type AssignmentEndSave } from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { DateField } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { PanelActions } from '@/components/list/panel-actions';
import { usePanelEditing } from '@/components/list/use-panel-editing';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE } from '@/components/ui/control';
import { schoolDateText } from '@/lib/dates';
import { usePreview } from './template-table';
import { invalidateTemplates } from './templates-api';

interface TemplateAssignmentPanelProps {
  assignment: Assignment;
  templateName: string;
  tomorrow: string;
  canEdit: boolean;
}

/**
 * A setting in the side panel: what it is, and its end from a date (never the
 * default's, decision 8). The end is the setting's one action, at the bottom
 * under its own name (task 2.7c-2b-1, decision 12): it ends the setting, it
 * does not edit it.
 */
export function TemplateAssignmentPanel({
  assignment,
  templateName,
  tomorrow,
  canEdit,
}: TemplateAssignmentPanelProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const preview = usePreview();
  const panel = usePanelEditing();
  const end = useMutation({
    mutationFn: (change: AssignmentEndSave) =>
      answerOf(
        api.POST('/api/setup/day-template-assignments/{id}/end', {
          params: { path: { id: assignment.id }, header: branchHeader() },
          body: change,
        }),
      ),
    onSuccess: () => invalidateTemplates(queryClient),
  });
  const form = useRecordForm({
    schema: assignmentEndSchema,
    initial: { from: tomorrow },
    save: async (change) => {
      const days = await preview.confirm({
        kind: 'assignment_end',
        assignmentId: assignment.id,
        change,
      });
      await end.mutateAsync({ ...change, days });
      panel.stop({ saved: true, key: 'end' });
    },
  });
  const date = (value: string | null) =>
    value === null ? '' : schoolDateText(value, i18n.language);
  const endable = canEdit && assignment.level !== 'default';

  return (
    <div className="grid gap-6">
      {endable && panel.editing === 'end' ? (
        <section className="grid gap-3">
          <h3 className={SECTION_TITLE}>{t('setup.templateSettings.endTitle')}</h3>
          <RecordForm
            form={form}
            label={t('setup.templateSettings.endTitle')}
            onCancel={() => {
              panel.stop();
            }}
          >
            <DateField label={t('setup.templateSettings.endFrom')} {...form.bind('from')} />
          </RecordForm>
        </section>
      ) : (
        <dl className="grid gap-2 text-sm">
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">{t('setup.templateSettings.template')}</dt>
            <dd>{templateName}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">{t('setup.templateSettings.from')}</dt>
            <dd>{date(assignment.validFrom)}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">{t('setup.templateSettings.until')}</dt>
            <dd>
              {assignment.validUntil === null
                ? t('setup.templateSettings.open')
                : date(assignment.validUntil)}
            </dd>
          </div>
        </dl>
      )}
      {preview.dialog}
      {canEdit && panel.editing === null && (
        <PanelActions
          primary={
            endable && (
              <Button
                {...panel.opener('end')}
                onClick={() => {
                  panel.start('end', form.reset);
                }}
              >
                {t('setup.templateSettings.endTitle')}
              </Button>
            )
          }
          note={endable ? null : t('setup.templateSettings.defaultStays')}
          saved={panel.saved}
        />
      )}
    </div>
  );
}
