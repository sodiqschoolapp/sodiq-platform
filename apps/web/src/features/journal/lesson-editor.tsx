import {
  lessonTopicSchema,
  planWorkRenameSchema,
  PLAN_CODE_MAX_LENGTH,
  PLAN_TOPIC_MAX_LENGTH,
  WORK_TITLE_MAX,
  WORK_TOTAL_MAX,
  WORK_TOTAL_MIN,
  workTitleLength,
  type JournalGrid,
  type JournalLesson,
  type JournalWork,
} from '@sodiq/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from 'cn';
import { FailureAlert } from '@/components/failure-alert';
import { Field } from '@/components/field';
import { requiredOf } from '@/components/form/use-record-form';
import { DeleteIcon, EditIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { FIELD, SECTION_TITLE } from '@/components/ui/control';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useView } from '@/features/access/use-view';
import { downloadPlanFile } from '@/features/plans/plans-api';
import { schoolDateText } from '@/lib/dates';
import { lessonCardQuery } from './journal-api';
import { WorkKindTag } from './work-kind-tag';
import { readWorkAmount, refusalText, withPoint } from './work-amount';
import { CodedName } from '@/components/coded-name';

/**
 * One place to edit a lesson in the journal (the owner, 20 November 2026: "'Bu dars rejasini
 * o'zgartirish' and 'Dars ishlari' are two confusing and unnecessary buttons. Remove them and make
 * lesson editing inside the journal very simple"; "let the teacher delete and add as much topics,
 * CW, or HW as they want and whenever they want, inside the journal editing period").
 *
 * Opened from the lesson's header and from a work's header. The topic, each classwork with its
 * total, each homework with its total (a homework is graded at the lesson where it was given, `07`,
 * Homework column), each with Delete, and Add for a classwork or a homework. Everything is written while the lesson can be
 * entered (`canEnterWorks`: started, the reader's, inside the edit period); otherwise read only.
 * The objectives and the materials of the plan are shown under it. The server decides every
 * write; nothing is calculated here.
 */

export interface LessonEditorProps {
  readonly lesson: JournalLesson;
  readonly grid: JournalGrid;
  readonly language: string;
  readonly busy: boolean;
  readonly failure: unknown;
  /** The key of the work whose header opened the editor: its total field takes the focus. */
  readonly focusKey: string | null;
  readonly nameOfWork: (work: JournalWork) => string;
  readonly keyOf: (work: JournalWork) => string;
  /** Answers whether the server took it (a typed value stays on a refusal). */
  /** Task 11.27: `code` is the code typed (`undefined` while the subject's codes are off). */
  readonly onTopic: (topic: string, code?: string | null) => Promise<boolean>;
  readonly onAdd: (
    kind: 'classwork' | 'homework',
    title: string,
    code?: string | null,
  ) => Promise<boolean>;
  readonly onRename: (work: JournalWork, title: string, code?: string | null) => Promise<boolean>;
  readonly onTotal: (work: JournalWork, total: number) => void;
  readonly onDelete: (work: JournalWork) => void;
  readonly onClose: () => void;
}

export function LessonEditor({
  lesson,
  grid,
  language,
  busy,
  failure,
  focusKey,
  nameOfWork,
  keyOf,
  onTopic,
  onAdd,
  onRename,
  onTotal,
  onDelete,
  onClose,
}: LessonEditorProps) {
  const { t } = useTranslation();
  const enter = lesson.canEnterWorks;
  const date = schoolDateText(lesson.date, language);
  const title =
    lesson.number === null
      ? t('journal.card.titleNoNumber', { date })
      : t('journal.card.title', { number: lesson.number, date });
  const classworks = lesson.works.filter((work) => work.kind === 'classwork');
  const homeworks = lesson.works.filter((work) => work.kind === 'homework');
  const [adding, setAdding] = useState<'classwork' | 'homework' | null>(null);
  // Task 11.27 (`09`, Codes: "wherever a work is added in the journal").
  const codesOn = grid.journal.codesOn;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-label={title} className="sm:max-w-xl" data-lesson-editor={lesson.id}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5 text-sm">
          {lesson.slot !== null && (
            <p className="text-muted-foreground" data-card-slot="true">
              {t('journal.card.slotOfDay', { slot: lesson.slot })}
            </p>
          )}
          <FailureAlert error={failure} />
          <TopicForm
            key={`${lesson.topic ?? ''}|${lesson.topicCode ?? ''}`}
            stored={lesson.topic ?? ''}
            storedCode={lesson.topicCode}
            codesOn={codesOn}
            enter={enter}
            busy={busy}
            onSave={onTopic}
          />
          <section className="grid gap-2" aria-label={t('journal.editor.classworks')}>
            <h3 className={SECTION_TITLE}>{t('journal.editor.classworks')}</h3>
            {classworks.length === 0 && (
              <p className="text-muted-foreground">{t('journal.card.none')}</p>
            )}
            {classworks.map((work) => (
              <WorkRow
                key={keyOf(work)}
                work={work}
                name={nameOfWork(work)}
                extra={null}
                enter={enter}
                busy={busy}
                focus={focusKey === keyOf(work)}
                lastTotal={grid.lastTotal}
                codesOn={codesOn}
                onRename={(text, code) => onRename(work, text, code)}
                onTotal={(total) => {
                  onTotal(work, total);
                }}
                onDelete={() => {
                  onDelete(work);
                }}
              />
            ))}
            {enter && adding === 'classwork' && (
              <WorkTitleForm
                initial=""
                label={t('journal.works.classworkTitle')}
                action={t('journal.works.add')}
                busy={busy}
                codesOn={codesOn}
                onSave={async (text, code) => {
                  if (await onAdd('classwork', text, code)) setAdding(null);
                }}
                onCancel={() => {
                  setAdding(null);
                }}
              />
            )}
            {enter && adding !== 'classwork' && (
              <div>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setAdding('classwork');
                  }}
                >
                  {t('journal.editor.addClasswork')}
                </Button>
              </div>
            )}
          </section>
          <section className="grid gap-2" aria-label={t('journal.card.homeworks')}>
            <h3 className={SECTION_TITLE}>{t('journal.card.homeworks')}</h3>
            {homeworks.length === 0 && (
              <p className="text-muted-foreground">{t('journal.card.none')}</p>
            )}
            {homeworks.map((work) => (
              <WorkRow
                key={keyOf(work)}
                work={work}
                name={nameOfWork(work)}
                extra={null}
                enter={enter}
                busy={busy}
                focus={focusKey === keyOf(work)}
                lastTotal={grid.lastTotal}
                codesOn={codesOn}
                onRename={(text, code) => onRename(work, text, code)}
                onTotal={(total) => {
                  onTotal(work, total);
                }}
                onDelete={() => {
                  onDelete(work);
                }}
              />
            ))}
            {enter && adding === 'homework' && (
              <WorkTitleForm
                initial=""
                label={t('journal.works.homeworkTitle')}
                action={t('journal.works.add')}
                busy={busy}
                codesOn={codesOn}
                onSave={async (text, code) => {
                  if (await onAdd('homework', text, code)) setAdding(null);
                }}
                onCancel={() => {
                  setAdding(null);
                }}
              />
            )}
            {enter && adding !== 'homework' && (
              <div>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setAdding('homework');
                  }}
                >
                  {t('journal.editor.addHomework')}
                </Button>
              </div>
            )}
          </section>
          <PlanExtras lessonId={lesson.id} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('journal.entry.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The topic of the lesson: a field and Save while the lesson can be entered, its text otherwise. */
function TopicForm({
  stored,
  storedCode,
  codesOn,
  enter,
  busy,
  onSave,
}: {
  stored: string;
  /** Task 11.27: the topic code shown (`null` when none or off). */
  storedCode: string | null;
  codesOn: boolean;
  enter: boolean;
  busy: boolean;
  onSave: (topic: string, code?: string | null) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState(stored);
  const [typedCode, setTypedCode] = useState(storedCode ?? '');
  const trimmed = typed.trim();
  const tooLong = trimmed.length > PLAN_TOPIC_MAX_LENGTH;
  const code = typedCode.trim();
  const codeTooLong = [...code].length > PLAN_CODE_MAX_LENGTH;
  const codeChanged = codesOn && code !== (storedCode ?? '');
  const changed = trimmed !== stored.trim() || codeChanged;
  if (!enter) {
    return (
      <div className="grid gap-1">
        <p className="font-semibold">{t('journal.card.topic')}</p>
        <p data-card-topic="true">
          {stored === '' ? (
            t('journal.works.noPlan')
          ) : (
            <CodedName code={storedCode} name={stored} />
          )}
        </p>
      </div>
    );
  }
  return (
    <form
      className="grid gap-2"
      data-editor-topic="true"
      onSubmit={(event) => {
        event.preventDefault();
        if (tooLong || codeTooLong || !changed) return;
        void (codesOn ? onSave(trimmed, code === '' ? null : code) : onSave(trimmed));
      }}
    >
      {codesOn && (
        <Field
          label={t('plans.codes.topicCode')}
          value={typedCode}
          autoComplete="off"
          error={codeTooLong ? t('plans.codes.tooLong', { max: PLAN_CODE_MAX_LENGTH }) : undefined}
          onChange={(event) => {
            setTypedCode(event.target.value);
          }}
        />
      )}
      <Field
        label={t('journal.card.topic')}
        value={typed}
        // Optional: an empty topic clears it (task 11.18, from `lessonTopicSchema`).
        required={requiredOf(lessonTopicSchema, { topic: typed }, 'topic', {
          read: (values) => ({ topic: values.topic, baseTopic: stored }),
        })}
        autoComplete="off"
        error={
          tooLong ? t('journal.editor.topicTooLong', { max: PLAN_TOPIC_MAX_LENGTH }) : undefined
        }
        onChange={(event) => {
          setTyped(event.target.value);
        }}
      />
      {changed && (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || tooLong || codeTooLong}>
            {t('journal.editor.saveTopic')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setTyped(stored);
              setTypedCode(storedCode ?? '');
            }}
          >
            {t('form.cancel')}
          </Button>
        </div>
      )}
    </form>
  );
}

/** One work of the lesson: its kind and title (renamed in place), its total, and Delete. */
function WorkRow({
  work,
  name,
  extra,
  enter,
  busy,
  focus,
  lastTotal,
  codesOn,
  onRename,
  onTotal,
  onDelete,
}: {
  work: JournalWork;
  /** Task 11.27: the subject's codes are on: the rename takes a code too. */
  codesOn: boolean;
  name: string;
  /** A second word beside the title (the day a homework was given). */
  extra: string | null;
  enter: boolean;
  busy: boolean;
  focus: boolean;
  lastTotal: number | null;
  onRename: (title: string, code?: string | null) => Promise<boolean>;
  onTotal: (total: number) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  // `07`: "The last total the teacher used in that journal is offered for the next work."
  const shown = work.total === null ? '' : String(work.total);
  const [typed, setTyped] = useState<{ from: string; text: string } | null>(null);
  const text = typed !== null && typed.from === shown ? typed.text : shown;
  // A total takes the rule of a score, from 1 to 1000 (task 11.25b; `edge/journal`, "A total
  // of 3000 is typed").
  const read = readWorkAmount(text, WORK_TOTAL_MIN, WORK_TOTAL_MAX);
  const value = read.kind === 'value' ? read.value : null;
  const valid = value !== null;
  const field = useRef<HTMLInputElement>(null);
  const send = () => {
    if (value === null || value === work.total) return;
    setTyped(null);
    onTotal(value);
  };
  const renamable = work.planWorkId !== null || (work.unplanned && work.id !== null);
  return (
    <div className="grid gap-2" data-editor-work={work.id ?? work.planWorkId ?? ''}>
      <div className="flex flex-wrap items-center gap-2">
        <WorkKindTag kind={work.kind} />
        <CodedName className="min-w-0 flex-1 break-words font-medium" code={work.code} name={name} />
        {extra !== null && <span className="text-muted-foreground">{extra}</span>}
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{t('journal.editor.total')}</span>
          <input
            ref={field}
            className={cn(FIELD, 'w-20 text-center')}
            inputMode="numeric"
            autoComplete="off"
            // The work's header opened the editor: the total waits for the number.
            autoFocus={focus}
            value={text}
            placeholder={work.total === null && lastTotal !== null ? String(lastTotal) : undefined}
            disabled={!enter || busy}
            aria-label={t('journal.editor.totalOf', { name })}
            aria-invalid={text !== '' && !valid ? true : undefined}
            title={
              read.kind === 'refused'
                ? refusalText(t, { reason: read.reason, min: WORK_TOTAL_MIN, max: WORK_TOTAL_MAX })
                : undefined
            }
            onChange={(event) => {
              setTyped({ from: shown, text: event.target.value });
            }}
            onBlur={send}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              send();
            }}
          />
          {/* A point of its own (task 11.25b, review correction 1): a keypad may give a comma. */}
          {enter && (
            <Button
              variant="ghost"
              size="icon"
              className="font-semibold"
              data-editor-total-point="true"
              aria-label={t('journal.refusals.point')}
              title={t('journal.refusals.point')}
              disabled={busy}
              // The field keeps the focus: its blur would send the total before the point.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const input = field.current;
                if (input === null) return;
                const at = (input.selectionStart ?? input.value.length) + 1;
                setTyped({ from: shown, text: withPoint(input) });
                input.focus();
                requestAnimationFrame(() => input.setSelectionRange(at, at));
              }}
            >
              .
            </Button>
          )}
        </label>
        {enter && renamable && (
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={t('journal.editor.rename', { name })}
            title={t('journal.editor.rename', { name })}
            onClick={() => {
              setRenaming((now) => !now);
            }}
          >
            <EditIcon aria-hidden="true" />
          </Button>
        )}
        {enter && (
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={t('journal.editor.delete', { name })}
            title={t('journal.editor.delete', { name })}
            onClick={onDelete}
          >
            <DeleteIcon aria-hidden="true" />
          </Button>
        )}
      </div>
      {renaming && (
        <WorkTitleForm
          initial={work.title ?? ''}
          // Task 11.27: a work added by hand before 7 November takes no code (plan decision 3).
          initialCode={work.code}
          codesOn={codesOn && work.planWorkId !== null}
          label={t('journal.works.titleLabel')}
          action={t('journal.works.rename')}
          busy={busy}
          onSave={async (title, code) => {
            if (await onRename(title, code)) setRenaming(false);
          }}
          onCancel={() => {
            setRenaming(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * The title of a work (`07`, Entering data: "each with a title the teacher types when adding it
 * (required, at most 60 characters)"), counted in characters as the server counts them
 * (`workTitleLength`); the server checks it again.
 */
export function WorkTitleForm({
  initial,
  initialCode = null,
  codesOn = false,
  label,
  action,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  /** Task 11.27: the code shown, and whether the code field is shown (`09`, Codes). */
  initialCode?: string | null;
  codesOn?: boolean;
  label: string;
  action: string;
  busy: boolean;
  /** `code` is `undefined` while the code field is not shown (the stored code stays). */
  onSave: (title: string, code?: string | null) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState(initial);
  const [typedCode, setTypedCode] = useState(initialCode ?? '');
  const [tried, setTried] = useState(false);
  const title = typed.trim();
  const length = workTitleLength(title);
  const code = typedCode.trim();
  const codeTooLong = [...code].length > PLAN_CODE_MAX_LENGTH;
  const codeChanged = codesOn && code !== (initialCode ?? '');
  const problem =
    length === 0
      ? t('journal.works.titleRequired')
      : length > WORK_TITLE_MAX
        ? t('journal.works.titleTooLong', { max: WORK_TITLE_MAX })
        : undefined;
  return (
    <form
      className="grid gap-2"
      data-work-title-form="true"
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (problem !== undefined || codeTooLong || (title === initial && !codeChanged)) return;
        void (codesOn ? onSave(title, code === '' ? null : code) : onSave(title));
      }}
    >
      {codesOn && (
        <Field
          label={t('plans.codes.code')}
          value={typedCode}
          autoComplete="off"
          error={codeTooLong ? t('plans.codes.tooLong', { max: PLAN_CODE_MAX_LENGTH }) : undefined}
          onChange={(event) => {
            setTypedCode(event.target.value);
          }}
        />
      )}
      <Field
        label={label}
        value={typed}
        // The title of a work, required (task 11.18, from `workTitleSchema`).
        required={requiredOf(planWorkRenameSchema, { title: typed }, 'title', {
          read: (values) => ({ title: values.title, baseTitle: initial }),
        })}
        autoComplete="off"
        // A form opened to add or rename: the person types at once.
        autoFocus
        error={tried || length > WORK_TITLE_MAX ? problem : undefined}
        note={t('journal.works.titleCount', { typed: length, max: WORK_TITLE_MAX })}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={busy || codeTooLong || (initial !== '' && title === initial && !codeChanged)}
        >
          {action}
        </Button>
        {onCancel !== undefined && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('journal.works.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}

/** The plan's objectives and materials of the lesson, read only (they are written in the plan). */
function PlanExtras({ lessonId }: { lessonId: string }) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const card = useQuery(lessonCardQuery(branchId, lessonId));
  const download = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => downloadPlanFile(id, name),
  });
  const found = card.data;
  if (card.isError) {
    return (
      <p className="text-muted-foreground" data-editor-extras="failed">
        {t('journal.editor.extrasFailed')}{' '}
        <Button
          variant="ghost"
          onClick={() => {
            void card.refetch();
          }}
        >
          {t('journal.editor.retry')}
        </Button>
      </p>
    );
  }
  if (found === undefined || !found.whole) return null;
  const materials = found.files.filter((file) => file.workId === null);
  const hasObjectives = found.objectives !== null && found.objectives !== '';
  if (!hasObjectives && found.links.length === 0 && materials.length === 0) return null;
  return (
    <div className="grid gap-3" data-editor-extras="true">
      {hasObjectives && (
        <div className="grid gap-1">
          <p className="font-semibold">{t('journal.card.objectives')}</p>
          <p className="whitespace-pre-line">{found.objectives}</p>
        </div>
      )}
      {(found.links.length > 0 || materials.length > 0) && (
        <div className="grid gap-1">
          <p className="font-semibold">{t('journal.card.materials')}</p>
          <ul className="grid gap-1">
            {found.links.map((link) => (
              <li key={link}>
                <a className="text-link" href={link} target="_blank" rel="noreferrer">
                  {link}
                </a>
              </li>
            ))}
            {materials.map((file) => (
              <li key={file.id}>
                <Button
                  variant="ghost"
                  disabled={download.isPending}
                  onClick={() => {
                    download.mutate({ id: file.id, name: file.name });
                  }}
                >
                  {file.name}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {download.isError && <FailureAlert error={download.error} />}
    </div>
  );
}
