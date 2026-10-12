import { z } from 'zod';
import { branchIdSchema } from './branches.js';
import { personNameSchema } from './accounts.js';
import { languageSchema } from './language.js';
import { roleSchema } from './roles.js';

/** Edge cases, "Accounts and sign-in": passwords have at least ten characters. */
export const PASSWORD_MIN_LENGTH = 10;

/** An upper limit, so nobody can make the server hash a megabyte of text. */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * What is typed on the sign-in page. Nothing here says how a login or a
 * password looks: a wrong one gets the same answer as an unknown one.
 */
export const signInSchema = z.object({
  login: z.string().min(1).max(100),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  /**
   * The "Trust this device" switch, off when left out: the browser stays
   * signed in for 7 days from this sign-in, with no idle sign-out.
   */
  trustDevice: z.boolean().optional(),
});

export type SignIn = z.infer<typeof signInSchema>;

/** Staff change their own password with the current one. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

export type ChangePassword = z.infer<typeof changePasswordSchema>;

/**
 * Where a session stands with the second step of sign-in:
 * `pending`: the account has one and this session has not given a code yet;
 * `passed`: it has; `set_up_required`: the second step is required for the
 * account and none is set up; `not_needed`: none is set up and none is required.
 */
export const secondStepStateSchema = z.enum(['not_needed', 'pending', 'set_up_required', 'passed']);

export type SecondStepState = z.infer<typeof secondStepStateSchema>;

/** Who is signed in, and what must be done before anything else. */
export const sessionResponseSchema = z.object({
  login: z.string(),
  /**
   * The first and last name of the staff record linked to the account, for
   * the menu (pull request #61, decision 6); `null` for an account with no
   * record, such as the first Super Admin, which shows its login. `null` too
   * while a step of sign-in is owed (task 2.3a, code round 1, finding 6).
   */
  name: personNameSchema.nullable(),
  secondStep: secondStepStateSchema,
  mustChangePassword: z.boolean(),
  /**
   * The administrator who reset the password, while the reset password is in
   * use ("your password was reset by X"): the first and last name of their
   * staff record, their login when they have none (task 2.3a, decision 9);
   * otherwise `null`.
   */
  passwordResetBy: z.string().nullable(),
  /**
   * On a trusted device: the moment the session ends, 7 days after its
   * sign-in. `null` while the session is not trusted; it then ends when it is
   * not used, and 7 days after its sign-in at the latest.
   */
  trustedUntil: z.iso.datetime().nullable(),
  /**
   * The language of the account (`12`, Language: the choice is remembered).
   * Present in every answer, also while a step is owed: it is a fact of the
   * account, not something shown. The web app applies it only once no step
   * is owed (task 0.8d).
   */
  language: languageSchema,
  /**
   * The assignments in force now, for the menu and the role switcher (display
   * only: the server checks every request on all current assignments). Empty
   * while a step of sign-in is owed. In the order of `ROLES`.
   */
  assignments: z.array(z.object({ role: roleSchema, branchId: branchIdSchema.nullable() })),
  /**
   * The branches the account may choose in the branch switcher, by name: every
   * branch for a Super Admin or Senior Head Teacher, otherwise the branches of
   * its assignments. Empty while a step of sign-in is owed.
   */
  branches: z.array(z.object({ id: branchIdSchema, name: z.string() })),
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** The language chooser, when signed in: the language is stored on the account. */
export const setLanguageSchema = z.object({ language: languageSchema });

export type SetLanguage = z.infer<typeof setLanguageSchema>;

/** The open sessions of the signed-in account, for the profile. */
export const sessionListSchema = z.object({
  sessions: z.array(
    z.object({
      id: z.uuid(),
      startedAt: z.iso.datetime(),
      lastUsedAt: z.iso.datetime(),
      /** The browser as it named itself at sign-in, cut to 200 characters. */
      userAgent: z.string().nullable(),
      /** The session that asked. */
      current: z.boolean(),
      /** The session of a trusted device: it has no idle sign-out. */
      trusted: z.boolean(),
    }),
  ),
});

export type SessionList = z.infer<typeof sessionListSchema>;

/**
 * The trusted devices of the signed-in account, for the profile: its sessions
 * whose sign-in set "Trust this device". Removing one ends that session.
 */
export const trustedDeviceListSchema = z.object({
  devices: z.array(
    z.object({
      /** The id of the session of that device. */
      id: z.uuid(),
      startedAt: z.iso.datetime(),
      lastUsedAt: z.iso.datetime(),
      /** The browser as it named itself at sign-in, cut to 200 characters. */
      userAgent: z.string().nullable(),
      /** 7 days after the sign-in. */
      trustedUntil: z.iso.datetime(),
      /** The device that asked. */
      current: z.boolean(),
    }),
  ),
});

export type TrustedDeviceList = z.infer<typeof trustedDeviceListSchema>;

export const trustedDeviceParamsSchema = z.object({ id: z.uuid() });

export type TrustedDeviceParams = z.infer<typeof trustedDeviceParamsSchema>;

/**
 * A code of the second step: six digits from the authenticator app, or a
 * recovery code. Nothing here says how either looks: a text that cannot be a
 * code is answered like a wrong one.
 */
export const secondStepCodeSchema = z.object({
  code: z.string().min(1).max(40),
});

export type SecondStepCode = z.infer<typeof secondStepCodeSchema>;

/** A set-up that was started: what the authenticator app needs. Shown once. */
export const secondStepSetUpSchema = z.object({
  /** The secret in base32, for typing it into the app by hand. */
  secret: z.string(),
  /** The same as an `otpauth://` address, for a QR picture. */
  address: z.string(),
});

export type SecondStepSetUp = z.infer<typeof secondStepSetUpSchema>;

/** The recovery codes of a second step that was just confirmed. Shown once. */
export const secondStepRecoveryCodesSchema = z.object({
  recoveryCodes: z.array(z.string()),
});

export type SecondStepRecoveryCodes = z.infer<typeof secondStepRecoveryCodesSchema>;

/** The second step of the signed-in account, for the profile. */
export const secondStepOverviewSchema = z.object({
  on: z.boolean(),
  /** Required for the account: it cannot be turned off. */
  required: z.boolean(),
  recoveryCodesLeft: z.number().int(),
});

export type SecondStepOverview = z.infer<typeof secondStepOverviewSchema>;
