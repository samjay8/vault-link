// ── Trustless Work escrow adapter (Phase 2 — Escrow Rail) ────────────────────
//
// Typed client for the Trustless Work Core API (v2 single-release escrows),
// giving InvoFi a milestone-gated disbursement rail: on `accept_offer` the
// financed amount can be routed lender → escrow → (milestone approved) →
// originator instead of moving directly. See
// `docs/trustless-work-integration.md` in the invofi repo for the full plan.
//
// The one thing to understand about the TW API (their words): *the API never
// signs anything*. Every state-changing endpoint returns an unsigned XDR.
// The wallet signs it; you submit it:
//
//   1. BUILD  POST /escrow/single-release/v2/<action> → { unsignedXdr, txHash }
//   2. SIGN   your wallet signs unsignedXdr locally   → signedXdr
//   3. SUBMIT POST /stellar/send-transaction          → on-chain result
//
// Reads are separate plain GETs against the read-model. Docs:
//   https://docs.trustlesswork.com/trustless-work/v2-en/api-rest/introduction
//
// Deliberate choices:
//   - No HTTP dependency: `fetch` only (Node 18+ / all modern browsers).
//   - The adapter does NOT hold wallets: callers pass a `signTransaction`
//     callback (same shape as the main InvofiClient config), so the same
//     wallet-connection layer powers both.
//   - v2 single-release (not v1, not multi-release): new integrations are
//     pointed at v2 by TW's docs; multi-release can be added later without
//     changing these types (the deploy body is a superset).

// ── Types ────────────────────────────────────────────────────────────────────

/** Environments documented by Trustless Work. */
export type TrustlessWorkEnv = 'testnet' | 'mainnet';

export interface TrustlessWorkConfig {
  /** Which TW environment to hit. Defaults to `testnet`. */
  env?: TrustlessWorkEnv;
  /**
   * Overrides the derived base URL. Derived defaults:
   *   testnet → https://beta.api.trustlesswork.com  (Core API v2)
   *   mainnet → https://api.trustlesswork.com       (v1 API; v2 mainnet TBD)
   */
  baseUrl?: string;
  /** API key in TW's `id.secret` format — sent as the `x-api-key` header. */
  apiKey: string;
  /**
   * Signs the unsigned XDR each build endpoint returns. Same contract as
   * `InvofiClientConfig.signTransaction` — wire it to the same wallet kit.
   */
  signTransaction: (txXdr: string, networkPassphrase: string) => Promise<string>;
  /** Network passphrase handed to `signTransaction` (e.g. Networks.TESTNET). */
  networkPassphrase: string;
  /** Optional fetch override (tests, proxies). Defaults to globalThis.fetch. */
  fetchImpl?: FetchLike;
}

/** Minimal structural fetch type so the SDK needs no DOM/undici lib types. */
export interface FetchLike {
  (url: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}

/** v2 roles — arrays hold up to 5 distinct wallets each per TW's spec. */
export interface EscrowRoles {
  /** Wallets allowed to approve milestones (≤ 5, no duplicates). */
  approvers: string[];
  /** Wallets that perform the work / report milestone progress (≤ 5). */
  serviceProviders: string[];
  /** TW platform wallet — receives the platform fee. Fixed per environment. */
  platform: string;
  /** Wallets authorised to release funds once milestones are met (≤ 5). */
  releaseSigners: string[];
  /** Wallets that resolve disputes (≤ 5, must not overlap other roles). */
  disputeResolvers: string[];
  /** Final beneficiary of released funds. */
  receiver: string;
  /**
   * Admin wallet — signs update-escrow / manage-milestones / extend-ttl.
   * MUST be distinct from every other role (enforced by TW on-chain).
   */
  admin: string;
  /** Optional read-only observers. No on-chain authority. */
  observers?: string[];
}

/** v2 trustline — either a Soroban token contract id, or symbol+issuer. */
export interface EscrowTrustline {
  /** Soroban contract address of the asset (C…) — takes precedence. */
  contractId?: string;
  /** Asset code (e.g. `USDC`) — required when `contractId` is absent. */
  symbol?: string;
  /** Issuer account (G…) — required when `contractId` is absent. */
  address?: string;
}

export interface EscrowMilestone {
  description: string;
  /** Convention: `pending` → `in_progress` → `completed`. Defaults to pending. */
  status?: string;
  /** Distinct approvers required (≤ roles.approvers.length). Defaults to 1. */
  approvalsTarget?: number;
}

/** Body TW's `/escrow/single-release/v2/deploy` accepts. */
export interface DeployEscrowPayload {
  signer: string;
  engagementId: string;
  title: string;
  description: string;
  roles: EscrowRoles;
  /** Human-readable decimals (e.g. 100.5 = 100.5 USDC) — NOT stroops. */
  amount: number;
  /** Platform fee in percent (1 = 1%). */
  platformFee: number;
  milestones?: EscrowMilestone[];
  trustline: EscrowTrustline;
  /** Optional receiver memo (u32 on-chain). */
  receiverMemo?: number;
}

/** What every TW build endpoint returns. */
export interface UnsignedTransaction {
  unsignedXdr: string;
  txHash: string;
  /**
   * Deploy only: the address (C…) the escrow WILL have once the deploy tx
   * lands — known upfront, stable across re-preparations. Track the escrow
   * with it immediately after submission.
   */
  contractId?: string | null;
}

/** Response of TW's `/stellar/send-transaction`. */
export interface SendTransactionResult {
  success: boolean;
  /** Raw TW response — exact shape can evolve; treat as opaque unless `success`. */
  raw: unknown;
}

/**
 * Typed wrapper around TW's RFC 9457 Problem Details errors.
 * `code` is TW's stable machine-readable code — safe to switch on.
 */
export class TrustlessWorkError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly traceId?: string;
  /** The full Problem Details body, for fields we don't surface explicitly. */
  readonly problem: Record<string, unknown> | null;

  constructor(problem: {
    status?: number;
    code?: string;
    title?: string;
    detail?: string;
    traceId?: string;
    [k: string]: unknown;
  }, status?: number) {
    super(problem.detail ?? problem.title ?? `Trustless Work request failed (HTTP ${status ?? '?'})`);
    this.name = 'TrustlessWorkError';
    this.status = problem.status ?? status ?? 0;
    this.code = problem.code ?? 'UNKNOWN';
    this.detail = problem.detail ?? problem.title ?? '';
    this.traceId = typeof problem.traceId === 'string' ? problem.traceId : undefined;
    this.problem = problem as Record<string, unknown>;
    Object.setPrototypeOf(this, TrustlessWorkError.prototype);
  }
}

// ── InvoFi → TW domain mapping ───────────────────────────────────────────────
//
// Disbursement escrow for an accepted offer:
//
//   lender ──fund──▶ escrow ──release (milestone: delivery verified)──▶ originator
//
// Role mapping (documented in docs/trustless-work-integration.md, ADR draft):
//   receiver         = originator   (gets the financed amount)
//   serviceProviders = [originator] (the party fulfilling the invoice)
//   approvers        = [platform, lender] with approvalsTarget 1 — EITHER can
//                      approve the delivery milestone, so a slow platform can
//                      never strand the originator's funds
//   releaseSigners   = [platform]   (releases after approval)
//   disputeResolvers = [platform]   (invoice disputes map to TW disputes)
//   admin            = platform     (milestone management, TTL extension)

export interface DisbursementEscrowParams {
  /** Invoice id (InvoFi domain) — becomes part of the engagementId. */
  invoiceId: string;
  /** Offer id (InvoFi domain) — becomes part of the engagementId. */
  offerId: string;
  /** Financed amount in human-readable units (e.g. 1250.5 USDC). */
  amountHuman: number;
  /** Wallet that signs the deploy transaction — the lender (the funder). */
  lenderAddress: string;
  /** The business receiving the disbursement. */
  originatorAddress: string;
  /** InvoFi platform wallet (admin / release signer / dispute resolver). */
  platformAddress: string;
  /** InvoFi's platform fee on the disbursement, in percent. */
  platformFeePercent: number;
  trustline: EscrowTrustline;
  /** Optional receiver memo (u32 on-chain). */
  receiverMemo?: number;
}

/** The single delivery-verification milestone attached to every disbursement. */
export const DELIVERY_MILESTONE_DESCRIPTION =
  'Invoice delivery verified — the originator has delivered per the registered invoice and the disbursement is approved for release.';

/**
 * Maps InvoFi domain parameters onto TW's v2 deploy payload.
 * Exported for transparency and testing; `deployDisbursementEscrow` uses it.
 */
export function mapToDeployPayload(params: DisbursementEscrowParams): DeployEscrowPayload {
  return {
    signer: params.lenderAddress,
    engagementId: `invofi-${params.invoiceId}-${params.offerId}`,
    title: `InvoFi disbursement — invoice ${params.invoiceId}`,
    description:
      `Milestone-gated disbursement of invoice ${params.invoiceId} (offer ${params.offerId}) ` +
      'on InvoFi. Funds are released to the originator once delivery is verified; ' +
      'disputes route to the InvoFi platform dispute resolver.',
    roles: {
      approvers: [params.platformAddress, params.lenderAddress],
      serviceProviders: [params.originatorAddress],
      platform: params.platformAddress,
      releaseSigners: [params.platformAddress],
      disputeResolvers: [params.platformAddress],
      receiver: params.originatorAddress,
      admin: params.platformAddress,
    },
    amount: params.amountHuman,
    platformFee: params.platformFeePercent,
    milestones: [
      {
        description: DELIVERY_MILESTONE_DESCRIPTION,
        status: 'pending',
        approvalsTarget: 1,
      },
    ],
    trustline: params.trustline,
    ...(params.receiverMemo !== undefined ? { receiverMemo: params.receiverMemo } : {}),
  };
}

/** Builds the USDC testnet trustline (symbol + issuer) used by InvoFi flows. */
export function usdcTestnetTrustline(issuerAddress: string): EscrowTrustline {
  return { symbol: 'USDC', address: issuerAddress };
}

// ── Client factory ───────────────────────────────────────────────────────────

const DEFAULT_BASE_URLS: Record<TrustlessWorkEnv, string> = {
  testnet: 'https://beta.api.trustlesswork.com',
  mainnet: 'https://api.trustlesswork.com',
};

/**
 * Creates a typed Trustless Work client. Stateless apart from config —
 * create one per environment and reuse it.
 */
export function createTrustlessWorkClient(cfg: TrustlessWorkConfig) {
  const env: TrustlessWorkEnv = cfg.env ?? 'testnet';
  const baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URLS[env]).replace(/\/+$/, '');
  const fetchImpl: FetchLike = cfg.fetchImpl ?? ((url, init) => globalThis.fetch(url, init) as unknown as Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>);

  function headers(): Record<string, string> {
    if (!cfg.apiKey) throw new TrustlessWorkError({ status: 401, code: 'MISSING_API_KEY', title: 'Missing API key', detail: 'TrustlessWorkConfig.apiKey is empty — request one via the TW Backoffice.' }, 401);
    return { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey };
  }

  /** POST a build endpoint; maps Problem Details into TrustlessWorkError. */
  async function build<T extends UnsignedTransaction>(path: string, body: unknown): Promise<T> {
    const res = await fetchImpl(`${baseUrl}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) throw new TrustlessWorkError((data ?? {}) as Record<string, unknown>, res.status);
    const unsignedXdr = typeof data?.unsignedXdr === 'string' ? data.unsignedXdr : undefined;
    const txHash = typeof data?.txHash === 'string' ? data.txHash : undefined;
    if (!unsignedXdr || !txHash) {
      throw new TrustlessWorkError({ status: res.status, code: 'MALFORMED_RESPONSE', title: 'Unexpected response', detail: `Expected unsignedXdr+txHash from ${path}.` }, res.status);
    }
    return {
      unsignedXdr,
      txHash,
      contractId: typeof data?.contractId === 'string' ? data.contractId : (data?.contractId == null ? null : String(data.contractId)),
    } as T;
  }

  /** Signs an unsigned XDR with the configured wallet callback. */
  async function sign(unsignedXdr: string): Promise<string> {
    return cfg.signTransaction(unsignedXdr, cfg.networkPassphrase);
  }

  /** Submits a signed XDR through TW's helper endpoint. */
  async function submit(signedXdr: string): Promise<SendTransactionResult> {
    const res = await fetchImpl(`${baseUrl}/stellar/send-transaction`, { method: 'POST', headers: headers(), body: JSON.stringify({ signedXdr }) });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) throw new TrustlessWorkError((data ?? {}) as Record<string, unknown>, res.status);
    return { success: true, raw: data };
  }

  return {
    /** Base URL in use (exposed for logging/tests). */
    baseUrl,

    // ── Build endpoints (return unsigned XDR) ──────────────────────────────

    /** Build the deploy tx for a v2 single-release escrow. */
    buildDeploy(payload: DeployEscrowPayload): Promise<UnsignedTransaction> {
      return build('/escrow/single-release/v2/deploy', payload);
    },

    /** Build the fund tx moving `amount` human units into the escrow. */
    buildFund(contractId: string, signer: string, amount: number): Promise<UnsignedTransaction> {
      return build('/escrow/single-release/v2/fund', { contractId, signer, amount });
    },

    /** Build the release tx paying the escrow out to the receiver. */
    buildRelease(contractId: string, releaseSigner: string): Promise<UnsignedTransaction> {
      return build('/escrow/single-release/v2/release-funds', { contractId, releaseSigner });
    },

    // ── Sign + submit helpers ──────────────────────────────────────────────

    sign,

    submit,

    /**
     * One-shot convenience: build → sign → submit. Use the granular methods
     * instead when the UI must show the user the transaction before signing
     * (which the frontend usually should).
     */
    async buildSignSubmit<T extends UnsignedTransaction>(buildPromise: Promise<T>): Promise<{ built: T; submitted: SendTransactionResult }> {
      const built = await buildPromise;
      const signedXdr = await sign(built.unsignedXdr);
      const submitted = await submit(signedXdr);
      return { built, submitted };
    },

    // ── Reads (plain GET against the read-model) ───────────────────────────

    /** Fetch the authoritative read-model snapshot for one escrow. */
    async getEscrow(contractId: string): Promise<Record<string, unknown>> {
      const res = await fetchImpl(`${baseUrl}/escrows/${encodeURIComponent(contractId)}`, { method: 'GET', headers: headers() });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) throw new TrustlessWorkError((data ?? {}) as Record<string, unknown>, res.status);
      return (data?.data ?? data) as Record<string, unknown>;
    },

    // ── InvoFi domain helpers ──────────────────────────────────────────────

    /**
     * Builds the deploy tx for an InvoFi disbursement escrow (role mapping
     * per mapToDeployPayload). Returns the unsigned XDR plus the escrow's
     * future contractId — persist it against the offer immediately.
     */
    buildDisbursementEscrow(params: DisbursementEscrowParams): Promise<UnsignedTransaction> {
      return build('/escrow/single-release/v2/deploy', mapToDeployPayload(params));
    },
  };
}

export type TrustlessWorkClient = ReturnType<typeof createTrustlessWorkClient>;
