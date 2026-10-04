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
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;
