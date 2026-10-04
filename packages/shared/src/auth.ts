import { z } from 'zod';

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
  secondStep: secondStepStateSchema,
  mustChangePassword: z.boolean(),
  /**
   * The login of the administrator who reset the password, while the reset
   * password is in use ("your password was reset by X"); otherwise `null`.
   */
  passwordResetBy: z.string().nullable(),
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

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
    }),
  ),
});

export type SessionList = z.infer<typeof sessionListSchema>;

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
