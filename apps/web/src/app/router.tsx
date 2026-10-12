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
import { HomePage } from '@/features/access/home-page';
import { AccountPage } from '@/features/auth/account-page';
import { CodePage } from '@/features/auth/code-page';
import { PasswordPage } from '@/features/auth/password-page';
import { sessionQuery, STEP_PATH, stepOf, type Step } from '@/features/auth/session';
import { SetUpPage } from '@/features/auth/set-up-page';
import { SampleListPage, sampleSearch } from '@/features/sample/sample-list-page';
import { BranchPage } from '@/features/setup/branch-page';
import { BuildingsPage } from '@/features/setup/buildings-page';
import { DivisionsPage } from '@/features/setup/divisions-page';
import { SubjectsPage } from '@/features/setup/subjects-page';
import { PeoplePage } from '@/features/people/people-page';
import { StaffPage } from '@/features/people/staff-page';
import { VacanciesPage } from '@/features/people/vacancies-page';
import { YearsPage } from '@/features/setup/years-page';
import { SlotTypesPage } from '@/features/setup/slot-types-page';
import { CalendarPage } from '@/features/setup/calendar-page';
import { SettingsPage } from '@/features/setup/settings-page';
import { TravelTimesPage } from '@/features/setup/travel-times-page';
import { DayTemplatesPage } from '@/features/setup/day-templates-page';
import { TemplateSettingsPage } from '@/features/setup/template-settings-page';
import { RoomsPage } from '@/features/setup/rooms-page';
import { SetupPage } from '@/features/setup/setup-page';
import { listSearch } from '@/components/list/list-state';
import { SignInPage } from '@/features/auth/sign-in-page';
import { AppLayout } from './app-layout';
import { AuthPendingPage, ErrorPage, NotFoundPage, PendingPage } from './pages';

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

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  // `ended`: the session was over when the person tried to go on.
  validateSearch: (search: Record<string, unknown>): { reason?: 'ended' } =>
    search.reason === 'ended' ? { reason: 'ended' } : {},
  beforeLoad: only('sign_in'),
  component: SignInPage,
  pendingComponent: AuthPendingPage,
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

const branchRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/branch',
  component: BranchPage,
});

const buildingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/buildings',
  validateSearch: listSearch,
  component: BuildingsPage,
});

const roomsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/rooms',
  validateSearch: listSearch,
  component: RoomsPage,
});

const divisionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/divisions',
  validateSearch: listSearch,
  component: DivisionsPage,
});

/** Subjects and their weights (task 2.1). */
const subjectsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/subjects',
  validateSearch: listSearch,
  component: SubjectsPage,
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
  component: StaffPage,
});

/** The vacancies, the second section of the teacher list (task 2.2b). */
const vacanciesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/people/vacancies',
  validateSearch: listSearch,
  component: VacanciesPage,
});

const yearsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/years',
  validateSearch: listSearch,
  component: YearsPage,
});

const slotTypesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/slot-types',
  validateSearch: listSearch,
  component: SlotTypesPage,
});

const dayTemplatesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/day-templates',
  validateSearch: listSearch,
  component: DayTemplatesPage,
});

const templateSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/day-template-settings',
  validateSearch: listSearch,
  component: TemplateSettingsPage,
});

const calendarRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/calendar',
  validateSearch: listSearch,
  component: CalendarPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/settings',
  component: SettingsPage,
});

const travelTimesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/setup/travel-times',
  component: TravelTimesPage,
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
  codeRoute,
  passwordRoute,
  setUpRoute,
  appRoute.addChildren([
    homeRoute,
    accountRoute,
    ownPasswordRoute,
    setupRoute,
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
    peopleRoute,
    staffRoute,
    vacanciesRoute,
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
    defaultNotFoundComponent: NotFoundPage,
    ...(history === undefined ? {} : { history }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
