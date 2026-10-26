export const ACCOUNTS_VARIABLE = 'SODIQ_E2E_ACCOUNTS';

/** A seeded account that nobody signed in to yet: its first password is still valid. */
export interface Credentials {
  login: string;
  password: string;
}

/** The keys of apps/api/src/testing/e2e/seed.ts. Each test has an account of its own. */
export type AccountKey =
  | 'uz'
  | 'ru'
  | 'en'
  | 'wrongPassword'
  | 'trust'
  | 'patterns'
  | 'forms'
  | 'vicePrincipal'
  | 'superAdmin'
  | 'divisions'
  | 'years'
  | 'templates'
  | 'calendar'
  | 'settings'
  | 'subjects'
  | 'staff'
  | 'staffExport'
  | 'staffPhoto'
  | 'accountAccess'
  | 'design'
  | 'brand'
  | 'shellTools'
  | 'switchers'
  | 'account'
  | 'accountSecondStep'
  | 'notifications'
  | 'emailReset'
  | 'students'
  | 'leaving'
  | 'studentExport'
  | 'auditVice'
  | 'auditPrincipal'
  | 'relatives'
  | 'phoneOwners'
  | 'phoneOwnersOther'
  | 'samePerson'
  | 'peopleTabs'
  | 'pages'
  | 'handTestUz'
  | 'handTestRu'
  | 'handTest35bForms'
  | 'handTest35bSwitch'
  | 'handTest35bSearch'
  | 'handTest35cStays'
  | 'classes'
  | 'groups'
  | 'groupMembers'
  | 'members'
  | 'topBar'
  | 'tutorScope'
  | 'recordSearch'
  | 'moves'
  | 'returns'
  | 'returnAugust'
  | 'branchMoves'
  | 'teachingLoad'
  | 'teachingBlocks'
  | 'draftBuilder'
  | 'draftGrid'
  | 'draftGridPanels'
  | 'draftGridSuggest'
  | 'draftLockHolder'
  | 'draftLockTaker'
  | 'draftGridUndo'
  | 'draftGridDouble'
  | 'draftGridMixed'
  | 'draftPublish'
  | 'buildWalk'
  | 'dayChanges'
  | 'exams'
  | 'absences'
  | 'roomClosures'
  | 'vacancyFill'
  | 'actingTeacher'
  | 'substitution'
  | 'absenceSubstitution'
  | 'versionHistory'
  | 'timetableViews'
  | 'timetableFiles'
  | 'versionFiles'
  | 'whoTeacher'
  | 'journalTeacher'
  | 'statusTeacher'
  | 'deliveryTeacher'
  | 'exportsPrincipal'
  | 'resultsPrincipal'
  | 'closingVice'
  | 'ratingPrincipal'
  | 'closeVice'
  | 'reopenVice'
  | 'attendanceTeacher'
  | 'attendanceTutor'
  | 'plansTeacher'
  | 'outcomesTeacher'
  | 'mastersTeacher'
  | 'mastersHead'
  | 'requestsTeacher'
  | 'requestsHead'
  | 'locksTeacher'
  | 'locksHead'
  | 'locksVice'
  | 'exemptionsTeacher'
  | 'exemptionsVice'
  | 'transfersTeacher'
  | 'transfersVice'
  | 'whoHeadTutor'
  | 'whoHeadTeacher';

/** Invented for the tests. */
export const NEW_PASSWORD = 'a-new-password-73';

export function accountOf(key: AccountKey): Credentials {
  const seeded: unknown = JSON.parse(process.env[ACCOUNTS_VARIABLE] ?? '{}');
  const account =
    typeof seeded === 'object' && seeded !== null
      ? (seeded as Record<string, Partial<Credentials> | undefined>)[key]
      : undefined;
  if (typeof account?.login !== 'string' || typeof account.password !== 'string') {
    throw new Error(`The seed command created no account "${key}".`);
  }
  return { login: account.login, password: account.password };
}
