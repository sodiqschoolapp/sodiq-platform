import { type DayChangeChoice, type WithdrawBody } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState, LoadingOutline } from '@/components/states';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { dayDecisionsBodyOf, PublishDayChanges } from './publish-day-changes';
import { withdrawCheckQuery } from './timetable-api';

/**
 * The question before a withdraw (task 5.5c-2a), with the stored one-day
 * changes and bulk cancels of the withdrawn dates sorted as a publish sorts
 * them (task 5.6a-5b-2, pull request #166; `edge/timetable`, Versions and
 * drafts: "The preview sorts them into kept, needs a decision and dropped.
 * Publish waits until every 'needs a decision' item is settled."). The check
 * is read when the dialog opens; "Withdraw" waits for a choice for each
 * "needs a decision" item and sends the key of the sorting shown with them.
 * The focus starts on the button that changes nothing, as in every question.
 */
export function WithdrawDialog({
  branchId,
  versionId,
  title,
  text,
  name,
  action,
  onClose,
  onWithdraw,
}: {
  branchId: string | null;
  versionId: string;
  title: string;
  text: string;
  /** The version, by the name the list gives it. */
  name: string;
  action: string;
  onClose: () => void;
  onWithdraw: (body: WithdrawBody) => void;
}) {
  const { t } = useTranslation();
  const check = useQuery(withdrawCheckQuery(branchId, versionId));
  const cancel = useRef<HTMLButtonElement>(null);
  const [chosen, setChosen] = useState<{
    key: string | null;
    choices: Record<string, DayChangeChoice>;
  }>({ key: null, choices: {} });

  const answer = check.data;
  // A choice counts only for the sorting shown now.
  const choices =
    answer !== undefined && chosen.key === answer.dayChanges.key ? chosen.choices : {};
  // A check read again (after a refusal of an older key) is waited for:
  // the key sent is the one of the sorting shown now.
  const body: WithdrawBody | null =
    answer === undefined || check.isFetching
      ? null
      : dayDecisionsBodyOf(answer.dayChanges, choices);

  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <AlertDialogContent
        initialFocus={cancel}
        className="max-h-[90vh] overflow-y-auto data-[size=default]:sm:max-w-2xl"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{text}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="list-disc pl-5 text-sm">
          <li>{name}</li>
        </ul>
        <div data-withdraw-day-changes="true">
          {check.isError ? (
            <ErrorState
              error={check.error}
              onRetry={() => {
                void check.refetch();
              }}
            />
          ) : answer === undefined ? (
            <LoadingOutline lines={2} />
          ) : (
            <PublishDayChanges
              impact={answer}
              choices={choices}
              canEdit
              onChoose={(key, choice) => {
                setChosen({
                  key: answer.dayChanges.key,
                  choices: { ...choices, [key]: choice },
                });
              }}
            />
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancel}>{t('confirm.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={body === null}
            onClick={() => {
              if (body !== null) onWithdraw(body);
            }}
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
