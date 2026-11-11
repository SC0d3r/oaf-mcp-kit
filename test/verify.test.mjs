import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { runVerify } from '../src/verify.mjs';

const fixture = fileURLToPath(new URL('./fixtures/fake-mcp-server.mjs', import.meta.url));

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeyHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

function fixtureOptions(extra = {}) {
  return {
    command: process.execPath,
    args: [fixture],
    env: { ...process.env, FAKE_PRIVATE_KEY_PEM: privateKeyPem },
    hubUrl: 'https://hub.test',
    limit: 3,
    timeoutMs: 10000,
    ...extra,
  };
}

test('runs the full handshake and verifies every signature', async () => {
  let lookups = 0;
  const fetchImpl = async (url) => {
    lookups += 1;
    assert.match(url, /\/v1\/agents\/agent_fixture$/);
    return { ok: true, json: async () => ({ agent: { publicKey: publicKeyHex } }) };
  };
  const report = await runVerify(fixtureOptions({ checkSignatures: true, fetchImpl }));

  assert.equal(report.ok, true, report.errors.join('; '));
  assert.equal(report.server.name, 'fake-oaf');
  assert.equal(report.protocolVersion, '2025-06-18');
  assert.deepEqual(report.tools.sort(), ['list_channels', 'read_channel']);
  assert.equal(report.channel, 'general');
  assert.equal(report.messages, 3);
  assert.deepEqual(report.signatures, { checked: 3, valid: 3, invalid: 0, skipped: 0 });
  assert.equal(lookups, 1, 'sender public key is fetched once and reused');
});

test('fails when the registered key does not match the signature', async () => {
  const other = generateKeyPairSync('ed25519');
  const otherHex = other.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  const report = await runVerify(
    fixtureOptions({
      checkSignatures: true,
      fetchImpl: async () => ({ ok: true, json: async () => ({ agent: { publicKey: otherHex } }) }),
    })
  );

  assert.equal(report.ok, false);
  assert.equal(report.checks.signatures, false);
  assert.equal(report.signatures.invalid, 3);
  assert.ok(report.errors.some((error) => error.includes('signature')));
});

test('an empty channel does not fail the signature check', async () => {
  const report = await runVerify(
    fixtureOptions({
      env: { ...process.env, FAKE_PRIVATE_KEY_PEM: privateKeyPem, FAKE_EMPTY: '1' },
      checkSignatures: true,
      fetchImpl: async () => {
        throw new Error('no agent lookup expected for an empty channel');
      },
    })
  );
  assert.equal(report.ok, true, report.errors.join('; '));
  assert.equal(report.messages, 0);
  assert.deepEqual(report.signatures, { checked: 0, valid: 0, invalid: 0, skipped: 0 });
});

test('times out when the server accepts input but never answers', async () => {
  const started = Date.now();
  const report = await runVerify(
    fixtureOptions({
      env: { ...process.env, FAKE_PRIVATE_KEY_PEM: privateKeyPem, FAKE_HANG: '1' },
      timeoutMs: 400,
    })
  );
  const elapsed = Date.now() - started;
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('timed out')));
  assert.ok(elapsed < 400 + 3500, `took ${elapsed}ms`);
});

test('fails when the server is not reachable', async () => {
  const report = await runVerify(
    fixtureOptions({
      command: path.join(fixture, 'does-not-exist'),
      args: [],
      timeoutMs: 2000,
    })
  );
  assert.equal(report.ok, false);
  assert.ok(report.errors.length > 0);
});
