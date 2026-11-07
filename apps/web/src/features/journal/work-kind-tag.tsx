import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export type WorkKind = 'classwork' | 'homework';

/**
 * The two tints of the tag (task 10.7, decision 5): the 15% tints of two subject colours of
 * `index.css`, blue and orange, which stay apart for red-green colour-blindness; the letter is in
 * the normal text colour, so the letter, not the colour, tells the kinds apart
 * (`tooling/contrast.test.ts` checks the pairs in both themes).
 */
export const KIND_TINT: Record<WorkKind, string> = {
  classwork: 'bg-subject-blue/15',
  homework: 'bg-subject-orange/15',
};

/**
 * The small tag in front of a work's title with the letter of its kind (`07`, Layout, Lessons:
 * "S for sinf ishi and U for uy vazifasi in Uzbek, К and Д in Russian, C and H in English; the
 * full word on hover"). A status label of the design system: a rectangle with corner 6, never a
 * pill. It is hidden from screen readers: the label of its place names the kind in full
 * (`journal.grid.workLabel`, decision 6).
 */
export function WorkKindTag({ kind, className }: { kind: WorkKind; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      aria-hidden="true"
      title={t(`journal.grid.kind.${kind}.word`)}
      data-work-kind={kind}
      className={cn(
        'inline-flex min-w-5 shrink-0 items-center justify-center rounded-sm px-1 text-xs leading-5 font-semibold text-foreground',
        KIND_TINT[kind],
        className,
      )}
    >
      {t(`journal.grid.kind.${kind}.letter`)}
    </span>
  );
}

/** The accessible name of a work: "<kind word>: <title>" (task 10.7, decision 6). */
export function useWorkLabel(): (kind: WorkKind, title: string) => string {
  const { t } = useTranslation();
  return (kind, title) =>
    t('journal.grid.workLabel', { kind: t(`journal.grid.kind.${kind}.word`), title });
}
