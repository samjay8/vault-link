import { describe, it, expect, vi } from 'vitest';
import {
  createTrustlessWorkClient,
  mapToDeployPayload,
  usdcTestnetTrustline,
  TrustlessWorkError,
  DELIVERY_MILESTONE_DESCRIPTION,
  type DisbursementEscrowParams,
  type FetchLike,
} from '../src/escrow';

const VALID_PARAMS: DisbursementEscrowParams = {
  invoiceId: 'inv_001',
  offerId: 'off_001',
  amountHuman: 1250.5,
  lenderAddress: 'GLender1111111111111111111111111111111111111111111',
  originatorAddress: 'GOrigin222222222222222222222222222222222222222222',
  platformAddress: 'GPlatform33333333333333333333333333333333333333333',
  platformFeePercent: 0.5,
  trustline: { symbol: 'USDC', address: 'GIssuer444444444444444444444444444444444444444444444' },
};

/** A fetch mock returning the given JSON for every request. */
function fetchOk(response: unknown, capture?: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[]): FetchLike {
  return (async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    if (capture) capture.push({ url, init });
    return { ok: true, status: 200, json: async () => response };
  }) as unknown as FetchLike;
}

function fetchProblem(status: number, problem: unknown): FetchLike {
  return (async () => ({ ok: false, status, json: async () => problem })) as unknown as FetchLike;
}

const XDR = { unsignedXdr: 'AAAAAgAAAAAtWsgedQ==', txHash: 'abc123', contractId: 'CEscrow999999999999999999999999999999999999999999' };

describe('mapToDeployPayload — InvoFi → TW role mapping', () => {
  it('maps the disbursement roles correctly', () => {
    const payload = mapToDeployPayload(VALID_PARAMS);
    expect(payload.signer).toBe(VALID_PARAMS.lenderAddress);
    expect(payload.engagementId).toBe('invofi-inv_001-off_001');
    expect(payload.roles.receiver).toBe(VALID_PARAMS.originatorAddress);
    expect(payload.roles.serviceProviders).toEqual([VALID_PARAMS.originatorAddress]);
    // Either the platform or the lender can approve delivery (never strands funds).
    expect(payload.roles.approvers).toEqual([VALID_PARAMS.platformAddress, VALID_PARAMS.lenderAddress]);
    expect(payload.roles.releaseSigners).toEqual([VALID_PARAMS.platformAddress]);
    expect(payload.roles.disputeResolvers).toEqual([VALID_PARAMS.platformAddress]);
    expect(payload.roles.admin).toBe(VALID_PARAMS.platformAddress);
  });

  it('attaches exactly one delivery-verification milestone', () => {
    const payload = mapToDeployPayload(VALID_PARAMS);
    expect(payload.milestones).toHaveLength(1);
    expect(payload.milestones![0].description).toBe(DELIVERY_MILESTONE_DESCRIPTION);
    expect(payload.milestones![0].approvalsTarget).toBe(1);
  });

  it('carries the human-readable amount and trustline through', () => {
    const payload = mapToDeployPayload(VALID_PARAMS);
    expect(payload.amount).toBe(1250.5);
    expect(payload.trustline).toEqual(VALID_PARAMS.trustline);
  });

  it('omits receiverMemo when absent and includes it when set', () => {
    expect(mapToDeployPayload(VALID_PARAMS).receiverMemo).toBeUndefined();
    const withMemo = mapToDeployPayload({ ...VALID_PARAMS, receiverMemo: 42 });
    expect(withMemo.receiverMemo).toBe(42);
  });

  it('usdcTestnetTrustline produces a symbol+issuer trustline', () => {
    expect(usdcTestnetTrustline('GIssuer444444444444444444444444444444444444444444444')).toEqual({
      symbol: 'USDC',
      address: 'GIssuer444444444444444444444444444444444444444444444',
    });
  });
});

describe('createTrustlessWorkClient — build/sign/submit loop', () => {
  it('sends x-api-key and posts the exact v2 deploy path', async () => {
    const calls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
    const client = createTrustlessWorkClient({
      env: 'testnet',
      apiKey: 'test-key-id.test-secret',
      networkPassphrase: 'Test SDF Network ; September 2015',
      signTransaction: async xdr => `signed(${xdr})`,
      fetchImpl: fetchOk(XDR, calls),
    });

    await client.buildDisbursementEscrow(VALID_PARAMS);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://beta.api.trustlesswork.com/escrow/single-release/v2/deploy');
    expect((calls[0].init!.headers as Record<string, string>)['x-api-key']).toBe('test-key-id.test-secret');
    const body = JSON.parse(calls[0].init!.body!);
    expect(body.signer).toBe(VALID_PARAMS.lenderAddress);
    expect(body.roles.receiver).toBe(VALID_PARAMS.originatorAddress);
  });

  it('buildFund and buildRelease post their v2 paths with the right bodies', async () => {
    const calls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
    const client = createTrustlessWorkClient({
      env: 'testnet',
      apiKey: 'k.s',
      networkPassphrase: 'test',
      signTransaction: async x => x,
      fetchImpl: fetchOk(XDR, calls),
    });

    await client.buildFund('CEscrow1', 'GFunder', 100);
    await client.buildRelease('CEscrow1', 'GReleaser');

    expect(calls[0].url).toContain('/escrow/single-release/v2/fund');
    expect(JSON.parse(calls[0].init!.body!)).toEqual({ contractId: 'CEscrow1', signer: 'GFunder', amount: 100 });
    expect(calls[1].url).toContain('/escrow/single-release/v2/release-funds');
    expect(JSON.parse(calls[1].init!.body!)).toEqual({ contractId: 'CEscrow1', releaseSigner: 'GReleaser' });
  });

  it('buildSignSubmit chains build → sign → submit and returns both results', async () => {
    const calls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
    const signSpy = vi.fn(async (xdr: string) => `SIGNED:${xdr}`);
    const client = createTrustlessWorkClient({
      env: 'testnet',
      apiKey: 'k.s',
      networkPassphrase: 'test',
      signTransaction: signSpy,
      fetchImpl: fetchOk({ ...XDR, contractId: null }, calls),
    });

    const { built, submitted } = await client.buildSignSubmit(client.buildFund('CEscrow1', 'GFunder', 10));
    expect(built.txHash).toBe('abc123');
    expect(signSpy).toHaveBeenCalledWith('AAAAAgAAAAAtWsgedQ==', 'test');
    expect(calls[1].url).toContain('/stellar/send-transaction');
    expect(JSON.parse(calls[1].init!.body!)).toEqual({ signedXdr: 'SIGNED:AAAAAgAAAAAtWsgedQ==' });
    expect(submitted.success).toBe(true);
  });

  it('getEscrow unwraps the read-model data envelope', async () => {
    const client = createTrustlessWorkClient({
      env: 'testnet',
      apiKey: 'k.s',
      networkPassphrase: 'test',
      signTransaction: async x => x,
      fetchImpl: fetchOk({ data: { contractId: 'CEscrow1', amount: '100.00' } }),
    });
    const escrow = await client.getEscrow('CEscrow1');
    expect(escrow.contractId).toBe('CEscrow1');
  });
});

describe('createTrustlessWorkClient — errors', () => {
  it('maps RFC 9457 Problem Details into TrustlessWorkError', async () => {
    const client = createTrustlessWorkClient({
      env: 'testnet',
      apiKey: 'k.s',
      networkPassphrase: 'test',
      signTransaction: async x => x,
      fetchImpl: fetchProblem(422, {
        type: 'https://docs.trustlesswork.com/errors/amount-out-of-range',
        title: 'Amount out of range',
        status: 422,
        code: 'AMOUNT_OUT_OF_RANGE',
        detail: 'Amount must be greater than zero.',
        traceId: 'tr-123',
      }),
    });

    await expect(client.buildFund('C1', 'G1', -5)).rejects.toMatchObject({
      name: 'TrustlessWorkError',
      status: 422,
      code: 'AMOUNT_OUT_OF_RANGE',
      detail: 'Amount must be greater than zero.',
      traceId: 'tr-123',
    });
  });

  it('flags a malformed build response even on HTTP 200', async () => {
    const client = createTrustlessWorkClient({
      env: 'testnet',
      apiKey: 'k.s',
      networkPassphrase: 'test',
      signTransaction: async x => x,
      fetchImpl: fetchOk({ unexpected: true }),
    });
    await expect(client.buildFund('C1', 'G1', 5)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
  });

  it('throws a typed 401 when the API key is missing', async () => {
    const client = createTrustlessWorkClient({
      env: 'testnet',
      apiKey: '',
      networkPassphrase: 'test',
      signTransaction: async x => x,
      fetchImpl: fetchOk(XDR),
    });
    await expect(client.buildFund('C1', 'G1', 5)).rejects.toMatchObject({ code: 'MISSING_API_KEY', status: 401 });
  });

  it('TrustlessWorkError works when constructed bare (client-side guard)', () => {
    const err = new TrustlessWorkError({ status: 401, code: 'MISSING_API_KEY', title: 'Missing API key', detail: 'x' }, 401);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('MISSING_API_KEY');
  });
});

describe('environment defaults', () => {
  it('mainnet defaults to the production base URL', async () => {
    const calls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
    const client = createTrustlessWorkClient({
      env: 'mainnet',
      apiKey: 'k.s',
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
      signTransaction: async x => x,
      fetchImpl: fetchOk(XDR, calls),
    });
    await client.buildFund('C1', 'G1', 1);
    expect(calls[0].url.startsWith('https://api.trustlesswork.com/')).toBe(true);
  });

  it('baseUrl override wins over the environment default', async () => {
    const calls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
    const client = createTrustlessWorkClient({
      env: 'testnet',
      baseUrl: 'https://tw.proxy.internal/',
      apiKey: 'k.s',
      networkPassphrase: 'test',
      signTransaction: async x => x,
      fetchImpl: fetchOk(XDR, calls),
    });
    await client.buildFund('C1', 'G1', 1);
    expect(calls[0].url.startsWith('https://tw.proxy.internal/')).toBe(true);
  });
});
