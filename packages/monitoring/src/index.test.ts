import { describe, it, expect } from 'vitest';
import {
  assertAdminClaims,
  createAdminVerifier,
  emptyTotals,
  sumTotals,
  usageTransaction,
} from './index.js';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';

describe('monitoring authorization and aggregates', () => {
  it('verifies signed tokens and rejects wrong issuer, audience, expiry, or group', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const issuer = 'https://cognito-idp.ap-northeast-2.amazonaws.com/pool';
    const verify = createAdminVerifier(
      'ap-northeast-2',
      'pool',
      'client',
      createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'key' }] }),
    );
    const token = (
      overrides: { issuer?: string; audience?: string; expires?: string; group?: string } = {},
    ) =>
      new SignJWT({ token_use: 'id', 'cognito:groups': [overrides.group ?? 'monitoring-admins'] })
        .setProtectedHeader({ alg: 'RS256', kid: 'key' })
        .setIssuer(overrides.issuer ?? issuer)
        .setAudience(overrides.audience ?? 'client')
        .setExpirationTime(overrides.expires ?? '1m')
        .sign(privateKey);
    await expect(verify(await token())).resolves.toBeUndefined();
    for (const invalid of [
      { issuer: 'https://wrong.example' },
      { audience: 'other-client' },
      { expires: '-1s' },
      { group: 'users' },
    ])
      await expect(verify(await token(invalid))).rejects.toThrow();
    const { privateKey: otherKey } = await generateKeyPair('RS256');
    const forged = await new SignJWT({ token_use: 'id', 'cognito:groups': ['monitoring-admins'] })
      .setProtectedHeader({ alg: 'RS256', kid: 'key' })
      .setIssuer(issuer)
      .setAudience('client')
      .setExpirationTime('1m')
      .sign(otherKey);
    await expect(verify(forged)).rejects.toThrow();
  });
  it('requires both an ID token and the administrator group', () => {
    expect(() =>
      assertAdminClaims({ token_use: 'id', 'cognito:groups': ['monitoring-admins'] }),
    ).not.toThrow();
    for (const claims of [
      { token_use: 'access', 'cognito:groups': ['monitoring-admins'] },
      { token_use: 'id' },
      { token_use: 'id', 'cognito:groups': ['users'] },
      { token_use: 'id', 'cognito:groups': 'monitoring-admins' },
    ])
      expect(() => assertAdminClaims(claims)).toThrow();
  });
  it('makes deduplication and aggregate updates one atomic transaction', () => {
    const command = usageTransaction(
      'telemetry',
      {
        id: 'run-1',
        role: 'reading',
        model: 'model',
        succeeded: false,
        reported: true,
        requests: 2,
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
      },
      new Date('2026-10-04T23:00:00Z'),
    );
    const [dedupe, update] = command.input.TransactItems!;
    expect(dedupe?.Put?.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(dedupe?.Put?.Item).toMatchObject({ pk: 'EVENT#run-1' });
    expect(update?.Update?.Key).toEqual({ pk: 'DAY#2026-10-04', sk: 'AGENT#reading#model' });
    expect(update?.Update?.ExpressionAttributeValues).toMatchObject({
      ':failure': 1,
      ':requests': 2,
      ':total': 120,
      ':unreported': 0,
    });
    expect(JSON.stringify(command.input)).not.toMatch(/question|readingId|prompt|interpretation/);
  });
  it('sums failure and unreported counts with token totals', () => {
    expect(
      sumTotals([
        { ...emptyTotals(), runs: 2, failures: 1, inputTokens: 60 },
        { ...emptyTotals(), runs: 1, unreportedRuns: 1, inputTokens: 40 },
      ]),
    ).toEqual({ ...emptyTotals(), runs: 3, failures: 1, unreportedRuns: 1, inputTokens: 100 });
  });
});
