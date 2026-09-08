# ADR-0008: Authentication layer for the Neon backend

**Status:** Accepted (2026-09-08) — tracked in #376

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
  it has its own ADR (#377 / ADR-0009). This ADR only decides *who the user
  is and how their session is proven*.

## Decision

**Option A — Auth.js (NextAuth v5) with a database session strategy.**
Chosen 2026-09-08.

1. **Email/password** — the Auth.js Credentials provider, backed by the
   existing `user_profiles` table. Password hashes are ported per the
   runbook (#379) or reset on first login; no blind-trust path survives.
2. **SEP-10 wallet login** — a **custom SEP-10 provider**. The flow keeps
   its current user-visible shape: the client requests a one-time challenge
   (nonce), the wallet signs it, and the signed challenge is submitted to
   the provider's `authorize` handler. The handler verifies the signature
   server-side with `@stellar/stellar-sdk`, sets `wallet_verified`, and
   issues a session. The replay guard (`sep10-replay-guard.ts`) moves into
   the authorize handler unchanged in behavior (single-use token table in
   Neon).
3. **Anonymous sessions** — a built-in `anonymous` provider that issues a
   session without credentials; the existing `user_profiles` upsert pattern
   is preserved so offline demo mode (`NEXT_PUBLIC_USE_MOCK=1`) keeps
   working.
4. **Sessions** — stored in a `session` table in Neon (database strategy),
   with cookie-based refresh in `middleware.ts` using the Auth.js `auth()`
   API — the same pattern the app has today, so the middleware rewrite is
   mechanical.
5. **Admin paths** — the SEP-10 verify route and replay guard authenticate
   via the session plus a server-side role claim check in the route
   handler. `SUPABASE_SERVICE_ROLE_KEY` is replaced by a single server-side
   DB role (ADR-0009).

**Rejected:**
- **Option B (custom session layer)** — rejected because InvoFi is an
  open-source project with many contributors: a hand-rolled session/cookie
  layer becomes tribal knowledge, and custom auth is the first thing a
  security reviewer flags. The SEP-10 mapping is close, but not close
  enough to justify owning the entire security surface.
- **Option C (managed auth)** — rejected: recurring cost, vendor lock-in,
  and SEP-10 would fight the platform's opinionated providers.

### Evaluation checklist (verdicts)

- [x] SEP-10 wallet login without contortions — custom provider,
      server-side verification preserved
- [x] SSR-safe session refresh in `middleware.ts` — `auth()` API, same
      cookie pattern as today
- [x] Server-side auth check for the replay guard and admin paths —
      session + role claim in route handlers
- [x] Session revocation (logout-everywhere) —
      `DELETE FROM session WHERE user_id = ?`
- [x] Dependency and audit cost — one well-audited, widely deployed
      dependency
- [x] Migration effort / re-login policy — **forced re-login at cutover is
      accepted**; all sessions are invalidated when Supabase is paused

## Consequences

Known regardless of choice:

- `src/utils/supabase/*` and the auth paths of `src/lib/supabase.ts` are
  replaced; data-access code moves as part of #102's storage work, not here.
- Every existing session is invalidated at cutover — one re-login per user,
  accepted above.
- `docs/05-authentication.md` and `docs/06-supabase.md` are rewritten to
  describe the new flow.

Per chosen option:

- The SEP-10 challenge/verify contract is unchanged, so the frontend wallet
  flow needs **no UX change**.
- `middleware.ts` swaps Supabase SSR for Auth.js `auth()` — same cookie
  shape, mechanical rewrite.
- The replay guard keeps its server-side single-use-token behavior, now
  enforced in the authorize handler.
- Contributors get a familiar stack (Auth.js is the Next.js default); the
  custom SEP-10 provider is the only novel surface and is unit-testable in
  isolation.

## References

- Issue #376 — this decision's parent
- Epic #102 — Supabase → Neon migration
- ADR-0009 — authorization model (consumes this session identity)
- `docs/05-authentication.md` — current auth flows