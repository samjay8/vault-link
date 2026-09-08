# ADR-0008: Authentication layer for the Neon backend

**Status:** Proposed (2026-09-08) — decision pending, tracked in #376

> **Skeleton ADR.** The Context below is settled fact. The Decision section
> lists the candidates with their trade-offs and is completed when the owner
> makes the call. Do not build against this ADR until its status is
> **Accepted**.

## Context

Supabase currently provides four distinct services to InvoFi: Postgres
storage, Auth, Realtime, and RLS policy evaluation. Storage is migrating to
Neon (epic #102). Auth must move with it, and it is the most entangled
piece:

- **Email/password** signup, login, and logout live in `src/lib/supabase.ts`
  (`signUp`, `signInWithPassword`, `signOut`, `getUser`).
- **SEP-10 wallet login** — the primary flow for a Stellar app — mints a
  one-time token server-side and redeems it via `auth.verifyOtp` into a real
  session (`src/lib/sep10.ts`).
- **Anonymous sessions** via `signInAnonymously` back the offline demo mode.
- **SSR session refresh** runs in `src/utils/supabase/middleware.ts`, wired
  through the root `middleware.ts`, using Supabase's cookie-based sessions.
- **Server-only admin operations** — e.g. the SEP-10 replay guard
  (`src/lib/sep10-replay-guard.ts`) — use a service-role client
  (`src/utils/supabase/admin.ts`).

Constraints carried over from #376:

- The SEP-10 wallet flow must keep working end-to-end unchanged.
- The existing React context/hook shape (`session`, `user`) is preserved so
  UI components don't need mass rewrites.
- The `wallet_verified` column on `user_profiles` (SEP-10-verified vs
  blind-trust linked wallet) must remain meaningful.
- No `@supabase/ssr` / `supabase.auth` references may remain afterwards.
- Authorization (RLS port vs server-layer checks) is a separate decision —
  it will get its own ADR (#377). This ADR only decides *who the user is
  and how their session is proven*.

## Decision

**To be completed.** Candidates under consideration:

### Option A — Auth.js (NextAuth v5)

Credentials provider for email/password; a custom provider for SEP-10
(verify the SEP-10 challenge signature inside `authorize`).

- **Pros:** maintained and familiar to contributors; built-in CSRF and
  session handling; database session strategy works with Neon.
- **Cons:** an extra dependency with its own release cadence; the SEP-10
  custom provider is nonstandard and needs careful testing; cookie/session
  shape differs from today's, so `middleware.ts` is rewritten regardless.

### Option B — Custom session layer (signed HTTP-only cookies + `sessions` table)

Smallest dependency surface; full control over SEP-10, which maps almost
1:1 (mint one-time token → verify signature → set cookie).

- **Pros:** no framework lock-in; revocation is a SQL `DELETE`; the replay
  guard keeps its server-side shape naturally.
- **Cons:** we own the whole security surface (cookie signing, rotation,
  expiry, CSRF); more code to audit; no community battle-testing.

### Option C — Managed auth (Clerk / Auth0 / …)

- **Pros:** fastest to ship; polished UX components.
- **Cons:** recurring cost; vendor lock-in; SEP-10 would fight the
  platform's opinionated providers. Likely rejected — record why if so.

**Evaluation criteria** (fill in a verdict per option when deciding):

- [ ] SEP-10 wallet login supported without contortions
- [ ] SSR-safe session refresh in `middleware.ts`
- [ ] Server-side auth check available for the replay guard and admin paths
- [ ] Session revocation story (logout-everywhere)
- [ ] Dependency and audit cost
- [ ] Migration effort for existing Supabase sessions — is forcing one
      re-login at cutover acceptable? Decide explicitly.

**Chosen option:** _TBD_
**Rationale:** _TBD_

## Consequences

Known regardless of choice:

- `src/utils/supabase/*` and the auth paths of `src/lib/supabase.ts` are
  replaced; data-access code moves as part of #102's storage work, not here.
- Every existing session is invalidated at cutover — one re-login per user.
- `docs/05-authentication.md` and `docs/06-supabase.md` are rewritten to
  describe the new flow.

Per chosen option: _TBD — fill in when the decision is made._

## References

- Issue #376 — this decision's parent
- Epic #102 — Supabase → Neon migration
- `docs/05-authentication.md` — current auth flows
