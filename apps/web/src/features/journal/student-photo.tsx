import type { JournalStudent } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { initialsOf, PersonPhoto } from '@/components/person-photo';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { FOCUS_RING } from '@/components/ui/control';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useView } from '@/features/access/use-view';
import { studentPhotoQuery } from '@/features/people/people-api';

/**
 * The photo of a student in the journal (the owner, 28 October 2026): round and small in its
 * column, larger in a dialog when pressed, so the teacher can look at it closely. The photo is
 * read through the student's photo route (`students` `view`, with its scope); a student with
 * none, or a photo the reader may not read, shows the initials (`edge/system-behaviour`:
 * "photos fall back to initials").
 */
export function StudentPhotoCell({ student }: { student: JournalStudent }) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const [open, setOpen] = useState(false);
  const name = `${student.lastName} ${student.firstName}`;
  const photo =
    student.photoId === null ? null : studentPhotoQuery(branchId, student.id, student.photoId);
  const avatar = (
    <PersonPhoto
      name={name}
      initials={initialsOf(student.firstName, student.lastName)}
      photo={photo}
    />
  );
  if (photo === null) return <span data-student-photo={student.id}>{avatar}</span>;
  return (
    <>
      <button
        type="button"
        className={cn('inline-flex cursor-pointer rounded-full', FOCUS_RING)}
        aria-label={t('journal.grid.photoOpen', { name })}
        data-student-photo={student.id}
        onClick={() => {
          setOpen(true);
        }}
      >
        {avatar}
      </button>
      {open && (
        <StudentPhotoDialog
          name={name}
          photo={photo}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function StudentPhotoDialog({
  name,
  photo,
  onClose,
}: {
  name: string;
  photo: ReturnType<typeof studentPhotoQuery>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const query = useQuery(photo);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-label={name}>
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
        </DialogHeader>
        {query.isError ? (
          <ErrorState
            error={query.error}
            onRetry={() => {
              void query.refetch();
            }}
          />
        ) : query.isSuccess ? (
          <img
            src={query.data}
            alt={name}
            className="mx-auto max-h-[70vh] w-full max-w-sm rounded-lg object-contain"
            data-student-photo-large="true"
          />
        ) : (
          <LoadingOutline />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('journal.entry.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
