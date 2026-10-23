import { describe, expect, it } from 'vitest';
import { decisionReach, firstTier, type Post, type Posts } from './plan-request-routing.js';

/**
 * Task 7.2: who decides a plan request (`02`, "Who approves", "Own
 * requests"; `edge/lesson-plans`, "The Head Teacher is ill, leaves the post,
 * or is the one asking").
 */

const none: Posts = {
  superAdmin: false,
  academicVicePrincipal: false,
  seniorHeadTeacher: false,
  headTeacher: false,
};

const with_ = (post: Post): Posts => ({
  ...none,
  ...(post === 'super_admin' ? { superAdmin: true } : {}),
  ...(post === 'academic_vice_principal' ? { academicVicePrincipal: true } : {}),
  ...(post === 'senior_head_teacher' ? { seniorHeadTeacher: true } : {}),
  ...(post === 'head_teacher' ? { headTeacher: true } : {}),
});

const reader = (post: Post | null) => ({
  accountId: `reader-${post ?? 'teacher'}`,
  posts: post === null ? none : with_(post),
});

const teacher = { accountId: 'teacher', posts: none };

describe('the routing of a plan request', () => {
  it("lets every post decide a teacher's request, and nobody else", () => {
    for (const post of [
      'head_teacher',
      'senior_head_teacher',
      'academic_vice_principal',
      'super_admin',
    ] as const) {
      expect(decisionReach(reader(post), teacher)).toBe('decide');
    }
    expect(decisionReach(reader(null), teacher)).toBe('none');
  });

  it('refuses everyone their own, whatever post they hold', () => {
    for (const post of [
      null,
      'head_teacher',
      'senior_head_teacher',
      'academic_vice_principal',
    ] as const) {
      const self = reader(post);
      expect(decisionReach(self, self)).toBe('own');
    }
  });

  it("sends a Head Teacher's own to the Senior Head Teacher or the Academic Vice Principal", () => {
    const head = { accountId: 'head', posts: with_('head_teacher') };
    expect(decisionReach(reader('senior_head_teacher'), head)).toBe('decide');
    expect(decisionReach(reader('academic_vice_principal'), head)).toBe('decide');
    expect(decisionReach(reader('super_admin'), head)).toBe('decide');
  });

  it("sends a Senior Head Teacher's own to the Academic Vice Principal only (the Head Teacher refused)", () => {
    const senior = { accountId: 'senior', posts: with_('senior_head_teacher') };
    expect(decisionReach(reader('head_teacher'), senior)).toBe('none');
    expect(decisionReach(reader('academic_vice_principal'), senior)).toBe('decide');
    expect(decisionReach(reader('super_admin'), senior)).toBe('decide');
  });

  it("sends an Academic Vice Principal's own to the Super Admin only", () => {
    const vice = { accountId: 'vice', posts: with_('academic_vice_principal') };
    expect(decisionReach(reader('head_teacher'), vice)).toBe('none');
    expect(decisionReach(reader('senior_head_teacher'), vice)).toBe('none');
    expect(decisionReach(reader('super_admin'), vice)).toBe('decide');
  });

  it('tells the first tier with a holder, never the requester (review correction 5)', () => {
    const holders = [
      { accountId: 'h', post: 'head_teacher' as const },
      { accountId: 's', post: 'senior_head_teacher' as const },
      { accountId: 'v', post: 'academic_vice_principal' as const },
      { accountId: 'x', post: 'super_admin' as const },
    ];
    expect(firstTier(teacher, holders)).toEqual(['h']);
    expect(firstTier(teacher, holders.slice(1))).toEqual(['s', 'v']);
    expect(firstTier({ accountId: 'h', posts: with_('head_teacher') }, holders)).toEqual([
      's',
      'v',
    ]);
    expect(firstTier({ accountId: 'v', posts: with_('academic_vice_principal') }, holders)).toEqual(
      ['x'],
    );
    expect(firstTier(teacher, [])).toEqual([]);
  });
});
