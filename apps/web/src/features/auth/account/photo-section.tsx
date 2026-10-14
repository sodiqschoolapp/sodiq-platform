import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { EmptyState, ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { photoRefusalOf, shrinkPhoto } from '@/features/people/shrink-photo';
import { sessionQuery } from '../session';
import { AccountSection } from './account-section';

const OWN_PHOTO_KEY = ['session', 'own-photo'] as const;

/** Reads a photo as a `data:` address the page can show. */
function dataUrlOf(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new ApiFailure('no_answer'));
      }
    };
    reader.onerror = () => {
      reject(new ApiFailure('no_answer'));
    };
    reader.readAsDataURL(file);
  });
}

/** The own photo as a `data:` address, or `null` when there is none (404). */
const ownPhotoQuery = queryOptions({
  queryKey: OWN_PHOTO_KEY,
  queryFn: async (): Promise<string | null> => {
    try {
      // The document calls the photo a binary string; with `parseAs: 'blob'` it is a Blob.
      const file: unknown = await answerOf(api.GET('/api/auth/photo', { parseAs: 'blob' }));
      if (!(file instanceof Blob)) {
        throw new ApiFailure('no_answer');
      }
      return await dataUrlOf(file);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'not_found') {
        return null;
      }
      throw error;
    }
  },
  retry: false,
});

/**
 * The own photo (`edge/people-roles-accounts`, Accounts and sign-in: "Staff
 * can change their own ... photo"; task 2.3c-2, decision 18 of pull request
 * #66). Shown only to an account with a staff record (the session names one);
 * the browser checks and shrinks the photo as the staff panel does (answer 2).
 * A Super Admin without a record is told, in one line, where to make and link
 * one (task 2.7d, decision 5 with correction 4 of the review of #87).
 */
export function PhotoSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const { data: session } = useQuery(sessionQuery);
  const photo = useQuery({ ...ownPhotoQuery, enabled: session?.name != null });
  const refresh = () => queryClient.invalidateQueries({ queryKey: OWN_PHOTO_KEY });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const refusal = photoRefusalOf(file);
      if (refusal !== null) {
        throw new ApiFailure(refusal);
      }
      let shrunk: Blob;
      try {
        shrunk = await shrinkPhoto(file);
      } catch {
        throw new ApiFailure('photo_invalid');
      }
      return answerOf(
        api.PUT('/api/auth/photo', {
          // The document types the body as a binary string; the browser sends the Blob as it is.
          body: shrunk as unknown as string,
          bodySerializer: (body: unknown) => body as Blob,
          headers: { 'Content-Type': shrunk.type },
        }),
      );
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => answerOf(api.DELETE('/api/auth/photo')),
    onSuccess: refresh,
  });

  const name = session?.name;
  if (name == null) {
    const superAdmin =
      session?.assignments.some((assignment) => assignment.role === 'super_admin') === true;
    return superAdmin ? (
      <AccountSection title={t('account.photoTitle')}>
        <EmptyState text={t('account.photoNoRecord')} />
      </AccountSection>
    ) : null;
  }
  const fullName = `${name.firstName} ${name.lastName}`;
  const initials = `${name.firstName.slice(0, 1)}${name.lastName.slice(0, 1)}`.toUpperCase();
  const has = photo.data != null;
  const pending = upload.isPending || remove.isPending;

  return (
    <AccountSection title={t('account.photoTitle')}>
      <div className="flex flex-wrap items-center gap-4">
        <span className="relative inline-flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-2xl font-medium text-muted-foreground">
          <span aria-hidden>{initials}</span>
          {has && (
            <img
              src={photo.data ?? ''}
              alt={fullName}
              className="absolute inset-0 size-full object-cover"
            />
          )}
        </span>
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            aria-label={t(has ? 'account.photoChange' : 'account.photoAdd')}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file !== undefined) {
                remove.reset();
                upload.mutate(file);
              }
            }}
          />
          <Button
            variant="secondary"
            disabled={pending || photo.isPending}
            onClick={() => {
              input.current?.click();
            }}
          >
            {t(has ? 'account.photoChange' : 'account.photoAdd')}
          </Button>
          {has && (
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                void confirm({
                  title: t('account.photoRemoveTitle'),
                  text: t('account.photoRemoveText'),
                  action: t('account.photoRemove'),
                  destructive: true,
                }).then((go) => {
                  if (go) {
                    upload.reset();
                    remove.mutate();
                  }
                });
              }}
            >
              {t('account.photoRemove')}
            </Button>
          )}
        </div>
      </div>
      {photo.isError && (
        <ErrorState
          error={photo.error}
          onRetry={() => {
            void photo.refetch();
          }}
        />
      )}
      <FailureAlert error={upload.error ?? remove.error} />
    </AccountSection>
  );
}
