// Lightweight Result type used across core for operations that can fail in
// expected ways (git pushes, network calls, validation) without throwing.
export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// A safety-rail verdict. Deliberately distinct from Result so a rail decision
// reads as allow/deny with a human-facing reason, not success/failure.
export type RailVerdict = { allowed: true } | { allowed: false; reason: string };

export const allow = (): RailVerdict => ({ allowed: true });
export const deny = (reason: string): RailVerdict => ({ allowed: false, reason });
