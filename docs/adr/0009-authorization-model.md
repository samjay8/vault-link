# ADR-0009: Authorization model for the Neon backend (RLS vs server layer)

**Status:** Proposed (2026-09-08) — decision pending, tracked in #377

> **Skeleton ADR.** The Context below is settled fact. The Decision section
> lists the candidates with their trade-offs and is completed when the owner
> makes the call. Do not build against this ADR until its status is
> **Accepted**.

## Context

Today, authorization is enforced by **Supabase RLS policies** evaluated
against `auth.uid()` from the Supabase session. The browser holds an anon
key and queries Postgres *directly*; RLS is the only thing standing between
a user and other users' rows.

Migrating to Neon (epic #102) breaks this model in two ways:

1. `auth.uid()` disappears — there is no Supabase session to source claims
   from (ADR-0008 replaces the session layer).
2. **The browser can no longer hold database credentials at all.** Neon has
   no anon-key equivalent; its drivers are server-side. This is a structural
   change worth stating plainly: *every* query must route through the
   Next.js server layer regardless of which authorization option is chosen.
   RLS therefore cannot be the *primary* enforcement point after migration —
   at best it is defense-in-depth.

### Current data surface (from `supabase.from(...)` call sites)

18 tables are touched from browser code. Grouped by sensitivity:

| Group | Tables | Today's protection |
|---|---|---|
| Public read (marketplace/stats) | `invoices`, `financing_offers`, `position_listings`, `price_history`, `protocol_stats`, `contract_state_snapshots` | Select-all policies; writes party-scoped |
| Per-user private | `user_profiles`, `lender_preferences`, `notifications`, `alert_configs` | `auth.uid()`-scoped policies |
| Coordination / security-sensitive | `pending_transactions`, `transaction_approvals` (multisig signature store — ADR-0006), `encrypted_messages`, `fractionalization_records`, `fractional_positions`, `dividend_distributions`, `invoice_documents` | Party-scoped policies; document access limited to invoice parties |
| Operational | `health_metrics`, `audit_log`, `reminder_configs` | Admin-gated writes (`role = 'admin'` RLS) |

Service-role use is narrow: only the SEP-10 verify route
(`app/api/auth/sep10/verify/route.ts`, the replay guard) uses the admin
client.

**Inventory gap:** `docs/06-supabase.md` documents policies for ~5 tables;
the live project's `pg_policies` must be exported and reconciled against the
table list above before this decision is finalized. The gap is expected —
several tables (notifications, multisig, encrypted_messages) were added
without doc updates.

## Decision

**To be completed.** Candidates under consideration:

### Option 1 — Port RLS 1:1, set per-request user context from the server

Every policy moves as-is; the server data layer opens each transaction with
`SET LOCAL role` + user claims (the PostgREST pattern, reproducible on
Neon's transaction-mode pooler).

- **Pros:** defense-in-depth — the database still refuses unauthorized rows
  even if an app bug slips through; direct port of ~20+ existing policies;
  audit_log-style tables stay tamper-resistant against app bugs.
- **Cons:** every query must run through a wrapper that sets context (one
  forgotten `SET LOCAL` = silent full-permission query); harder to test and
  debug; policy bugs are silent rather than loud.

### Option 2 — Server-layer authorization, drop RLS

All authorization checks live in server actions / route handlers; tables
are owned by a single app role with no per-user policies.

- **Pros:** one auditable place per operation; easy to test (plain unit
  tests, no DB role gymnastics); aligns with the post-migration reality
  that all queries are server-side anyway.
- **Cons:** a single missed check exposes data; `audit_log` and the multisig
  signature store lose their second line of defense; every *future*
  endpoint must remember the check (needs a CI/lint guardrail).

### Option 3 — Hybrid (server layer as primary gate + RLS on critical tables)

Server-layer checks everywhere, plus RLS retained on the highest-sensitivity
tables only: `encrypted_messages`, `pending_transactions`,
`transaction_approvals`, `audit_log`.

- **Pros:** most of Option 2's simplicity, keeps a second line of defense
  exactly where a breach is worst.
- **Cons:** two authorization models to understand; the RLS subset still
  needs per-request context plumbing for those tables.

**Evaluation checklist** (fill in a verdict per option when deciding):

- [ ] Policy inventory exported from live Supabase and reconciled with the
      table list above (docs cover only ~5 tables today)
- [ ] Automated unauthorized-access tests exist for at least:
      `notifications`, `encrypted_messages`, `pending_transactions`,
      `reminder_configs` (the #377 DoD floor)
- [ ] Admin gate for `reminder_configs` has an equivalent
- [ ] Multisig signature store confidentiality preserved
- [ ] Connection strategy defined (Neon pooler + `SET LOCAL` semantics if
      any RLS is kept)
- [ ] Guardrail for future endpoints (lint rule / review checklist / helper
      that makes the unauthenticated path unrepresentable)

**Chosen option:** _TBD_
**Rationale:** _TBD_

## Consequences

Known regardless of choice:

- All ~100 `supabase.from(...)` call sites across 18 tables are rewritten
  against the new data layer (shared work with #102's storage swap).
- `SUPABASE_SERVICE_ROLE_KEY` semantics become a single server-side DB role;
  scoping roles per feature (keeper, indexer, health-collector) is a
  follow-up, noted here so it isn't lost.
- `docs/06-supabase.md` is replaced (per #102) and its policy section
  becomes either the ported-policy reference or the server-check map.
- Contributor guidance must state the authorization convention explicitly —
  this ADR is that document once Accepted.

Per chosen option: _TBD — fill in when the decision is made._

## References

- Issue #377 — this decision's parent
- Epic #102 — Supabase → Neon migration
- ADR-0008 — authentication layer for the Neon backend (provides the
  session identity this authorization model consumes)
- ADR-0006 — multisig approval (defines the sensitivity of
  `pending_transactions` / `transaction_approvals`)
- `docs/06-supabase.md` — current (partial) policy documentation
