import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  notFound,
  Outlet,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import { personalDataKindSchema, type Action, type Area } from '@sodiq/shared';
import { HomePage } from '@/features/access/home-page';
import { AccountPage } from '@/features/auth/account-page';
import { AuditPage } from '@/features/audit/audit-page';
import { auditSearch } from '@/features/audit/audit-search';
import { ForcedDeletesPage } from '@/features/audit/forced-deletes-page';
import { CodePage } from '@/features/auth/code-page';
import { ForgotPasswordPage } from '@/features/auth/forgot-password-page';
import { ResetPasswordPage } from '@/features/auth/reset-password-page';
import { PasswordPage } from '@/features/auth/password-page';
import { sessionQuery, STEP_PATH, stepOf, type Step } from '@/features/auth/session';
import { SetUpPage } from '@/features/auth/set-up-page';
import { SampleListPage, sampleSearch } from '@/features/sample/sample-list-page';
import { BranchPage } from '@/features/setup/branch-page';
import { BranchesPage } from '@/features/setup/branches-page';
import { BuildingsPage } from '@/features/setup/buildings-page';
import { DivisionsPage } from '@/features/setup/divisions-page';
import { SubjectsPage } from '@/features/setup/subjects-page';
import { ClassesPage } from '@/features/classes/classes-page';
import { GroupPlacementPage } from '@/features/classes/group-placement-page';
import { GroupsPage } from '@/features/classes/groups-page';
import { LoadPage } from '@/features/timetable/load-page';
import { loadSearch } from '@/features/timetable/load-search';
import { BuilderPage } from '@/features/timetable/builder-page';
import { builderSearch } from '@/features/timetable/builder-search';
import { TimetablePage } from '@/features/timetable/timetable-page';
import { DayPage } from '@/features/timetable/day-page';
import { daySearch } from '@/features/timetable/day-search';
import { AbsencesPage } from '@/features/timetable/absences-page';
import { RoomClosuresPage } from '@/features/timetable/room-closures-page';
import { VersionsPage } from '@/features/timetable/versions-page';
import { ExamsPage } from '@/features/timetable/exams-page';
import { examsSearch } from '@/features/timetable/exams-search';
import { HeadTeachersPage } from '@/features/people/head-teachers-page';
import { NeverUsedPage } from '@/features/people/never-used-page';
import { ResetEntriesPage, resetEntriesSearch } from '@/features/people/reset-entries-page';
import { PeoplePage } from '@/features/people/people-page';
import { PersonalDataReportPage } from '@/features/people/personal-data-report-page';
import { StaffPage } from '@/features/people/staff-page';
import { StudentsPage } from '@/features/people/students-page';
import { ParentsPage } from '@/features/people/parents-page';
import { VacanciesPage } from '@/features/people/vacancies-page';
import { YearsPage } from '@/features/setup/years-page';
import { SlotTypesPage } from '@/features/setup/slot-types-page';
import { CalendarPage } from '@/features/setup/calendar-page';
import { SettingsPage } from '@/features/setup/settings-page';
import { TravelTimesPage } from '@/features/setup/travel-times-page';
import { DayTemplatesPage } from '@/features/setup/day-templates-page';
import { TemplateSettingsPage } from '@/features/setup/template-settings-page';
import { RoomsPage, roomsSearch } from '@/features/setup/rooms-page';
import { SetupPage } from '@/features/setup/setup-page';
import { listSearch } from '@/components/list/list-state';
import { SignInPage } from '@/features/auth/sign-in-page';
import { JournalPage } from '@/features/journal/journal-page';
import { journalSearch, journalsSearch } from '@/features/journal/journal-search';
import { JournalsPage } from '@/features/journal/journals-page';
import { ViewsPage } from '@/features/timetable/views-page';
import { viewsSearch } from '@/features/timetable/views-search';
import { AppLayout } from './app-layout';
import { useMayView } from '@/features/access/use-view';
import { AuthPendingPage, ErrorPage, NoAccessPage, NotFoundPage, PendingPage } from './pages';

interface RouterContext {
  queryClient: QueryClient;
}

/**
 * A page opens only for a session that stands at one of these steps; any other
 * session is sent to the page of its own step. This is for the person's
 * convenience: the server refuses every route a session may not call yet.
 */
function only(...steps: Step[]) {
  return async ({ context }: { context: RouterContext }): Promise<void> => {
    const step = stepOf(await context.queryClient.fetchQuery(sessionQuery));
    if (!steps.includes(step)) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's way to redirect
      throw redirect({ to: STEP_PATH[step] });
    }
  };
}

/**
 * A page of one area opens only when an assignment of the person permits that
 * area in the branch of the tab; otherwise the full-page "no access" screen,
 * and none of the page's calls is made (issue #39, hand test of 13 October
 * 2026, finding 4). The check is drawn by the route's component because the
 * branch of the tab lives in the view store of the shell. Display only: the
 * server refuses the calls anyway.
 */
function guarded(area: Area, Page: () => React.JSX.Element, action: Action = 'view') {
  return function Guarded() {
    return useMayView(area, action) ? <Page /> : <NoAccessPage inLayout />;
  };
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: () => <NotFoundPage />,
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  // `ended`: the session was over when the person tried to go on;
  // `password_changed`: a new password was chosen with a reset link (2.3c-2);
  // `signed_out`: the person signed out, or removed this trusted device (2.7a).
  validateSearch: (
    search: Record<string, unknown>,
  ): { reason?: 'ended' | 'password_changed' | 'signed_out' } =>
    search.reason === 'ended' ||
    search.reason === 'password_changed' ||
    search.reason === 'signed_out'
      ? { reason: search.reason }
      : {},
  beforeLoad: only('sign_in'),
  component: SignInPage,
  pendingComponent: AuthPendingPage,
});

/** "Forgot your password?" (task 2.3c-2): before sign-in only. */
const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  beforeLoad: only('sign_in'),
  component: ForgotPasswordPage,
  pendingComponent: AuthPendingPage,
});

/**
 * The link of the reset mail (task 2.3c-2). Open in any state: the routes it
 * calls are public, and a person signed in on this browser may follow a link
 * for their account all the same.
 */
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  component: ResetPasswordPage,
});

const codeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in/code',
  beforeLoad: only('code'),
  component: CodePage,
  pendingComponent: AuthPendingPage,
});

const passwordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/password',
  // The forced change, while a first or reset password is in use. By choice the
  // page is inside the layout (task 0.8d); a bookmark of this address still
  // lands there.
  beforeLoad: async ({ context }): Promise<void> => {
    const step = stepOf(await context.queryClient.fetchQuery(sessionQuery));
    if (step === 'none') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's way to redirect
      throw redirect({ to: '/account/password' });
    }
    if (step !== 'password') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's way to redirect
      throw redirect({ to: STEP_PATH[step] });
    }
  },
  component: PasswordPage,
  pendingComponent: AuthPendingPage,
});

const setUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/second-step/set-up',
  beforeLoad: only('set_up'),
  component: SetUpPage,
  pendingComponent: AuthPendingPage,
});

/** Every page inside the app layout needs a session that owes no step. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: only('none'),
  component: AppLayout,
});

const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: HomePage,
});

/** The own account (task 0.8d): sessions, trusted devices, the second step, the language. */
const accountRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/account',
  component: AccountPage,
});

/** The password change by choice, inside the layout; the forced one is `/password`. */
const ownPasswordRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/account/password',
  component: PasswordPage,
});

/** School setup (task 1.1): the branch record, buildings and floors, rooms; divisions and departments (task 1.2); academic years (task 1.3); slot types, day templates and where they apply (task 1.5). */
const setupRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup',
  component: SetupPage,
});

/**
 * The Branches list (task 2.7c-3): the Super Admin's, on `branches` `create`,
 * which a Super Admin passes before the first branch exists.
 */
const branchesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/branches',
  validateSearch: listSearch,
  component: guarded('branches', BranchesPage, 'create'),
});

const branchRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/branch',
  component: guarded('branches', BranchPage),
});

const buildingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/buildings',
  validateSearch: listSearch,
  component: guarded('rooms', BuildingsPage),
});

const roomsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/rooms',
  validateSearch: roomsSearch,
  component: guarded('rooms', RoomsPage),
});

const divisionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/divisions',
  validateSearch: listSearch,
  component: guarded('divisions', DivisionsPage),
});

/** Subjects and their weights (task 2.1). */
const subjectsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/subjects',
  validateSearch: listSearch,
  component: guarded('subjects', SubjectsPage),
});

/** Classes and their Tutors (task 3.1a). */
const classesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/classes',
  validateSearch: listSearch,
  component: guarded('classes', ClassesPage),
});

/** Groups and splits (task 3.2a), under the Classes item of the menu. */
const groupsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/groups',
  validateSearch: listSearch,
  component: guarded('groups', GroupsPage),
});

/** The bulk placement into groups (task 3.2b), for the roles that place. */
const groupPlacementRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/groups/placement',
  validateSearch: listSearch,
  component: guarded('groups', GroupPlacementPage, 'edit'),
});

/** The entry of the Timetable item (task 3.4a). */
const timetableRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/timetable',
  component: guarded('timetable', TimetablePage),
});

/** The teaching load of a version (task 3.4a). */
const loadRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/timetable/load',
  validateSearch: loadSearch,
  component: guarded('timetable', LoadPage),
});

/** The draft builder, steps 1 to 4 (task 5.3a). */
const builderRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/timetable/builder',
  validateSearch: builderSearch,
  component: guarded('timetable', BuilderPage),
});

/** Day changes: the one-day cancel and restore of a class's lessons (task 5.6a-1). */
const dayRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/timetable/day',
  validateSearch: daySearch,
  component: guarded('timetable', DayPage),
});

/** Exams of a date (task 5.6c-2). */
const examsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/timetable/exams',
  validateSearch: examsSearch,
  component: guarded('timetable', ExamsPage),
});

/** Teacher absences (task 5.7a-1). */
const absencesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/timetable/absences',
  validateSearch: listSearch,
  component: guarded('timetable', AbsencesPage),
});

/** Room closures (task 5.7a-2b). */
const roomClosuresRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/timetable/room-closures',
  validateSearch: listSearch,
  component: guarded('timetable', RoomClosuresPage),
});

/** The read-only timetable views by class, teacher, room and school (task 5.9a). */
const viewsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/timetable/views',
  validateSearch: viewsSearch,
  component: guarded('timetable_views', ViewsPage),
});

/** The Journals page (task 6.2): tabs Classes and Groups, then the subject. */
const journalsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/journal',
  validateSearch: journalsSearch,
  component: guarded('journal', JournalsPage),
});

/** A journal for one quarter (task 6.2): the grid, or lesson mode. */
const journalRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/journal/$journalId',
  validateSearch: journalSearch,
  component: guarded('journal', JournalPage),
});

/** Version history (task 5.8a). */
const versionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/timetable/versions',
  validateSearch: listSearch,
  component: guarded('timetable', VersionsPage),
});

/** People (task 2.2a): the entry of the menu item and the staff list. */
const peopleRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/people',
  component: PeoplePage,
});

const staffRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/people/staff',
  validateSearch: listSearch,
  component: guarded('staff', StaffPage),
});

/** The students of the branch (task 2.4a). */
const studentsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/people/students',
  validateSearch: listSearch,
  component: guarded('students', StudentsPage),
});

/** The relatives of the students of the branch, the Parents (task 2.5a). */
const parentsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/people/parents',
  validateSearch: listSearch,
  component: guarded('relatives', ParentsPage),
});

/** The vacancies, the second section of the teacher list (task 2.2b). */
const vacanciesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/people/vacancies',
  validateSearch: listSearch,
  component: guarded('vacancies', VacanciesPage),
});

/** The Head Teachers of the branch, the third section of People (task 2.3b-2). */
const headTeachersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/people/head-teachers',
  validateSearch: listSearch,
  component: guarded('head_teachers', HeadTeachersPage),
});

/**
 * The personal data report of a student, a staff member or a parent (task
 * 2.6b): opened from the panel by the Super Admin; the server decides who
 * reaches it. An unknown kind is no page.
 */
const personalDataRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/people/report/$kind/$id',
  component: guarded('personal_data_report', PersonalDataRouteView, 'export'),
});

function PersonalDataRouteView() {
  const { kind, id } = personalDataRoute.useParams();
  const parsed = personalDataKindSchema.safeParse(kind);
  if (!parsed.success) {
    return <NotFoundPage inLayout />;
  }
  // A new person is a new page: the report is produced once per person.
  return <PersonalDataReportPage key={`${parsed.data}:${id}`} kind={parsed.data} id={id} />;
}

// The Audit log (task 2.6a): the list state and the search the server answers.
const auditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/audit',
  validateSearch: auditSearch,
  component: guarded('audit_log', AuditPage),
});

// The lessons the Super Admin deleted for good, restorable for 30 days (task 5.8b).
const forcedDeletesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/forced-deletes',
  validateSearch: listSearch,
  component: guarded('forced_deletes', ForcedDeletesPage),
});

/** The accounts never used of the branch, a section of People (task 2.3c-1). */
const neverUsedRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/people/never-used',
  validateSearch: listSearch,
  component: guarded('account_access', NeverUsedPage),
});

/** The entries after a password reset of the branch, a section of People (task 6.1c). */
const resetEntriesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/people/reset-entries',
  validateSearch: resetEntriesSearch,
  component: guarded('account_access', ResetEntriesPage),
});

const yearsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/years',
  validateSearch: listSearch,
  component: guarded('academic_years', YearsPage),
});

const slotTypesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/slot-types',
  validateSearch: listSearch,
  component: guarded('day_templates', SlotTypesPage),
});

const dayTemplatesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/day-templates',
  validateSearch: listSearch,
  component: guarded('day_templates', DayTemplatesPage),
});

const templateSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/day-template-settings',
  validateSearch: listSearch,
  component: guarded('day_templates', TemplateSettingsPage),
});

const calendarRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/calendar',
  validateSearch: listSearch,
  component: guarded('calendar', CalendarPage),
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/settings',
  component: guarded('settings', SettingsPage),
});

const travelTimesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/travel-times',
  component: guarded('branches', TravelTimesPage),
});

/**
 * The sample list of task 0.8b-1, built only from the shared pieces. It opens
 * in development and in the tests; in the built app the address does not
 * exist, and the bundler leaves the page out.
 */
const patternsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/dev/patterns',
  validateSearch: sampleSearch,
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's way to say "no such page"
      throw notFound();
    }
  },
  component: import.meta.env.DEV ? SampleListPage : NotFoundPage,
});

const routeTree = rootRoute.addChildren([
  signInRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  codeRoute,
  passwordRoute,
  setUpRoute,
  appRoute.addChildren([
    homeRoute,
    accountRoute,
    ownPasswordRoute,
    setupRoute,
    branchesRoute,
    branchRoute,
    buildingsRoute,
    roomsRoute,
    divisionsRoute,
    yearsRoute,
    slotTypesRoute,
    calendarRoute,
    dayTemplatesRoute,
    templateSettingsRoute,
    settingsRoute,
    travelTimesRoute,
    subjectsRoute,
    classesRoute,
    groupsRoute,
    groupPlacementRoute,
    timetableRoute,
    builderRoute,
    dayRoute,
    examsRoute,
    absencesRoute,
    roomClosuresRoute,
    versionsRoute,
    viewsRoute,
    journalsRoute,
    journalRoute,
    loadRoute,
    peopleRoute,
    staffRoute,
    studentsRoute,
    parentsRoute,
    vacanciesRoute,
    headTeachersRoute,
    neverUsedRoute,
    resetEntriesRoute,
    auditRoute,
    forcedDeletesRoute,
    personalDataRoute,
    patternsRoute,
  ]),
]);

/** `history` is given by tests; the browser's own is used otherwise. */
export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPendingComponent: PendingPage,
    defaultErrorComponent: ErrorPage,
    defaultNotFoundComponent: () => <NotFoundPage />,
    ...(history === undefined ? {} : { history }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
