import { gradeRanges, listName, phoneText } from '@sodiq/shared';
import type {
  AuditEntryAnswer,
  PersonalDataKind,
  PersonalDataReport,
  RelativeReport,
  StaffReport,
  StudentReport,
  Weekday,
} from '@sodiq/shared';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { initialsOf, PersonPhoto } from '@/components/person-photo';
import { Letterhead } from '@/components/print/letterhead';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE, SUBSECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import {
  actionName,
  entryFormatOf,
  recordTypeName,
  valueLeavesOf,
} from '@/features/audit/entry-panel';
import { isLanguage, LANGUAGE_NAMES } from '@/i18n/languages';
import { nameOf } from '@/features/setup/setup-api';
import { producePersonalDataReport, staffPhotoQuery, studentPhotoQuery } from './people-api';
import { mergeValueText } from './student-merge';
import { formatMomentIn, schoolDateText, weekdayName } from '@/lib/dates';

/** The body attribute that prints the report alone (index.css). */
const PRINTING = 'report';

/** The list each kind of person is opened from, for the breadcrumb and Close. */
const LISTS = {
  student: '/people/students',
  staff: '/people/staff',
  relative: '/people/parents',
} as const;

type Row = readonly [label: string, value: ReactNode];

/** The words of a printout: the language of the page, moments in the branch's time zone. */
function useWords(report: PersonalDataReport) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const empty = t('people.report.empty');
  return {
    t,
    language,
    empty,
    text: (value: string | number | null | undefined): string =>
      value === null || value === undefined || value === '' ? empty : String(value),
    date: (value: string | null): string =>
      value === null ? empty : schoolDateText(value, language),
    moment: (value: string | null): string =>
      value === null ? empty : formatMomentIn(language, value, report.branch.timeZone),
    yesNo: (value: boolean): string => (value ? t('audit.yes') : t('audit.no')),
  };
}

type Words = ReturnType<typeof useWords>;

/** One part of the report: a heading and its terms, kept together on a printed page where it fits. */
function Part({ title, rows }: { title: string; rows: readonly Row[] }) {
  return (
    <section className="grid gap-2 break-inside-avoid">
      <h3 className={SECTION_TITLE}>{title}</h3>
      <dl className="grid grid-cols-[minmax(10rem,auto)_1fr] gap-x-6 gap-y-1 text-sm max-sm:grid-cols-1">
        {rows.map(([label, value], index) => (
          // Two rows may share a label (two contracts); the order is fixed.
          <div key={`${label}-${String(index)}`} className="contents">
            <dt className="text-muted-foreground print:text-current">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A part made of several records (relatives, roles), each with its own terms. */
function Records({
  title,
  records,
  none,
}: {
  title: string;
  records: readonly { key: string; heading: string; rows: readonly Row[] }[];
  none: string;
}) {
  return (
    <section className="grid gap-3">
      <h3 className={SECTION_TITLE}>{title}</h3>
      {records.length === 0 ? (
        <p className="text-sm">{none}</p>
      ) : (
        records.map((record) => (
          <div key={record.key} className="grid gap-1 break-inside-avoid">
            <h4 className={SUBSECTION_TITLE}>{record.heading}</h4>
            <dl className="grid grid-cols-[minmax(10rem,auto)_1fr] gap-x-6 gap-y-1 text-sm max-sm:grid-cols-1">
              {record.rows.map(([label, value], index) => (
                <div key={`${label}-${String(index)}`} className="contents">
                  <dt className="text-muted-foreground print:text-current">{label}</dt>
                  <dd className="break-words">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))
      )}
    </section>
  );
}

const portalRows = (
  words: Words,
  account: { createdAt: string; switchedOn: boolean } | null,
): Row[] => {
  const { t } = words;
  return account === null
    ? [[t('people.report.portalAccount'), t('people.report.none')]]
    : [
        [t('people.report.createdAt'), words.moment(account.createdAt)],
        [
          t('people.report.portalAccount'),
          account.switchedOn ? t('people.report.switchedOn') : t('people.report.switchedOff'),
        ],
      ];
};

function StudentParts({ report, words }: { report: StudentReport; words: Words }) {
  const { t } = words;
  const s = report.student;
  return (
    <>
      <Part
        title={t('people.report.recordTitle')}
        rows={[
          [t('people.students.uid'), s.uid],
          [t('people.students.lastName'), s.lastName],
          [t('people.students.firstName'), s.firstName],
          [t('people.students.paternalName'), words.text(s.paternalName)],
          [t('people.students.sex'), t(`people.staff.sexes.${s.sex}`)],
          [t('people.students.grade'), String(s.grade)],
          [t('people.students.startsOn'), words.date(s.startsOn)],
          [t('people.students.phone'), words.text(s.phone === null ? null : phoneText(s.phone))],
          [t('people.students.email'), words.text(s.email)],
          [t('people.students.birthDate'), words.date(s.birthDate)],
          [
            t('people.students.documentType'),
            s.documentType === null
              ? words.empty
              : t(`people.students.documentTypes.${s.documentType}`),
          ],
          [t('people.students.documentNumber'), words.text(s.documentNumber)],
          [t('people.students.jshshir'), words.text(s.jshshir)],
          [t('people.students.address'), words.text(s.address)],
          [
            t('people.students.region'),
            s.region === null ? words.empty : t(`people.students.regions.${s.region}`),
          ],
          [t('people.students.previousSchool'), words.text(s.previousSchool)],
          [t('people.students.diagnosticScore'), words.text(s.diagnosticScore)],
        ]}
      />
      <Part
        title={t('people.report.contractTitle')}
        rows={[
          ...s.contracts.map((contract): Row => [
            t('people.students.contract'),
            t('people.students.contractText', {
              number: contract.number,
              date: words.date(contract.signedOn),
            }),
          ]),
          [
            t('people.students.scholarshipType'),
            t(`people.students.scholarshipTypes.${s.scholarship.type}`),
          ],
          [
            t('people.students.scholarshipCoverage'),
            s.scholarship.coverage === null
              ? words.empty
              : t(`people.students.scholarshipCoverages.${s.scholarship.coverage}`),
          ],
          [t('people.students.scholarshipAmount'), words.text(s.scholarship.amount)],
          [
            t('people.students.consentSignedOn'),
            s.consentSignedOn === null
              ? t('people.students.noConsent')
              : words.date(s.consentSignedOn),
          ],
        ]}
      />
      <Part
        title={t('people.report.statusTitle')}
        rows={s.statuses.map((row): Row => [
          t(`people.students.statuses.${row.status}`),
          [
            row.until === null
              ? t('people.report.fromDate', { from: words.date(row.from) })
              : t('people.report.period', {
                  from: words.date(row.from),
                  until: words.date(row.until),
                }),
            t(`people.students.causes.${row.cause}`),
            row.reason,
          ]
            .filter((part) => part !== null)
            .join('; '),
        ])}
      />
      <Part
        title={t('people.report.uidTitle')}
        rows={s.uids.map((row): Row => [
          row.uid,
          row.releasedAt === null
            ? t('people.report.fromDate', { from: words.moment(row.heldFrom) })
            : t('people.report.period', {
                from: words.moment(row.heldFrom),
                until: words.moment(row.releasedAt),
              }),
        ])}
      />
      {/* Task 3.3d: the records merged into this one, their values archived on the merge. */}
      {s.merged.length > 0 && (
        <Part
          title={t('people.report.mergedTitle')}
          rows={s.merged.flatMap((one): Row[] => [
            [
              t('people.report.mergedRecord', { uids: one.uids.join(', ') }),
              [words.moment(one.mergedAt), one.reason].join('; '),
            ],
            ...one.values.map((value): Row => [
              t(`people.students.merge.fields.${value.field}`),
              mergeValueText(t, words.language, value.field, value.value),
            ]),
          ])}
        />
      )}
      <Part title={t('people.report.portalTitle')} rows={portalRows(words, s.account)} />
      <Records
        title={t('people.report.relativesTitle')}
        none={t('people.report.none')}
        records={report.relatives.map((relative) => ({
          key: relative.id,
          heading: relative.fullName,
          rows: [
            [
              t('people.relatives.phone'),
              words.text(relative.phone === null ? null : phoneText(relative.phone)),
            ],
            [
              t('people.relatives.extraPhones'),
              relative.extraPhones.length === 0
                ? words.empty
                : relative.extraPhones.map(phoneText).join(', '),
            ],
            [t('people.relatives.workplace'), words.text(relative.workplace)],
            [t('people.relatives.email'), words.text(relative.email)],
            ...(relative.phoneInvalidSince === null
              ? []
              : [
                  [
                    t('people.report.phoneInvalidSince'),
                    words.moment(relative.phoneInvalidSince),
                  ] as Row,
                ]),
            ...(relative.archivedAt === null
              ? []
              : [[t('people.report.archivedAt'), words.moment(relative.archivedAt)] as Row]),
            ...(relative.merged ? [[t('people.report.merged'), t('audit.yes')] as Row] : []),
            ...relative.links.map((link) => linkRow(words, link)),
            ...portalRows(words, relative.account),
          ],
        }))}
      />
    </>
  );
}

/** One link of a relative to a student: relationship, switches and dates. */
function linkRow(
  words: Words,
  link: StudentReport['relatives'][number]['links'][number],
  student?: string,
): Row {
  const { t } = words;
  return [
    student ?? t('people.relatives.relationship'),
    [
      t(`people.relatives.relationships.${link.relationship}`),
      link.mainContact ? t('people.relatives.mainContact') : null,
      `${t('people.relatives.portalAccess')}: ${words.yesNo(link.portalAccess)}`,
      `${t('people.relatives.receivesNotices')}: ${words.yesNo(link.receivesNotices)}`,
      link.unlinkedAt === null
        ? t('people.report.linkedFrom', { from: words.moment(link.linkedAt) })
        : t('people.report.linkedPeriod', {
            from: words.moment(link.linkedAt),
            until: words.moment(link.unlinkedAt),
          }),
    ]
      .filter((part) => part !== null)
      .join('; '),
  ];
}

function StaffParts({ report, words }: { report: StaffReport; words: Words }) {
  const { t, language } = words;
  const s = report.staff;
  const account = report.account;
  const time = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return (
    <>
      <Part
        title={t('people.report.recordTitle')}
        rows={[
          [t('people.staff.staffId'), s.staffId],
          [t('people.staff.lastName'), s.lastName],
          [t('people.staff.firstName'), s.firstName],
          [t('people.staff.fatherName'), words.text(s.fatherName)],
          [t('people.staff.sex'), s.sex === null ? words.empty : t(`people.staff.sexes.${s.sex}`)],
          [t('people.staff.birthDate'), words.date(s.birthDate)],
          [t('people.staff.jshshir'), words.text(s.jshshir)],
          [
            t('people.staff.educationLevel'),
            s.educationLevel === null
              ? words.empty
              : t(`people.staff.educationLevels.${s.educationLevel}`),
          ],
          [t('people.staff.phone'), words.text(s.phone === null ? null : phoneText(s.phone))],
          [t('people.staff.email'), words.text(s.email)],
          [t('people.staff.admissionDate'), words.date(s.admissionDate)],
          [
            t('people.staff.contractType'),
            s.contractType === null
              ? words.empty
              : t(`people.staff.contractTypes.${s.contractType}`),
          ],
          [t('people.staff.contractDate'), words.date(s.contractDate)],
          [t('people.staff.weeklyLessons'), words.text(s.weeklyLessons)],
          [t('people.staff.dailyLessons'), words.text(s.dailyLessons)],
        ]}
      />
      <Part
        title={t('people.report.teachingTitle')}
        rows={[
          [
            t('people.staff.branches'),
            s.branches
              .map((branch) =>
                branch.main ? t('people.report.main', { name: branch.name }) : branch.name,
              )
              .join(', ') || words.empty,
          ],
          ...s.divisions.map((division): Row => [
            t('people.staff.divisions'),
            [
              nameOf(division.division, language),
              division.department === null ? null : nameOf(division.department, language),
            ]
              .filter((part) => part !== null)
              .join(' › ') + (division.main ? ` (${t('people.report.mainShort')})` : ''),
          ]),
          ...s.subjects.map((subject): Row => [
            t('people.staff.subjects'),
            `${nameOf(subject.subject, language)}: ${gradeRanges(subject.grades)}`,
          ]),
          [
            t('people.staff.languagesTitle'),
            s.languages.map((code) => t(`people.staff.languages.${code}`)).join(', ') ||
              words.empty,
          ],
        ]}
      />
      <Part
        title={t('people.report.statusTitle')}
        rows={s.statuses.map((row): Row => [
          t(`people.staff.statuses.${row.status}`),
          row.until === null
            ? t('people.report.fromDate', { from: words.date(row.from) })
            : t('people.report.period', {
                from: words.date(row.from),
                until: words.date(row.until),
              }),
        ])}
      />
      <Records
        title={t('people.availability.title')}
        none={t('people.report.none')}
        records={s.availability.map((entry, index) => ({
          key: `${entry.branch}-${entry.from}-${String(index)}`,
          heading: `${entry.branch}, ${
            entry.until === null
              ? t('people.report.fromDate', { from: words.date(entry.from) })
              : t('people.report.period', {
                  from: words.date(entry.from),
                  until: words.date(entry.until),
                })
          }`,
          rows:
            entry.ranges.length === 0
              ? [[t('people.availability.noHours'), words.empty]]
              : entry.ranges.map((range): Row => [
                  weekdayName(language, range.weekday as Weekday),
                  `${time(range.startMinutes)}–${time(range.endMinutes)}`,
                ]),
        }))}
      />
      <Part
        title={t('people.report.samePersonTitle')}
        rows={[
          [
            t('people.relatives.fullName'),
            report.sameAsRelative === null
              ? t('people.report.none')
              : report.sameAsRelative.fullName,
          ],
        ]}
      />
      <Part
        title={t('people.report.accountTitle')}
        rows={
          account === null
            ? [[t('people.account.login'), t('people.report.none')]]
            : [
                [t('people.account.login'), account.login],
                [t('people.report.createdAt'), words.moment(account.createdAt)],
                [t('people.report.lastSignInAt'), words.moment(account.lastSignInAt)],
                [t('people.report.neverUsed'), words.yesNo(account.neverUsed)],
                [
                  t('people.report.language'),
                  isLanguage(account.language)
                    ? LANGUAGE_NAMES[account.language]
                    : account.language,
                ],
                [t('people.report.lockedAt'), words.moment(account.lockedAt)],
                [t('people.report.lockReason'), words.text(account.lockReason)],
                [t('people.report.mustChangePassword'), words.yesNo(account.mustChangePassword)],
                [t('people.report.passwordChangedAt'), words.moment(account.passwordChangedAt)],
                [t('people.report.passwordResetAt'), words.moment(account.passwordResetAt)],
                [t('people.report.secondStep'), words.yesNo(account.secondStepOn)],
              ]
        }
      />
      {account !== null && (
        <Part
          title={t('people.report.rolesTitle')}
          rows={account.roles.map((role): Row => [
            t(`roles.${role.role}`),
            [
              role.branch,
              role.until === null
                ? t('people.report.fromDate', { from: words.moment(role.from) })
                : t('people.report.period', {
                    from: words.moment(role.from),
                    until: words.moment(role.until),
                  }),
              role.subjects
                .map(
                  (subject) =>
                    `${nameOf(subject.subject, language)} (${
                      subject.until === null
                        ? t('people.report.fromDate', { from: words.moment(subject.from) })
                        : t('people.report.period', {
                            from: words.moment(subject.from),
                            until: words.moment(subject.until),
                          })
                    })`,
                )
                .join(', ') || null,
            ]
              .filter((part) => part !== null)
              .join('; '),
          ])}
        />
      )}
    </>
  );
}

function RelativeParts({ report, words }: { report: RelativeReport; words: Words }) {
  const { t } = words;
  const r = report.relative;
  return (
    <>
      <Part
        title={t('people.report.recordTitle')}
        rows={[
          [t('people.relatives.fullName'), r.fullName],
          [t('people.relatives.phone'), words.text(r.phone === null ? null : phoneText(r.phone))],
          [
            t('people.relatives.extraPhones'),
            r.extraPhones.length === 0 ? words.empty : r.extraPhones.map(phoneText).join(', '),
          ],
          [t('people.relatives.workplace'), words.text(r.workplace)],
          [t('people.relatives.email'), words.text(r.email)],
          [t('people.report.phoneInvalidSince'), words.moment(r.phoneInvalidSince)],
          [t('people.report.archivedAt'), words.moment(r.archivedAt)],
        ]}
      />
      <Part
        title={t('people.report.samePersonTitle')}
        rows={[
          [
            t('people.relatives.fullName'),
            report.samePerson === null ? t('people.report.none') : report.samePerson.name,
          ],
          ...(report.samePerson === null
            ? []
            : [[t('people.staff.staffId'), words.text(report.samePerson.staffId)] as Row]),
        ]}
      />
      <Part
        title={t('people.report.linksTitle')}
        rows={report.links.map((link) =>
          linkRow(
            words,
            link,
            `${listName(link.student)}, ${link.student.uid}, ${link.student.branch}`,
          ),
        )}
      />
      <Part title={t('people.report.portalTitle')} rows={portalRows(words, r.account)} />
    </>
  );
}

/** The audit entries about the person, newest first, with their values (decision 7). */
function Entries({ report, words }: { report: PersonalDataReport; words: Words }) {
  const { t, i18n } = useTranslation();
  const lines = (entry: AuditEntryAnswer): string[] => {
    const { labelOf, valueOf } = entryFormatOf(t, i18n, entry);
    const { before, after, paths, details } = valueLeavesOf(entry);
    const at = (kind: 'oldValue' | 'newValue' | 'details', path: string) =>
      `${kind}${path === '' ? '' : `.${path}`}`;
    return [
      ...paths.map((path) => {
        const label = labelOf(path, 'newValue');
        const old = before.has(path) ? valueOf(before.get(path), at('oldValue', path)) : null;
        const now = after.has(path) ? valueOf(after.get(path), at('newValue', path)) : null;
        return `${label}: ${[old, now].filter((part) => part !== null).join(' → ')}`;
      }),
      ...[...details.entries()].map(
        ([path, value]) => `${labelOf(path, 'details')}: ${valueOf(value, at('details', path))}`,
      ),
    ];
  };
  return (
    <section className="grid gap-3">
      <h3 className={SECTION_TITLE}>{t('people.report.entriesTitle')}</h3>
      {report.entries.length === 0 ? (
        <p className="text-sm">{t('people.report.noEntries')}</p>
      ) : (
        <ol className="grid gap-3 text-sm">
          {report.entries.map((entry) => (
            <li key={entry.id} className="grid gap-0.5 break-inside-avoid">
              <p className="font-semibold">
                {words.moment(entry.occurredAt)} · {actionName(t, entry.action)}
              </p>
              <p>
                {[
                  `${t('audit.by')}: ${
                    entry.actor === null
                      ? t('audit.system')
                      : (entry.actor.name ?? t('audit.unnamed'))
                  }${entry.assignment === null ? '' : ` (${t(`roles.${entry.assignment.role}`)})`}`,
                  entry.record === null
                    ? null
                    : `${t('audit.record')}: ${[
                        recordTypeName(t, entry.record.type),
                        entry.record.name,
                      ]
                        .filter((part) => part !== null)
                        .join(': ')}`,
                  entry.reason === null ? null : `${t('audit.reason')}: ${entry.reason}`,
                ]
                  .filter((part) => part !== null)
                  .join(' · ')}
              </p>
              {lines(entry).map((line, index) => (
                <p key={`${entry.id}-${String(index)}`} className="break-words">
                  {line}
                </p>
              ))}
            </li>
          ))}
        </ol>
      )}
      {report.entriesLeftOut !== null && (
        <p className="text-sm">
          {t('people.report.entriesLeftOut', {
            count: report.entriesLeftOut.count,
            moment: words.moment(report.entriesLeftOut.oldestAt),
          })}
        </p>
      )}
    </section>
  );
}

/** The name of the person, as the title of the report. */
function personName(report: PersonalDataReport): string {
  if (report.kind === 'student') {
    return listName(report.student);
  }
  if (report.kind === 'staff') {
    return listName(report.staff);
  }
  return report.relative.fullName;
}

/**
 * The report as a document (docs/design-system.md, Printouts): one table whose
 * header group holds the letterhead, so that a browser repeats the strip at
 * the top of each printed page (decision 9); then the person and every part.
 */
function ReportSheet({ report }: { report: PersonalDataReport }) {
  const words = useWords(report);
  const { t } = words;
  const { branchId } = useView();
  const name = personName(report);
  const photo =
    report.kind === 'student'
      ? report.student.photoId === null
        ? null
        : studentPhotoQuery(branchId, report.student.id, report.student.photoId)
      : report.kind === 'staff'
        ? report.staff.photoId === null
          ? null
          : staffPhotoQuery(branchId, report.staff.id, report.staff.photoId)
        : undefined;
  const [first, last] =
    report.kind === 'student'
      ? [report.student.firstName, report.student.lastName]
      : report.kind === 'staff'
        ? [report.staff.firstName, report.staff.lastName]
        : [report.relative.fullName, ''];
  return (
    <table className="w-full border-collapse" data-report="">
      <thead className="table-header-group">
        <tr>
          <td className="pb-6">
            <Letterhead />
          </td>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            {/* A table cell stays a cell, so that the header group repeats in print. */}
            <div className="grid gap-6">
              <header className="flex flex-wrap items-center gap-4">
                {photo !== undefined && (
                  <PersonPhoto
                    name={name}
                    initials={initialsOf(first, last)}
                    photo={photo}
                    size="lg"
                  />
                )}
                <div className="grid gap-1">
                  <h2 className={SECTION_TITLE}>{name}</h2>
                  <p className="text-sm">
                    {t('people.report.produced', {
                      moment: words.moment(report.producedAt),
                      name: report.producedBy ?? t('audit.unnamed'),
                      branch: report.branch.name,
                    })}
                  </p>
                </div>
              </header>
              {report.kind === 'student' && <StudentParts report={report} words={words} />}
              {report.kind === 'staff' && <StaffParts report={report} words={words} />}
              {report.kind === 'relative' && <RelativeParts report={report} words={words} />}
              <Entries report={report} words={words} />
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Starts the browser's print of the report alone, and clears the mode afterwards. */
function usePrint(): { printing: boolean; print: () => void } {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) {
      return undefined;
    }
    document.body.dataset.printing = PRINTING;
    const done = () => {
      setPrinting(false);
    };
    window.addEventListener('afterprint', done);
    window.print();
    return () => {
      window.removeEventListener('afterprint', done);
      delete document.body.dataset.printing;
    };
  }, [printing]);
  const print = useCallback(() => {
    setPrinting(true);
  }, []);
  return { printing, print };
}

/**
 * The personal data report of a person (task 2.6b, pull request #76;
 * edge-cases/people-roles-accounts: "The Super Admin can produce a personal
 * data report per person"). Each open produces the report once, an export
 * the server logs (decision 8): the call starts from an effect guarded by the
 * person it was made for, so a second run of the effect (React's StrictMode)
 * makes no second report. The answer holds Identity, so it stays in the
 * state of this page only: the mutation keeps nothing (`gcTime: 0`) and does
 * not go through the offline queue (`.claude/rules/web.md`, the secret rule).
 */
export function PersonalDataReportPage({ kind, id }: { kind: PersonalDataKind; id: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { printing, print } = usePrint();
  const [report, setReport] = useState<PersonalDataReport | null>(null);
  const produce = useMutation({
    gcTime: 0,
    mutationFn: () => producePersonalDataReport(kind, id),
  });
  const { mutateAsync } = produce;
  const made = useRef<string | null>(null);

  const run = useCallback(() => {
    setReport(null);
    mutateAsync().then(setReport, () => {
      // Shown by the state of the mutation, with a retry.
    });
  }, [mutateAsync]);

  useEffect(() => {
    const key = `${kind}:${id}`;
    if (made.current === key) {
      return;
    }
    made.current = key;
    run();
  }, [kind, id, run]);

  const list = LISTS[kind];
  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('people.report.title')}
        breadcrumbs={[
          { label: t('people.title'), to: '/people' },
          { label: t(`people.report.lists.${kind}`), to: list },
        ]}
        actions={
          <>
            <Button type="button" disabled={report === null} onClick={print}>
              {t('people.report.print')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void navigate({ to: list });
              }}
            >
              {t('people.report.close')}
            </Button>
          </>
        }
      />
      <div className={PANEL}>
        {produce.isError ? (
          <ErrorState error={produce.error} onRetry={run} />
        ) : report === null ? (
          <LoadingOutline />
        ) : (
          <ReportSheet report={report} />
        )}
      </div>
      {/* The copy that prints, beside the page, only while the browser prints it. */}
      {report !== null &&
        printing &&
        createPortal(
          <div data-report-sheet="" aria-hidden className="hidden">
            <ReportSheet report={report} />
          </div>,
          document.body,
        )}
    </div>
  );
}
