import type { StudentDetail } from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { initialsOf, PersonPhoto } from '@/components/person-photo';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import {
  invalidateStudents,
  removeStudentPhoto,
  setStudentPhoto,
  studentDetailQuery,
  studentPhotoQuery,
} from './people-api';
import { photoRefusalOf, shrinkPhoto } from './shrink-photo';

/**
 * The photo of a student (task 2.4b-2, decision 7): shown to every reader (the
 * Basic group), set and removed by those who edit the record, the Super Admin
 * and the Academic Vice Principal. As the staff photo of 2.2c-2, the browser
 * checks the type and the 5 MB, then shrinks the photo before it is sent
 * (answer 2).
 */
export function StudentPhotoSection({ student, name }: { student: StudentDetail; name: string }) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const reread = async () => {
    await queryClient.invalidateQueries({
      queryKey: studentDetailQuery(branchId, student.id).queryKey,
    });
    await invalidateStudents(queryClient);
  };
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
      return setStudentPhoto(student.id, shrunk);
    },
    onSuccess: reread,
  });
  const remove = useMutation({
    mutationFn: () => removeStudentPhoto(student.id),
    onSuccess: reread,
  });
  const pending = upload.isPending || remove.isPending;
  const action = student.photoId === null ? 'people.staff.photo.add' : 'people.staff.photo.change';

  return (
    <section className="grid gap-3" aria-label={t('people.staff.photo.title')}>
      <div className="flex flex-wrap items-center gap-4">
        <PersonPhoto
          name={name}
          initials={initialsOf(student.firstName, student.lastName)}
          photo={
            student.photoId === null
              ? null
              : studentPhotoQuery(branchId, student.id, student.photoId)
          }
          size="lg"
        />
        {student.canEdit && (
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              aria-label={t(action)}
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
              size="sm"
              disabled={pending}
              onClick={() => {
                input.current?.click();
              }}
            >
              {t(action)}
            </Button>
            {student.photoId !== null && (
              <Button
                variant="destructive"
                size="sm"
                disabled={pending}
                onClick={() => {
                  void confirm({
                    title: t('people.staff.photo.removeTitle'),
                    text: t('people.staff.photo.removeText'),
                    names: [name],
                    action: t('people.staff.photo.remove'),
                    destructive: true,
                  }).then((go) => {
                    if (go) {
                      upload.reset();
                      remove.mutate();
                    }
                  });
                }}
              >
                {t('people.staff.photo.remove')}
              </Button>
            )}
          </div>
        )}
      </div>
      <FailureAlert error={upload.error ?? remove.error} />
    </section>
  );
}
