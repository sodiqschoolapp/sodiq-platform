import {
  classDisplayName,
  examBodySchema,
  examCheckBodySchema,
  examCreateBodySchema,
  timeText,
  type DayLesson,
  type ErrorDetail,
  type Exam,
  type ExamBlockChoiceBody,
  type ExamCheck,
  type ExamCheckBody,
  type ExamInput,
  type ExamSaveAnswer,
} from '@sodiq/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { DateField, Field, SelectField, TextAreaField } from '@/components/field';
import { useRecordForm } from '@/components/form/use-record-form';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { CHECKBOX, CHECKBOX_TARGET, SUBSECTION_TITLE } from '@/components/ui/control';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { classesQuery } from '@/features/classes/classes-api';
import { groupsQuery } from '@/features/classes/groups-api';
import { staffQuery } from '@/features/people/people-api';
import { roomsQuery } from '@/features/setup/setup-api';
import { subjectsQuery } from '@/features/setup/subjects-api';
import { ruleText } from './rule-text';
import { changeExam, checkExam, createExam, dayQuery } from './timetable-api';

type Language = 'uz' | 'ru' | 'en';

type Typed = 'date' | 'firstLesson' | 'lastLesson' | 'title' | 'subjectId' | 'keepReason';

/** A room of the form: its room, the classes or groups it holds and its invigilators. */
interface RoomRow {
  readonly key: string;
  readonly roomId: string;
  readonly classIds: readonly string[];
  readonly groupIds: readonly string[];
  readonly invigilatorIds: readonly string[];
}

const emptyRoom = (): RoomRow => ({
  key: crypto.randomUUID(),
  roomId: '',
  classIds: [],
  groupIds: [],
  invigilatorIds: [],
});

const toggled = (all: readonly string[], id: string, on: boolean): string[] =>
  on ? [...all.filter((one) => one !== id), id] : all.filter((one) => one !== id);

/** The key of a shared block's choice: the sitting class and the block. */
const choiceKey = (classId: string, blockId: string) => `${classId}|${blockId}`;

/** The choices as the body sends them, in one order whatever order they were made in. */
const choiceList = (picked: Readonly<Record<string, ExamBlockChoiceBody['choice']>>) =>
  Object.entries(picked)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([both, choice]) => {
      const [classId = '', blockId = ''] = both.split('|');
      return { classId, blockId, choice };
    });

/** What a check was made for: the body without the keep reason, which it does not answer. */
const signature = (body: ExamCheckBody) =>
  JSON.stringify({
    ...body,
    keepCancelled: body.keepCancelled === undefined ? undefined : [...body.keepCancelled].sort(),
    keepReason: undefined,
  });

/**
 * The form of an exam (task 5.6c-2, pull request #182; `06`, Changes after
 * publishing, Exam: "a title, a subject if it has one, one or more
 * consecutive lesson slots of the day template ..., the classes that sit it,
 * and one or more rooms, each with the classes it holds and one or more
 * invigilators"). "Check" asks the server what a save would do (`POST
 * timetable/exams/check`): the lessons it cancels, a choice for each block
 * shared with classes that do not sit (edge/timetable, Exams), the blocked
 * rules, the warnings with one tick, and on a change the lessons it gives
 * back, each blocked one kept cancelled with a reason or the save refused.
 * A choice or a keep tick runs the check again (plan review must-fix 1);
 * Save is on only while the newest check, made for exactly what the form
 * holds, says the exam can be saved. Its key is made when the dialog opens.
 */
export function ExamForm({
  exam,
  date,
  branchId,
  language,
  onClose,
  onSaved,
}: {
  /** The exam a change changes; `null` for a new one. */
  exam: Exam | null;
  date: string;
  branchId: string | null;
  language: Language;
  onClose: () => void;
  onSaved: (answer: ExamSaveAnswer) => Promise<void>;
}) {
  const { t } = useTranslation();
  const key = useRef(crypto.randomUUID());
  const done = useRef<ExamSaveAnswer | null>(null);
  const element = useRef<HTMLFormElement>(null);
  const classes = useQuery(classesQuery(branchId));
  const groups = useQuery(groupsQuery(branchId));
  const staff = useQuery(staffQuery(branchId));
  const rooms = useQuery(roomsQuery(branchId));
  const subjects = useQuery(subjectsQuery(branchId));
  const [roomRows, setRoomRows] = useState<readonly RoomRow[]>(() =>
    exam === null
      ? [emptyRoom()]
      : exam.rooms.map((one) => ({
          key: crypto.randomUUID(),
          roomId: one.room.id,
          classIds: one.classes.map((unit) => unit.id),
          groupIds: one.groups.map((unit) => unit.id),
          invigilatorIds: one.invigilators.map((person) => person.id),
        })),
  );
  const [choices, setChoices] = useState<Readonly<Record<string, ExamBlockChoiceBody['choice']>>>(
    {},
  );
  const [keeps, setKeeps] = useState<readonly string[]>([]);
  const [ticked, setTicked] = useState(false);
  // The body the newest check was made for, to tell a stale answer.
  const [checkedFor, setCheckedFor] = useState<string | null>(null);

  const bodyOf = (
    typed: Record<Typed, string>,
    picked: Readonly<Record<string, ExamBlockChoiceBody['choice']>>,
    kept: readonly string[],
    forSave = false,
  ): ExamCheckBody => ({
    ...(exam === null || forSave ? {} : { examId: exam.id }),
    date: typed.date,
    firstLesson: typed.firstLesson === '' ? 0 : Number(typed.firstLesson),
    lastLesson: typed.lastLesson === '' ? 0 : Number(typed.lastLesson),
    title: typed.title,
    subjectId: typed.subjectId === '' ? null : typed.subjectId,
    rooms: roomRows.map((one) => ({
      roomId: one.roomId,
      classIds: [...one.classIds],
      groupIds: [...one.groupIds],
      invigilatorIds: [...one.invigilatorIds],
    })),
    blockChoices: choiceList(picked),
    ...(kept.length === 0
      ? {}
      : { keepCancelled: [...kept], ...(forSave ? { keepReason: typed.keepReason } : {}) }),
  });

  const form = useRecordForm<Typed, ExamInput>({
    schema: exam === null ? examCreateBodySchema : examBodySchema,
    initial: {
      date: exam?.date ?? date,
      firstLesson: exam?.firstLesson === null || exam === null ? '' : String(exam.firstLesson),
      lastLesson: exam?.lastLesson === null || exam === null ? '' : String(exam.lastLesson),
      title: exam?.title ?? '',
      subjectId: exam?.subject?.id ?? '',
      keepReason: '',
    },
    read: (typed) => ({ ...bodyOf(typed, choices, keeps, true), confirm: ticked }),
    save: async (body) => {
      done.current =
        exam === null
          ? await createExam(examCreateBodySchema.parse(body), key.current)
          : await changeExam(exam.id, examBodySchema.parse(body), key.current);
    },
    message: (field) =>
      field === 'title'
        ? t('timetable.exams.titleNeeded')
        : field === 'firstLesson' || field === 'lastLesson'
          ? t('timetable.exams.lessonNeeded')
          : field === 'keepReason'
            ? t('timetable.exams.keepReasonNeeded')
            : undefined,
  });

  const typed: Record<Typed, string> = {
    date: form.bind('date').value,
    firstLesson: form.bind('firstLesson').value,
    lastLesson: form.bind('lastLesson').value,
    title: form.bind('title').value,
    subjectId: form.bind('subjectId').value,
    keepReason: form.bind('keepReason').value,
  };
  const current = bodyOf(typed, choices, keeps);
  const check = useMutation({
    mutationFn: (body: ExamCheckBody) => checkExam(body),
    onSuccess: (answer, body) => {
      // The choice the check used (the stored one of a change) stands as
      // chosen, so the answer is the one for what the form now holds.
      const merged: Record<string, ExamBlockChoiceBody['choice']> = {};
      for (const one of answer.choices) {
        if (one.choice !== null) merged[choiceKey(one.classId, one.blockId)] = one.choice;
      }
      for (const one of body.blockChoices ?? []) {
        merged[choiceKey(one.classId, one.blockId)] = one.choice;
      }
      setChoices(merged);
      setCheckedFor(signature({ ...body, blockChoices: choiceList(merged) }));
    },
  });
  const result: ExamCheck | null = check.data ?? null;
  const fresh = result !== null && checkedFor === signature(current);
  const valid = examCheckBodySchema.safeParse(current).success;
  const warnings = result?.warnings ?? [];
  const ready =
    fresh &&
    result.canSave &&
    (warnings.length === 0 || ticked) &&
    (keeps.length === 0 || typed.keepReason.trim() !== '') &&
    form.status !== 'saving';

  const runCheck = (body: ExamCheckBody) => {
    if (examCheckBodySchema.safeParse(body).success) check.mutate(body);
  };

  // A changed choice or keep tick asks the check again at once.
  const choose = (classId: string, blockId: string, choice: ExamBlockChoiceBody['choice']) => {
    const next = { ...choices, [choiceKey(classId, blockId)]: choice };
    setChoices(next);
    runCheck(bodyOf(typed, next, keeps));
  };
  const keep = (lessonIds: readonly string[], on: boolean) => {
    const next = lessonIds.reduce<readonly string[]>((all, id) => toggled(all, id, on), keeps);
    setKeeps(next);
    runCheck(bodyOf(typed, choices, next));
  };

  const activeClasses = (classes.data?.classes ?? [])
    .filter((one) => !one.archived && one.yearStatus !== 'closed')
    .sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name));
  const subjectGroups = (groups.data?.groups ?? [])
    .filter(
      (one) => !one.archived && one.yearStatus !== 'closed' && one.subject.id === typed.subjectId,
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const people = (staff.data?.staff ?? [])
    .filter((one) => one.status === 'active')
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  const roomOptions = (rooms.data?.rooms ?? [])
    .filter((one) => one.status === 'in_use')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((one) => ({ value: one.id, label: one.name }));
  const subjectOptions = (subjects.data?.subjects ?? [])
    .filter((one) => one.archivedAt === null)
    .map((one) => ({ value: one.id, label: one.names[language] }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // The lesson slots of the date for the first class that sits (decision 8).
  const firstClass =
    roomRows.flatMap((one) => one.classIds)[0] ??
    (groups.data?.groups ?? []).find((one) => roomRows.some((row) => row.groupIds.includes(one.id)))
      ?.classes[0]?.id ??
    null;
  const day = useQuery(dayQuery(branchId, typed.date === '' ? null : typed.date, firstClass));

  const lessonText = (lesson: DayLesson) =>
    t('timetable.exams.lesson', {
      start: timeText(lesson.start),
      end: timeText(lesson.end),
      unit: lesson.unit.name,
      subject: lesson.subject.names[language],
      teacher: lesson.teacher?.name ?? t('timetable.day.needsTeacher'),
    });
  const ruleLines = (rules: readonly ErrorDetail[]) => (
    <ul className="grid gap-1 text-sm">
      {rules.map((detail, index) => (
        <li key={`${detail.code}-${String(index)}`}>
          {detail.code === 'day_off'
            ? t('timetable.exams.dayOff')
            : t('timetable.day.blocked', { rule: ruleText(t, detail.code) })}
        </li>
      ))}
    </ul>
  );

  const title = t(exam === null ? 'timetable.exams.newTitle' : 'timetable.exams.changeTitle');
  const lists = [classes, groups, rooms, subjects];
  const listFailed = lists.find((one) => one.isError);

  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!ready) return;
    const saved = await form.submit();
    if (!saved) {
      element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (done.current !== null) {
      await onSaved(done.current);
    } else {
      // A refusal (the timetable changed meanwhile): the check is asked again.
      setCheckedFor(null);
    }
  };

  const slotOptions = (day.data?.slots ?? []).map((slot) => ({
    value: String(slot.lessonNumber),
    label: t('timetable.day.slotLabel', {
      number: slot.lessonNumber,
      start: timeText(slot.start),
      end: timeText(slot.end),
    }),
  }));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {listFailed !== undefined ? (
          <ErrorState
            error={listFailed.error}
            onRetry={() => {
              for (const one of lists) void one.refetch();
            }}
          />
        ) : lists.some((one) => one.data === undefined) ? (
          <LoadingOutline />
        ) : (
          <form
            ref={element}
            aria-label={title}
            className="grid gap-4"
            onSubmit={(event) => {
              void send(event);
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <DateField label={t('timetable.exams.date')} {...form.bind('date')} />
              <Field label={t('timetable.exams.examTitle')} {...form.bind('title')} />
              <SelectField
                label={t('timetable.exams.subject')}
                options={[{ value: '', label: t('timetable.exams.noSubject') }, ...subjectOptions]}
                {...form.bind('subjectId')}
              />
            </div>
            {roomRows.map((row, index) => (
              <fieldset
                key={row.key}
                className="grid gap-3 rounded-md border p-3"
                data-exam-room={index}
              >
                <legend className="px-1 text-sm font-semibold">
                  {t('timetable.exams.roomNumber', { number: index + 1 })}
                </legend>
                <SelectField
                  label={t('timetable.exams.room')}
                  name={`room-${row.key}`}
                  value={row.roomId}
                  error={undefined}
                  options={[{ value: '', label: t('timetable.exams.roomChoose') }, ...roomOptions]}
                  onChange={(event) => {
                    const roomId = event.target.value;
                    setRoomRows((all) =>
                      all.map((one) => (one.key === row.key ? { ...one, roomId } : one)),
                    );
                  }}
                />
                <UnitBoxes
                  legend={t('timetable.exams.classes')}
                  units={activeClasses.map((one) => ({
                    id: one.id,
                    name: classDisplayName(one.grade, one.name),
                  }))}
                  chosen={row.classIds}
                  onToggle={(id, on) => {
                    setRoomRows((all) =>
                      all.map((one) =>
                        one.key === row.key
                          ? { ...one, classIds: toggled(one.classIds, id, on) }
                          : one,
                      ),
                    );
                  }}
                  data="classes"
                />
                {typed.subjectId !== '' && subjectGroups.length > 0 && (
                  <UnitBoxes
                    legend={t('timetable.exams.groups')}
                    units={subjectGroups.map((one) => ({ id: one.id, name: one.name }))}
                    chosen={row.groupIds}
                    onToggle={(id, on) => {
                      setRoomRows((all) =>
                        all.map((one) =>
                          one.key === row.key
                            ? { ...one, groupIds: toggled(one.groupIds, id, on) }
                            : one,
                        ),
                      );
                    }}
                    data="groups"
                  />
                )}
                {staff.error instanceof ApiFailure && staff.error.code === 'permission_denied' ? (
                  <p className="text-sm">{t('problems.noAccessPart')}</p>
                ) : staff.isError ? (
                  <ErrorState error={staff.error} onRetry={() => void staff.refetch()} />
                ) : staff.data === undefined ? (
                  <LoadingOutline />
                ) : (
                  <UnitBoxes
                    legend={t('timetable.exams.invigilators')}
                    units={people.map((one) => ({
                      id: one.id,
                      name: `${one.lastName} ${one.firstName}`,
                    }))}
                    chosen={row.invigilatorIds}
                    onToggle={(id, on) => {
                      setRoomRows((all) =>
                        all.map((one) =>
                          one.key === row.key
                            ? { ...one, invigilatorIds: toggled(one.invigilatorIds, id, on) }
                            : one,
                        ),
                      );
                    }}
                    data="invigilators"
                  />
                )}
                {roomRows.length > 1 && (
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setRoomRows((all) => all.filter((one) => one.key !== row.key));
                      }}
                    >
                      {t('timetable.exams.removeRoom')}
                    </Button>
                  </div>
                )}
              </fieldset>
            ))}
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setRoomRows((all) => [...all, emptyRoom()]);
                }}
              >
                {t('timetable.exams.addRoom')}
              </Button>
            </div>
            {firstClass === null ? (
              <p className="text-sm" data-exam-lessons="none">
                {t('timetable.exams.chooseClassFirst')}
              </p>
            ) : day.isError ? (
              <ErrorState error={day.error} onRetry={() => void day.refetch()} />
            ) : day.data === undefined ? (
              <LoadingOutline />
            ) : day.data.slots.length === 0 ? (
              <p className="text-sm" data-exam-lessons="none">
                {t('timetable.exams.noLessons')}
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label={t('timetable.exams.firstLesson')}
                  options={[{ value: '', label: t('timetable.day.slotChoose') }, ...slotOptions]}
                  {...form.bind('firstLesson')}
                />
                <SelectField
                  label={t('timetable.exams.lastLesson')}
                  options={[{ value: '', label: t('timetable.day.slotChoose') }, ...slotOptions]}
                  {...form.bind('lastLesson')}
                />
              </div>
            )}
            <div>
              <Button
                type="button"
                variant="secondary"
                disabled={!valid || check.isPending}
                onClick={() => {
                  runCheck(current);
                }}
              >
                {t('timetable.exams.check')}
              </Button>
            </div>
            <FailureAlert error={check.error} />
            {result !== null && !fresh && !check.isPending && (
              <p className="text-sm" data-exam-stale="true">
                {t('timetable.exams.stale')}
              </p>
            )}
            {result !== null && (fresh || check.isPending) && (
              <div className="grid gap-3" data-exam-check="true">
                <section className="grid gap-1" data-exam-cancels="true">
                  <h4 className={SUBSECTION_TITLE}>{t('timetable.exams.toCancel')}</h4>
                  {result.cancels.length === 0 ? (
                    <p className="text-sm">{t('timetable.exams.noneToCancel')}</p>
                  ) : (
                    <ul className="grid gap-1 text-sm">
                      {result.cancels.map((one) => (
                        <li key={one.id} data-lesson={one.id}>
                          {lessonText(one)}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                {result.choices.map((one) => (
                  <fieldset
                    key={choiceKey(one.classId, one.blockId)}
                    className="grid gap-1 rounded-md border p-3"
                    data-shared={one.blockId}
                  >
                    <legend className="px-1 text-sm font-semibold">
                      {t('timetable.exams.shared', {
                        sitting: one.className,
                        others: one.otherClasses.join(', '),
                      })}
                    </legend>
                    <ul className="grid gap-1 text-sm">
                      {one.lessons.map((lesson) => (
                        <li key={lesson.id}>{lessonText(lesson)}</li>
                      ))}
                    </ul>
                    {(['cancel', 'keep'] as const).map((choice) => (
                      <label key={choice} className={CHECKBOX_TARGET}>
                        <input
                          type="radio"
                          name={`shared-${one.classId}-${one.blockId}`}
                          className={CHECKBOX}
                          value={choice}
                          checked={choices[choiceKey(one.classId, one.blockId)] === choice}
                          disabled={check.isPending}
                          onChange={() => {
                            choose(one.classId, one.blockId, choice);
                          }}
                        />
                        <span className="text-sm">{t(`timetable.exams.choice_${choice}`)}</span>
                      </label>
                    ))}
                  </fieldset>
                ))}
                {result.blocked === null ? (
                  <p className="text-sm" data-exam-unchosen="true">
                    {t('timetable.exams.chooseEach')}
                  </p>
                ) : (
                  result.blocked.length > 0 && (
                    <section className="grid gap-1" data-exam-blocked="true">
                      <h4 className={SUBSECTION_TITLE}>{t('timetable.exams.blocked')}</h4>
                      {ruleLines(result.blocked)}
                    </section>
                  )
                )}
                {warnings.length > 0 && (
                  <section className="grid gap-1" data-exam-warnings="true">
                    <h4 className={SUBSECTION_TITLE}>{t('timetable.exams.warnings')}</h4>
                    <ul className="grid gap-1 text-sm">
                      {warnings.map((detail, index) => (
                        <li key={`${detail.code}-${String(index)}`}>
                          {t('timetable.day.warning', { rule: ruleText(t, detail.code) })}
                        </li>
                      ))}
                    </ul>
                    <label className={CHECKBOX_TARGET}>
                      <input
                        type="checkbox"
                        className={CHECKBOX}
                        checked={ticked}
                        onChange={(event) => {
                          setTicked(event.target.checked);
                        }}
                      />
                      <span className="text-sm">{t('timetable.exams.tick')}</span>
                    </label>
                  </section>
                )}
                {exam !== null &&
                  (result.givenBack === null
                    ? result.blocked !== null && (
                        <p className="text-sm" data-exam-given-back="later">
                          {t('timetable.exams.givenBackLater')}
                        </p>
                      )
                    : result.givenBack.length > 0 && (
                        <section className="grid gap-1" data-exam-given-back="true">
                          <h4 className={SUBSECTION_TITLE}>{t('timetable.exams.givenBack')}</h4>
                          <ul className="grid gap-2 text-sm">
                            {result.givenBack.map((one) => (
                              <li key={one.lesson.id} data-given-back={one.state}>
                                {lessonText(one.lesson)} · {t(`timetable.exams.given_${one.state}`)}
                                {one.rules.length > 0 && ruleLines(one.rules)}
                                {(one.state === 'blocked' ||
                                  one.state === 'kept' ||
                                  one.state === 'restorable') && (
                                  <label className={CHECKBOX_TARGET}>
                                    <input
                                      type="checkbox"
                                      className={CHECKBOX}
                                      checked={keeps.includes(one.lesson.id)}
                                      disabled={check.isPending}
                                      onChange={(event) => {
                                        keep([one.lesson.id], event.target.checked);
                                      }}
                                    />
                                    <span className="text-sm">{t('timetable.exams.keep')}</span>
                                  </label>
                                )}
                              </li>
                            ))}
                          </ul>
                          {result.freeRooms.length > 0 && (
                            <p className="text-sm" data-free-rooms="true">
                              {t('timetable.day.freeRooms', {
                                rooms: result.freeRooms.map((one) => one.name).join(', '),
                              })}
                            </p>
                          )}
                          {keeps.length > 0 && (
                            <TextAreaField
                              label={t('timetable.exams.keepReason')}
                              rows={2}
                              {...form.bind('keepReason')}
                            />
                          )}
                        </section>
                      ))}
              </div>
            )}
            <FailureAlert error={form.failure} />
            {form.failure instanceof ApiFailure && (
              <p className="text-sm">{t('timetable.exams.checkAgain')}</p>
            )}
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" />}>
                {t('timetable.day.back')}
              </DialogClose>
              <Button type="submit" disabled={!ready}>
                {t('timetable.exams.save')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A list of checkboxes for classes, groups or invigilators of one room. */
function UnitBoxes({
  legend,
  units,
  chosen,
  onToggle,
  data,
}: {
  legend: string;
  units: readonly { id: string; name: string }[];
  chosen: readonly string[];
  onToggle: (id: string, on: boolean) => void;
  data: string;
}) {
  return (
    <fieldset className="grid gap-1" data-units={data}>
      <legend className="mb-1 text-sm font-semibold">{legend}</legend>
      <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">
        {units.map((one) => (
          <label key={one.id} className={CHECKBOX_TARGET}>
            <input
              type="checkbox"
              className={CHECKBOX}
              checked={chosen.includes(one.id)}
              onChange={(event) => {
                onToggle(one.id, event.target.checked);
              }}
            />
            <span className="text-sm">{one.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
