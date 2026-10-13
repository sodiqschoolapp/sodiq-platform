import {
  relativeDetailSchema,
  relativeIdentitySchema,
  type RelativeDetail,
  type RelativeIdentity,
  type RelativeRecord,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { invalidateRelatives, relativeDetailQuery } from './people-api';
import { RelativeForm } from './relative-form';

/** A student as the list of students names them. */
const studentName = (student: { firstName: string; lastName: string }) =>
  `${student.firstName} ${student.lastName}`;

/**
 * A relative in the side panel of the Parents list (`04`, Close relatives:
 * "Shows the relative's data and all linked students. Editing the phone or
 * name here changes it for every linked student"; task 2.5a). The students of
 * other branches are a count (`edge`); workplace and email are read as
 * Identity, the Principal's behind a logged show (decision 5).
 */
export function ParentPanel({ id, name }: { id: string; name: string }) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const detail = useQuery(relativeDetailQuery(branchId, id));
  const edit = useMutation({
    mutationFn: (record: RelativeRecord) =>
      answerOf(
        api.PATCH('/api/people/relatives/{id}', {
          params: { header: branchHeader(), path: { id } },
          body: record,
        }),
      ),
    onSuccess: async (answer) => {
      queryClient.setQueryData(
        relativeDetailQuery(branchId, id).queryKey,
        relativeDetailSchema.parse(answer),
      );
      await invalidateRelatives(queryClient);
    },
  });

  if (detail.isError) {
    return (
      <ErrorState
        error={detail.error}
        onRetry={() => {
          void detail.refetch();
        }}
      />
    );
  }
  if (detail.data === undefined) {
    return <LoadingOutline />;
  }
  const relative = detail.data;
  return (
    <div className="grid gap-6">
      <RelativeTerms relative={relative} />
      <section className="grid gap-2">
        <h3 className="text-base font-semibold">{t('people.relatives.students')}</h3>
        <ul className="grid gap-1 text-sm">
          {relative.students.map((student) => (
            <li key={student.id} className="flex flex-wrap gap-x-2">
              <Link
                to="/people/students"
                search={{ open: student.id }}
                className="font-semibold text-link underline-offset-4 hover:underline"
              >
                {studentName(student)}
              </Link>
              <span className="text-muted-foreground">
                {t(`people.relatives.relationships.${student.relationship}`)}
              </span>
              {student.mainContact && (
                <span className="text-muted-foreground">{t('people.relatives.mainContact')}</span>
              )}
            </li>
          ))}
        </ul>
        {relative.elsewhere > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('people.relatives.elsewhereCount', { count: relative.elsewhere })}
          </p>
        )}
      </section>
      {relative.canEdit && (
        <section className="grid gap-3">
          <h3 className="text-base font-semibold">{t('people.relatives.recordTitle')}</h3>
          <RelativeForm
            key={`${relative.id}-record`}
            relative={relative}
            label={t('people.relatives.formLabel', { name })}
            onSave={async (record) => {
              await edit.mutateAsync(record);
            }}
          />
        </section>
      )}
    </div>
  );
}

/** Name, phone, and workplace and email as far as the reader may see them. */
function RelativeTerms({ relative }: { relative: RelativeDetail }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState<RelativeIdentity | null>(null);
  const show = useMutation({
    mutationFn: async () =>
      relativeIdentitySchema.parse(
        await answerOf(
          api.POST('/api/people/relatives/{id}/show', {
            params: { header: branchHeader(), path: { id: relative.id } },
          }),
        ),
      ),
    onSuccess: setShown,
  });
  const notSet = t('people.relatives.notSet');
  const identity = relative.identity ?? shown;
  const rows: [string, string][] = [
    [t('people.relatives.fullName'), relative.fullName],
    [t('people.relatives.phone'), relative.phone ?? t('people.relatives.noPhone')],
  ];
  if (identity !== null) {
    rows.push(
      [t('people.relatives.workplace'), identity.workplace ?? notSet],
      [t('people.relatives.email'), identity.email ?? notSet],
    );
  } else if (relative.identityHidden) {
    rows.push(
      [t('people.relatives.workplace'), t('people.relatives.hidden')],
      [t('people.relatives.email'), t('people.relatives.hidden')],
    );
  }
  return (
    <section className="grid gap-3">
      <dl className="grid gap-2 text-sm">
        {rows.map(([term, value]) => (
          <div key={term} className="grid gap-0.5">
            <dt className="text-muted-foreground">{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {relative.identityHidden && shown === null && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={show.isPending}
            onClick={() => {
              show.mutate();
            }}
          >
            {t('people.relatives.show')}
          </Button>
          <FailureAlert error={show.error} />
        </div>
      )}
    </section>
  );
}
