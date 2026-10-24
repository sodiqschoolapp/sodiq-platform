/**
 * Who decides a plan edit request or a journal unlock request (task 7.2, pull request #215, review
 * decision 23; `02`, Head Teachers and Senior Head Teachers, "Who approves":
 * "A teacher's unlock or plan request goes to the Head Teacher of the subject
 * in that branch. The Senior Head Teacher of the subject and the Academic Vice
 * Principal of the branch see it too, and either can decide it. With no Head
 * Teacher it goes to those two." "Own requests": "Nobody approves their own.
 * A Head Teacher's own go to the Senior Head Teacher of the subject or to the
 * Academic Vice Principal. A Senior Head Teacher's own go to the Academic
 * Vice Principal of the branch where the lesson is. An Academic Vice
 * Principal's own go to the Super Admin."; `edge/people-roles-accounts`, row
 * 16: addressed to the post, shown to whoever holds it now). Pure: the posts
 * are read in force on each request by the caller.
 */

/** The posts of one account for the request's subject and branch, in force now. */
export interface Posts {
  readonly superAdmin: boolean;
  /** Academic Vice Principal of the request's branch. */
  readonly academicVicePrincipal: boolean;
  /** Senior Head Teacher of the request's subject. */
  readonly seniorHeadTeacher: boolean;
  /** Head Teacher of the request's subject in the request's branch. */
  readonly headTeacher: boolean;
}

export type Post =
  'head_teacher' | 'senior_head_teacher' | 'academic_vice_principal' | 'super_admin';

/**
 * What a request is on, besides its subject: a Tutor's own Ma'naviyat soati or
 * Homework slot lesson (task 8.4, decision 11; `edge/journal`: "A Tutor's own
 * Ma'naviyat soati lesson locks incomplete. The Academic Vice Principal
 * unlocks it") goes past the subject's Head Teachers.
 */
export interface RequestOn {
  readonly tutorLesson?: boolean;
}

/**
 * The tiers of deciders for a request whose requester holds `requester`, in
 * the order a request goes to them (the first tier is told). Every post of
 * a tier may decide; so may every later tier.
 */
export function tiersFor(requester: Posts, on: RequestOn = {}): readonly (readonly Post[])[] {
  if (requester.academicVicePrincipal) return [['super_admin']];
  if (requester.seniorHeadTeacher || on.tutorLesson === true) {
    return [['academic_vice_principal'], ['super_admin']];
  }
  if (requester.headTeacher) {
    return [['senior_head_teacher', 'academic_vice_principal'], ['super_admin']];
  }
  return [['head_teacher'], ['senior_head_teacher', 'academic_vice_principal'], ['super_admin']];
}

const holds = (posts: Posts, post: Post): boolean =>
  post === 'super_admin'
    ? posts.superAdmin
    : post === 'academic_vice_principal'
      ? posts.academicVicePrincipal
      : post === 'senior_head_teacher'
        ? posts.seniorHeadTeacher
        : posts.headTeacher;

/** What a reader may do with a request: decide it, not their own, or nothing. */
export function decisionReach(
  reader: { readonly accountId: string; readonly posts: Posts },
  requester: { readonly accountId: string | null; readonly posts: Posts },
  on: RequestOn = {},
): 'decide' | 'own' | 'none' {
  if (requester.accountId !== null && reader.accountId === requester.accountId) return 'own';
  const allowed = tiersFor(requester.posts, on).flat();
  return allowed.some((post) => holds(reader.posts, post)) ? 'decide' : 'none';
}

/** The first tier with a holder: the accounts told of a sent request, never the requester. */
export function firstTier<Holder extends { readonly accountId: string; readonly post: Post }>(
  requester: { readonly accountId: string | null; readonly posts: Posts },
  holders: readonly Holder[],
  on: RequestOn = {},
): string[] {
  for (const tier of tiersFor(requester.posts, on)) {
    const found = holders
      .filter((holder) => tier.includes(holder.post) && holder.accountId !== requester.accountId)
      .map((holder) => holder.accountId);
    if (found.length > 0) return [...new Set(found)].sort();
  }
  return [];
}
