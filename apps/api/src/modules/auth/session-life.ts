/**
 * Edge cases, "Accounts and sign-in": every session ends 7 days after sign-in
 * at the latest, trusted or not; a trusted device stays signed in for these 7
 * days.
 */
export const SESSION_MAX_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** The moments of a session that decide whether it is over by time. */
export interface SessionMoments {
  created_at: Date;
  last_used_at: Date;
  trusted_from: Date | null;
  trust_ended_at: Date | null;
}

/** "Trust this device" is in force for the session: it has no idle sign-out. */
export function isTrusted(
  session: Pick<SessionMoments, 'trusted_from' | 'trust_ended_at'>,
): boolean {
  return session.trusted_from !== null && session.trust_ended_at === null;
}

/** The moment a session is over at the latest: 7 days after its sign-in. */
export function latestEndOf(session: Pick<SessionMoments, 'created_at'>): Date {
  return new Date(session.created_at.getTime() + SESSION_MAX_LIFE_MS);
}

/** How a session ended by time, and the moment it was over, not the moment somebody noticed. */
export interface EndByTime {
  at: Date;
  reason: 'idle' | 'expired';
}

/**
 * Whether a session that nothing else ended is over by time at `now`: not used
 * for the idle limit, unless its device is trusted, or 7 days old. Of the two
 * the earlier moment is its end. `undefined`: the session is in force.
 */
export function endByTime(
  session: SessionMoments,
  now: Date,
  idleLimitMs: number,
): EndByTime | undefined {
  const expired = latestEndOf(session);
  const idle = isTrusted(session)
    ? undefined
    : new Date(session.last_used_at.getTime() + idleLimitMs);
  const end: EndByTime =
    idle !== undefined && idle.getTime() < expired.getTime()
      ? { at: idle, reason: 'idle' }
      : { at: expired, reason: 'expired' };
  return end.at.getTime() <= now.getTime() ? end : undefined;
}
