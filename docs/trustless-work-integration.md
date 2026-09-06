# Trustless Work Escrow Integration — Research & Phase-2 Plan

> **Status:** Draft for review · **Owner:** @samjay8 · **Target:** Phase 2 (post current milestone)
> **Companion repos:** [Trustless Work org](https://github.com/Trustless-Work) · [Smart escrow contract](https://github.com/Trustless-Work/trustlesswork-smart-contract-stellar) · [React SDK](https://www.npmjs.com/package/@trustless-work/escrow) · [API docs](https://docs.trustlesswork.com)

---

## Part 1 — What Trustless Work is (research summary)

Trustless Work is **Escrow-as-a-Service (EaaS) on Stellar Soroban**, USDC-native. Their core design question is: *"What must happen before funds move?"* — when the answer involves multiple parties, milestones, approvals, or release conditions, they provide on-chain primitives to model that flow.

### 1.1 The escrow lifecycle

```
create escrow → fund it → define milestones → approve work → release funds → resolve disputes
```

Every escrow is defined by a **JSON logic file** deployed on-chain that maps real-world responsibilities to on-chain permissions through **roles**. Every action emits structured on-chain events (auditable by anyone).

### 1.2 Roles (separation of duties)

| Role | Responsibility |
|---|---|
| **Issuer** | Deploys the escrow — holds **no control** over funds |
| **Funder** | Deposits funds; tracked for transparency |
| **Service Provider** | Marks milestones (e.g., "work delivered") |
| **Approver** | Validates milestones |
| **Release Signer** | Executes payouts (supports **payout** and **claim** models) |
| **Receiver** | Collects funds |
| **Platform Address** | Manages fees and pre-funding updates |
| **Dispute Resolver** | Handles conflicts |
| **Observer** | Read-only visibility |

### 1.3 Product surface (how you integrate)

| Layer | What it is |
|---|---|
| **REST API** | Full escrow lifecycle; returns **unsigned XDR** you sign client-side — the exact pattern InvoFi's frontend already uses |
| **React SDK** — `@trustless-work/escrow` | Typed hooks for every escrow action (axios + TanStack Query under the hood); MIT-licensed, published on npm (stable `3.0.5`, V2 `5.0.0-beta.1`) |
| **Blocks SDK** — `@trustless-work/blocks` | Pre-built UI blocks + wallet connectivity |
| **Backoffice** | Request API keys, test flows end-to-end |
| **Escrow Viewer** | On-chain escrow explorer |
| **Reference apps** | `trustlesswork-agency-escrow-template` (Next.js), `demo-Trustless-Work`, `dApp-Trustless-Work` |

### 1.4 Credibility signals

- **Audited** — independent smart-contract review by **Runtime Verification** (Sep 2025)
- **SCF-funded** — **$118K across 2 rounds** (SCF #31, #41), now officially in the **SCF Integration Track**
- **Circle partner** — listed at partners.circle.com
- **Production traction** — 100k+ USDC processed; 31 Nigerian builder projects via Boundless; integrations with KindFi, SafeTrust, cminds-coastal, Tanko
- **Active team** — PM (techrebelgit), frontend (JoelVR17), full-stack (armandocodecr), smart-contract (zkCaleb-dev); bounties on **GrantFox** (same platform InvoFi uses)
- **Active development** — V2 released May 2026 ("programmable escrows → configurable payment infrastructure"), Solana variant exists (StableHacks 2026), Go indexer, GitBook docs, AI skill

### 1.5 Why it fits InvoFi (complementary, not competing)

| | InvoFi | Trustless Work |
|---|---|---|
| What it owns | Invoice lifecycle, offers, financing, repayment, insurance, reputation | Fund holding + conditional release |
| Money movement | Lender → originator (principal), originator → lender (principal + yield) | Any escrowed transfer with milestones/approvals |
| Overlap | None — different layers | None — different layers |

InvoFi is the *financing protocol*; Trustless Work is the *payment rail* for the riskiest transfers. This is exactly the integration posture they market: *"use APIs, SDKs, and open-source templates to add escrow flows without writing smart contracts from scratch."*

---

## Part 2 — Integration architecture (how it maps to InvoFi)

InvoFi's protocol state stays in the five Soroban contracts (registry / financing / repayment / insurance / reputation). Trustless Work escrows become an **external payment rail** at the money-movement boundaries. Recommended integration level: **API/SDK-level (Option B)** — do **not** re-implement escrow in Rust; their escrow contract is already audited and SCF-maintained.

### 2.1 Integration Point 1 — Disbursement escrow on `accept_offer` (highest value)

**Problem today:** `accept_offer` transfers the financed amount directly from lender → originator. The originator gets funds with no delivery guarantee — the #1 risk in invoice financing.

**With Trustless Work:** the financed amount enters an escrow with a milestone ("invoice verified / goods delivered"), released to the originator only when the milestone is approved.

| Escrow role | InvoFi party |
|---|---|
| Funder | Lender (deposits the financed amount) |
| Service Provider | Originator (marks "delivered/verified") |
| Approver | Originator's customer (confirms delivery — the party paying the invoice) |
| Receiver | Originator (receives funds after milestone approval) |
| Dispute Resolver | InvoFi admin / insurance contract |

**Outcome:** converts InvoFi from *unsecured invoice financing* to *delivery-verified invoice financing* — a structural reduction in lender risk, and a headline product differentiator.

### 2.2 Integration Point 2 — Repayment escrow on `repay_invoice`

Originator pre-funds principal + yield into escrow (at acceptance or by due date). The escrow releases to the lender at maturity. `repay_invoice`/`mark_overdue` then operate on escrow state instead of hoping the originator pays. The originator's customer paying the invoice becomes the natural milestone trigger.

### 2.3 Integration Point 3 — Dispute resolution

InvoFi already has a `Disputed` status with admin `resolve_dispute`. Trustless Work has first-class dispute flows with a **Dispute Resolver** role. Disputed financed/repayment amounts can be held in escrow where a resolver (admin or insurance) arbitrates — cleaner than extending InvoFi's own dispute logic, and removes the manual double-signing risk surfaced in issue #75.

### 2.4 Integration Point 4 — Insurance payout routing (Task 10 follow-up)

The insurance-pool payout-on-default can be released **through an escrow with the insurance contract as resolver** — an audit trail and safety valve on the highest-risk code in the protocol.

### 2.5 Product expansion (Phase 2+, optional)

**Milestone-based invoicing** — businesses getting paid by *their* customers in installments is Trustless Work's core competency. InvoFi would not build this itself; it would surface Trustless Work escrows natively (natural fit with the existing agency-escrow-template).

### 2.6 Currency scope

Escrow integration is **USDC-only initially** (Trustless Work is USDC-first). InvoFi's currency registry (Symbol → Address in `common`) makes this a *registry/config decision*, not a code branch — consistent with the existing design.

---

## Part 3 — Phase-2 delivery plan (epics + issues)

Sequenced so each epic is shippable and verifiable on testnet. Each issue below is drafted to be **imported into GrantFox** (add the one-line import comment per GrantFox convention) with the complexity labels used across both repos (`trivial` / `medium` / `high-complexity` / `good-first-issue`).

### Epic 1 — Research & partnership (foundation)

| # | Issue (draft title) | Labels | Est. |
|---|---|---|---|
| 1.1 | Reach out to Trustless Work team (Telegram/email) — request API keys + confirm V2 availability | `medium`, `good-first-issue` | 1 day |
| 1.2 | ADR-0008: Trustless Work escrow rail — integration level (API/SDK), USDC-only scope, adapter pattern | `medium` | 1 day |
| 1.3 | Spike: reproduce a full Trustless Work escrow flow on testnet with the demo dApp + agency template | `medium`, `good-first-issue` | 2 days |

### Epic 2 — SDK adapter (`@invofi/sdk`)

All Trustless Work calls sit behind **one adapter file** in `@invofi/sdk` so a Trustless Work API change touches one file, not the app.

| # | Issue (draft title) | Labels | Est. |
|---|---|---|---|
| 2.1 | Add `@trustless-work/escrow` dependency + env vars (`TRUSTLESS_WORK_API_KEY`, `TRUSTLESS_WORK_API_URL`) to frontend and SDK | `trivial`, `good-first-issue` | 0.5 day |
| 2.2 | Build `escrowAdapter.ts` in `@invofi/sdk` — thin typed wrapper around create/fund/milestone/release/dispute calls | `medium` | 2 days |
| 2.3 | Type the escrow↔invoice mapping (escrow id ↔ invoice id ↔ offer id) in the SDK and the Supabase mirror | `medium` | 1 day |

### Epic 3 — Disbursement escrow on `accept_offer` (flagship)

| # | Issue (draft title) | Labels | Est. |
|---|---|---|---|
| 3.1 | Frontend: on `accept_offer`, create + fund a Trustless Work escrow (unsigned XDR signed by the lender's wallet) before the financing transfer | `high-complexity` | 3 days |
| 3.2 | Frontend: milestone-approval step for the originator's customer ("invoice delivered") + release to originator | `high-complexity` | 2 days |
| 3.3 | Frontend: escrow status surface on invoice detail + portfolio (funded / milestone pending / released) | `medium` | 2 days |
| 3.4 | e2e: Playwright test for accept → escrow → approve → release on testnet | `medium` | 2 days |
| 3.5 | Docs: update README architecture diagram + GitBook with the escrow rail | `trivial`, `good-first-issue` | 1 day |

### Epic 4 — Repayment escrow + disputes (Phase 2b)

| # | Issue (draft title) | Labels | Est. |
|---|---|---|---|
| 4.1 | Frontend: repayment escrow (originator pre-funds principal + yield; auto-release to lender at maturity) | `high-complexity` | 3 days |
| 4.2 | Frontend: route `raise_dispute`/`resolve_dispute` state changes through an escrow with Dispute Resolver role | `high-complexity` | 2 days |
| 4.3 | Insurance: payout-on-default released through escrow with insurance as resolver (contracts + frontend) | `high-complexity` | 3 days |
| 4.4 | Keeper: reconcile escrow events (escrow-funded / milestone-approved / released) into the indexer aggregates | `medium` | 2 days |

**Total Phase-2 estimate: ~6–8 engineering weeks** (2–3 contributors part-time), matching the org's GrantFox cadence. Epics 1–3 are the v1 slice; Epic 4 is a fast-follow.

---

## Part 4 — Hands-on integration steps (what to do)

1. **Get access**
   - Create an account on the Trustless Work **Backoffice** → request an **API key** (mention InvoFi + SCF context).
   - Confirm **testnet vs mainnet** support and the current API version (V2 shipped May 2026 — check whether to target `@trustless-work/escrow@5.0.0-beta.1` or stable `3.0.5`).
2. **Add the dependency**
   ```bash
   cd invofi/apps/frontend
   npm install @trustless-work/escrow
   ```
   Add `TRUSTLESS_WORK_API_KEY` + `TRUSTLESS_WORK_API_URL` to `.env.local.example` and Vercel env vars.
3. **Spike the flow on testnet** (before writing product code)
   - Clone `trustlesswork-agency-escrow-template` and run the reference flow: create escrow → fund → milestone → approve → release.
   - Inspect the escrow on the **Escrow Viewer**.
4. **Build the adapter** — `escrowAdapter.ts` in `@invofi/sdk`: typed functions (`createDisbursementEscrow`, `fundEscrow`, `approveMilestone`, `releaseEscrow`, `openDispute`) that wrap the SDK hooks and return unsigned XDR for the existing `signTransaction` wallet flow (Freighter / LOBSTR / Albedo / xBull — unchanged).
5. **Wire `accept_offer`** — before/with the financing transfer, create + fund the disbursement escrow; store `escrow_id` against the invoice in the Supabase mirror.
6. **Milestone UX** — originator's customer approves delivery → escrow releases to originator. Surface status on the invoice detail + portfolio.
7. **Verify on testnet** — manual run + Playwright: balance moves only *after* milestone approval; `stellar.expert` shows the escrow contract activity.
8. **Keeper/indexer** — reconcile Trustless Work events (they emit on-chain events; their Go indexer pattern can inform InvoFi's `indexer.ts` once Supabase migration lands).
9. **Docs** — update README architecture diagram, GitBook, and this doc's status.

---

## Part 5 — Partnership approach (how to engage their team)

### 5.1 Who to contact

| Contact | Role | Channel |
|---|---|---|
| Tech Rebel (`techrebelgit`) | Product Manager | Telegram (`t.me/+kmr8tGegxLU0NTA5` — their public group) |
| Joel Vargas (`JoelVR17`) | Frontend / SDK maintainer | `joel@trustlesswork.com` (npm maintainer email) |
| Armando Murillo (`armandocodecr`) | Full Stack | Telegram |
| Caleb Loría (`zkCaleb-dev`) | Smart Contracts | Telegram |

**Best channel:** their public **Telegram group** (linked from every repo README) — fastest response; the maintainers are active and partnership-oriented.

### 5.2 Outreach message template (copy-paste)

> **Subject/opening:** InvoFi × Trustless Work — invoice-financing escrow rail
>
> Hi Trustless Work team! We're the maintainers of **InvoFi**, an open-source invoice-financing protocol on Stellar Soroban (github.com/Stellar-VaultLink/invofi). We tokenize invoices, run a competitive offer marketplace, and move real USDC/XLM on testnet across five contracts (registry, financing, repayment, insurance, reputation).
>
> We've researched Trustless Work and see a genuinely complementary fit: your escrow infrastructure as the **payment rail for our riskiest transfers** — specifically:
> 1. **Disbursement escrow** — lender's financed amount held in escrow until the originator's customer confirms delivery, then released to the originator. This converts our financing from unsecured to delivery-verified.
> 2. **Repayment escrow** — guaranteed principal + yield release to lenders at maturity.
> 3. **Dispute routing** — our existing `Disputed` state handed to your Dispute Resolver role.
>
> We'd love to:
> - Get **API keys** and confirm testnet availability + V2 (Core API) status.
> - Build a **reference integration** on your agency-escrow-template pattern and share it publicly (both our READMEs credit the partnership).
> - Explore **cross-ecosystem collaboration**: we're both SCF-funded-path projects (you're in the SCF Integration Track — congrats!), both run bounties on GrantFox, and both target real-world payment flows on Stellar.
>
> Happy to jump on a call or work async over Telegram. Pura vida!

### 5.3 What to ask for / aim for

1. **API keys** (testnet first) + early access to V2 endpoints if relevant.
2. **A public reference-integration badge** — InvoFi becomes a listed integration on their site (they list KindFi, SafeTrust, Boundless etc.).
3. **Joint SCF story** — mutual citation in SCF applications; an integration with an SCF Integration Track member strengthens both projects' ecosystem depth.
4. **Cross-GrantFox campaigns** — cross-post bounties so both contributor pools see the other's issues.
5. **Content** — a joint dev update / Lumen Loop feature for visibility.

---

## Part 6 — Risks & decisions to record (ADR-0008)

| Decision | Recommendation | Why |
|---|---|---|
| Integration level | **API/SDK-level**, not cross-contract Rust calls | Their escrow contract is audited (Runtime Verification); re-implementing escrow in Rust re-derives that audit burden. Cross-contract calls can come later if on-chain composability is ever needed |
| Currency scope | **USDC-only** for escrowed flows | Trustless Work is USDC-first; XLM flows keep the direct-transfer path. Registry-entry decision, not a code branch |
| Dependency management | All TW calls behind `escrowAdapter.ts` in `@invofi/sdk` | One file changes if their API evolves (V2 just shipped — API drift is the top risk) |
| Where escrow id lives | Supabase mirror on the invoice row + escrow status column | Frontend reads mirror; contracts remain the system of record for financing state |
| Timing | Phase 2, after the current milestone + Wave decision | Not scope for the current plan; the plan above is ready to execute when greenlit |

### Top risks

1. **API drift** — their V2 (May 2026) changed surfaces; pin versions, wrap in the adapter, re-verify on testnet before each release.
2. **Their network maturity** — confirm mainnet status + API-key gating before promising anything in public docs.
3. **UX friction** — milestone approval adds a step to `accept_offer`; must feel native (originator's customer gets a simple "confirm delivery" link), or adoption suffers.
4. **Scope discipline** — this is a new workstream; do not squeeze it into an active sprint.

---

*Generated as research + plan input for InvoFi Phase 2. Verify live endpoint names and SDK hook signatures against the Trustless Work Swagger/API docs (`docs.trustlesswork.com`) before implementation — this doc is a design document, not a substitute for their current API reference.*