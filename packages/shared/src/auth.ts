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

/** Who is signed in, and whether the password must be changed before anything else. */
export const sessionResponseSchema = z.object({
  login: z.string(),
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
