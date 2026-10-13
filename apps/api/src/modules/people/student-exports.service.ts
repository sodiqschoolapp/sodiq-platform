import { Inject, Injectable } from '@nestjs/common';
import {
  listName,
  phoneText,
  STUDENT_EXPORT_GROUPS,
  type Clock,
  type DocumentType,
  type ExportTexts,
  type Region,
  type Relationship,
  type ScholarshipCoverage,
  type ScholarshipType,
  type StudentExport,
  type StudentExportColumn,
  type StudentListItem,
} from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { XlsxFile } from '../../http/xlsx.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { exportList, oneCell, type ExportColumn } from '../audit/export-list.js';
import { assignmentForGroups, exportGroupsOf } from './student-export.js';
import { Students } from './students.service.js';

/** A row of the student file: the list's row and the fields of the groups behind it. */
interface ExportRow {
  item: StudentListItem;
  phone: string | null;
  email: string | null;
  birth_date: string;
  document_type: string | null;
  document_number: string | null;
  jshshir: string | null;
  address: string | null;
  region: string | null;
  previous_school: string | null;
  diagnostic_score: number | null;
  scholarship_type: string;
  scholarship_coverage: string | null;
  scholarship_amount: number | null;
  consent_signed_on: string | null;
  /** The newest contract (the latest id, decision 17 of pull request #68). */
  contract: { number: string; signed_on: string } | undefined;
  /** The live relatives of the student, the main contact first (task 2.5b-2). */
  relatives: ExportRelative[];
}

/** A relative linked live to a student, as the Contact columns write it (task 2.5b-2, decision 1). */
interface ExportRelative {
  fullName: string;
  relationship: Relationship;
  mainContact: boolean;
  phone: string | null;
  extraPhones: string[];
}

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('A student route works for the branch of the request.');
  }
  return access.branchId;
}

/** The filter key of the consent list (answer 23), as the list page names it. */
const CONSENT_FILTER = 'consent';

/**
 * The Excel file of the student list (task 2.4b-2, pull request #70;
 * `edge/people-roles-accounts`: "An export contains only what the role may
 * see ... Every export is logged with its filters and row count"). The rows
 * are read as the list reads them, in one transaction under the branch filter;
 * a column is written only when the account may export its group in the branch
 * of the request (decisions 1 to 3), the others are named in the audit entry's
 * `leftOut`.
 */
@Injectable()
export class StudentExports {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly students: Students,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async export(access: Access, request: StudentExport, requestId: string): Promise<XlsxFile> {
    const branchId = branchOf(access);
    const groups = exportGroupsOf(access);
    // Correction 1 of the review: the consent list is the Financial readers'.
    // Every exporter reads Financial today; this refusal guards the Tutor's
    // export of task 3.1, whose tests reach it (build plan, the line on 3.1).
    if (Object.hasOwn(request.filters, CONSENT_FILTER) && !groups.has('financial')) {
      throw new ApiException('permission_denied', 403);
    }
    return this.transactions.run(access.branchIds, async (transaction) => {
      const today = await this.students.todayIn(transaction, branchId);
      const items = await this.students.listItems(transaction, access, branchId, today);
      const fields = await transaction
        .selectFrom('students')
        .select([
          'id',
          'phone',
          'email',
          'birth_date',
          'document_type',
          'document_number',
          'jshshir',
          'address',
          'region',
          'previous_school',
          'diagnostic_score',
          'scholarship_type',
          'scholarship_coverage',
          'scholarship_amount',
          'consent_signed_on',
        ])
        .where('branch_id', '=', branchId)
        .execute();
      const contracts = new Map<string, { number: string; signed_on: string }>();
      for (const contract of await transaction
        .selectFrom('student_contracts')
        .select(['student_id', 'number', 'signed_on'])
        .where('branch_id', '=', branchId)
        .orderBy('id', 'desc')
        .execute()) {
        if (!contracts.has(contract.student_id)) {
          contracts.set(contract.student_id, contract);
        }
      }
      // The live links of the branch and the relatives they make visible, in
      // the order of the Relatives tab (`RelativeWrites.linksOf`).
      const relatives = new Map<string, ExportRelative[]>();
      for (const link of await transaction
        .selectFrom('student_relatives as l')
        .innerJoin('relatives as r', 'r.id', 'l.relative_id')
        .select([
          'l.student_id',
          'l.relationship',
          'l.main_contact',
          'r.full_name',
          'r.phone',
          'r.extra_phones',
        ])
        .where('l.branch_id', '=', branchId)
        .where('l.unlinked_at', 'is', null)
        .orderBy('l.student_id')
        .orderBy('l.main_contact', 'desc')
        .orderBy('l.linked_at')
        .orderBy('l.id')
        .execute()) {
        const own = relatives.get(link.student_id) ?? [];
        own.push({
          fullName: link.full_name,
          relationship: link.relationship as Relationship,
          mainContact: link.main_contact,
          phone: link.phone,
          extraPhones: link.extra_phones,
        });
        relatives.set(link.student_id, own);
      }
      const byId = new Map(fields.map((row) => [row.id, row]));
      const rows = new Map<string, ExportRow>();
      for (const item of items) {
        const row = byId.get(item.id);
        if (row !== undefined) {
          rows.set(item.id, {
            ...row,
            item,
            contract: contracts.get(item.id),
            relatives: relatives.get(item.id) ?? [],
          });
        }
      }
      return exportList(transaction, this.audit, this.clock, access, requestId, {
        list: 'students',
        action: 'student.export',
        request,
        rows,
        allowed: (column) => groups.has(STUDENT_EXPORT_GROUPS[column]),
        assignmentFor: (columns) =>
          assignmentForGroups(
            groups,
            new Set(columns.map((column) => STUDENT_EXPORT_GROUPS[column])),
          ),
        columns: STUDENT_EXPORT_SPECS,
      });
    });
  }
}

const heading =
  (column: StudentExportColumn) =>
  (texts: ExportTexts): string =>
    texts.students.columns[column];

const mainContactOf = (row: ExportRow): ExportRelative | undefined =>
  row.relatives.find((relative) => relative.mainContact);

/** The phones of a relative in one cell, separated by commas; empty without any. */
const phonesOf = (phones: readonly string[]): string | null =>
  phones.length === 0 ? null : phones.map(phoneText).join(', ');

const date = (value: string | null | undefined) =>
  value === null || value === undefined ? null : { date: value };

/**
 * The columns of the student file: the list's columns as the page writes them
 * (the class "Grade 7, no class" until task 3.1; the status with the planned
 * status and its first day), then the fields of the groups, with dates as
 * date cells and numbers as numbers (edge cases, system behaviour: "Excel
 * exports contain real numbers and dates").
 */
const STUDENT_EXPORT_SPECS: Readonly<Record<StudentExportColumn, ExportColumn<ExportRow>>> = {
  uid: oneCell(heading('uid'), (row) => row.item.uid),
  // Surname first in every list and export (owner's answer to finding 27).
  name: oneCell(heading('name'), (row) => listName(row.item)),
  class: oneCell(heading('class'), (row, texts) =>
    texts.student.gradeNoClass.replace(
      '{{grade}}',
      texts.grade.replace('{{grade}}', String(row.item.grade)),
    ),
  ),
  status: {
    headings: (texts) => [texts.students.columns.status, texts.plannedStatus, texts.plannedFrom],
    cells: (row, texts) => [
      row.item.status === null ? texts.student.notStarted : texts.student.statuses[row.item.status],
      row.item.planned === null ? null : texts.student.statuses[row.item.planned.status],
      row.item.planned === null ? null : { date: row.item.planned.from },
    ],
  },
  paternalName: oneCell(heading('paternalName'), (row) => row.item.paternalName),
  sex: oneCell(heading('sex'), (row, texts) => texts.student.sexes[row.item.sex]),
  grade: oneCell(heading('grade'), (row) => row.item.grade),
  startsOn: oneCell(heading('startsOn'), (row) => date(row.item.startsOn)),
  phone: oneCell(heading('phone'), (row) => (row.phone === null ? null : phoneText(row.phone))),
  email: oneCell(heading('email'), (row) => row.email),
  birthDate: oneCell(heading('birthDate'), (row) => date(row.birth_date)),
  documentType: oneCell(heading('documentType'), (row, texts) =>
    row.document_type === null
      ? null
      : texts.student.documentTypes[row.document_type as DocumentType],
  ),
  documentNumber: oneCell(heading('documentNumber'), (row) => row.document_number),
  jshshir: oneCell(heading('jshshir'), (row) => row.jshshir),
  address: oneCell(heading('address'), (row) => row.address),
  region: oneCell(heading('region'), (row, texts) =>
    row.region === null ? null : texts.student.regions[row.region as Region],
  ),
  contractNumber: oneCell(heading('contractNumber'), (row) => row.contract?.number ?? null),
  contractSignedOn: oneCell(heading('contractSignedOn'), (row) => date(row.contract?.signed_on)),
  scholarshipType: oneCell(
    heading('scholarshipType'),
    (row, texts) => texts.student.scholarshipTypes[row.scholarship_type as ScholarshipType],
  ),
  scholarshipCoverage: oneCell(heading('scholarshipCoverage'), (row, texts) =>
    row.scholarship_coverage === null
      ? null
      : texts.student.scholarshipCoverages[row.scholarship_coverage as ScholarshipCoverage],
  ),
  scholarshipAmount: oneCell(heading('scholarshipAmount'), (row) => row.scholarship_amount),
  previousSchool: oneCell(heading('previousSchool'), (row) => row.previous_school),
  diagnosticScore: oneCell(heading('diagnosticScore'), (row) => row.diagnostic_score),
  consentSignedOn: oneCell(heading('consentSignedOn'), (row) => date(row.consent_signed_on)),
  // Task 2.5b-2, decision 1 (Look first): the relatives, written only for the
  // Contact exporters. A relative with no phone of their own or no valid
  // phone has an empty phone cell; workplace and email are not exported.
  mainContactName: oneCell(
    heading('mainContactName'),
    (row) => mainContactOf(row)?.fullName ?? null,
  ),
  mainContactRelationship: oneCell(heading('mainContactRelationship'), (row, texts) => {
    const main = mainContactOf(row);
    return main === undefined ? null : texts.student.relationships[main.relationship];
  }),
  mainContactPhone: oneCell(heading('mainContactPhone'), (row) => {
    const phone = mainContactOf(row)?.phone;
    return phone === null || phone === undefined ? null : phoneText(phone);
  }),
  mainContactExtraPhones: oneCell(heading('mainContactExtraPhones'), (row) =>
    phonesOf(mainContactOf(row)?.extraPhones ?? []),
  ),
  // One line per other live relative: "Name (relationship): phones".
  otherRelatives: oneCell(heading('otherRelatives'), (row, texts) => {
    const lines = row.relatives
      .filter((relative) => !relative.mainContact)
      .map((relative) => {
        const named = `${relative.fullName} (${texts.student.relationships[relative.relationship]})`;
        const phones = phonesOf([
          ...(relative.phone === null ? [] : [relative.phone]),
          ...relative.extraPhones,
        ]);
        return phones === null ? named : `${named}: ${phones}`;
      });
    return lines.length === 0 ? null : lines.join('\n');
  }),
};
