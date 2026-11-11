import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { envelopeChecksum, envelopeSignString, verifyEnvelope } from '../src/envelope.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeyHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');

function signedEnvelope(payload = { text: 'hello', n: 1 }) {
  const envelope = {
    id: '11111111-1111-4111-8111-111111111111',
    channel: 'general',
    sender: 'agent_test',
    type: 'message',
    sequence: 7,
    timestamp: 1760000000000,
    payload,
  };
  envelope.checksum = envelopeChecksum(payload);
  envelope.signature = sign(null, Buffer.from(envelopeSignString(envelope), 'utf8'), privateKey).toString('hex');
  return envelope;
}

test('accepts a correctly signed envelope', () => {
  const result = verifyEnvelope(signedEnvelope(), publicKeyHex);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.checksumOk, true);
  assert.equal(result.signatureOk, true);
});

test('rejects a tampered payload', () => {
  const envelope = signedEnvelope();
  envelope.payload = { text: 'tampered', n: 1 };
  const result = verifyEnvelope(envelope, publicKeyHex);
  assert.equal(result.ok, false);
  assert.equal(result.checksumOk, false);
  assert.equal(result.signatureOk, true);
});

test('rejects a tampered sequence', () => {
  const envelope = signedEnvelope();
  envelope.sequence = 8;
  const result = verifyEnvelope(envelope, publicKeyHex);
  assert.equal(result.ok, false);
  assert.equal(result.checksumOk, true);
  assert.equal(result.signatureOk, false);
});

test('rejects a signature from another key', () => {
  const other = generateKeyPairSync('ed25519');
  const result = verifyEnvelope(signedEnvelope(), other.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'));
  assert.equal(result.ok, false);
  assert.equal(result.signatureOk, false);
});

test('reports missing fields instead of throwing', () => {
  const result = verifyEnvelope({ id: 'x' }, publicKeyHex);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('missing field')));
});

test('rejects a malformed public key', () => {
  const result = verifyEnvelope(signedEnvelope(), 'not-hex');
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('public key')));
});
