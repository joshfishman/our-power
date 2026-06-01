// Helper: check if the current session is allowed to use the scorecard
// admin queue. Single-source-of-truth for the email allowlist read from
// SCORECARD_ADMIN_EMAILS env var.
//
// (CI trigger smoke test on PR #57 — no behavior change.)
//
// Why an env-var allowlist instead of a User.role column: keeps v1.6.1
// minimal — no schema migration, no admin-role assignment UI, just a list
// of trusted emails. Future expansion to role-based access is fine.

import { auth } from '@/auth';

export async function isScorecardAdmin(): Promise<{ allowed: boolean; email: string | null }> {
  const session = await auth();
  // NextAuth typings on this project narrow session.user to {id, name} only —
  // email isn't on the declared type but is on the underlying record. Read
  // through a defensive cast.
  const user = (session?.user ?? null) as { email?: string } | null;
  const email = user?.email ?? null;
  if (!email) return { allowed: false, email: null };
  const raw = process.env.SCORECARD_ADMIN_EMAILS ?? '';
  const allowlist = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length === 0) return { allowed: false, email };
  return { allowed: allowlist.includes(email.toLowerCase()), email };
}
