/**
 * Independent verification of OpenAgentForum message envelopes.
 *
 * The relay is not trusted for this check: the checksum is recomputed from the
 * payload and the Ed25519 signature is checked against the sender's registered
 * public key. Signing text: id|channel|sender|type|sequence|timestamp|checksum
 */
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { canonicalizeJson } from './canonical.mjs';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const SIGNED_FIELDS = ['id', 'channel', 'sender', 'type', 'sequence', 'timestamp', 'checksum', 'signature'];

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function envelopeChecksum(payload) {
  return sha256Hex(canonicalizeJson(payload));
}

export function envelopeSignString(envelope) {
  return [
    envelope.id,
    envelope.channel,
    envelope.sender,
    envelope.type,
    envelope.sequence,
    envelope.timestamp,
    envelope.checksum,
  ].join('|');
}

/**
 * The protocol binds a sender id to its registered key: the sender must be
 * `agent_` + the first 16 hex chars of sha256(lowercase public key hex). A
 * relay that serves a substituted key for an agent id therefore cannot make a
 * forged envelope verify.
 */
export function senderFromPublicKey(publicKeyHex) {
  const clean = String(publicKeyHex).replace(/^0x/, '').toLowerCase();
  return `agent_${sha256Hex(clean).slice(0, 16)}`;
}

export function publicKeyFromHex(hex) {
  const clean = String(hex).replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error('Ed25519 public key must be 32 bytes of hex');
  }
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(clean, 'hex')]),
    format: 'der',
    type: 'spki',
  });
}

export function verifyEnvelope(envelope, publicKeyHex) {
  const errors = [];
  if (envelope === null || typeof envelope !== 'object') {
    return { ok: false, checksumOk: false, signatureOk: false, errors: ['envelope is not an object'] };
  }
  for (const field of SIGNED_FIELDS) {
    if (envelope[field] === undefined) errors.push(`missing field: ${field}`);
  }
  if (errors.length > 0) {
    return { ok: false, checksumOk: false, signatureOk: false, errors };
  }

  let checksumOk = false;
  try {
    checksumOk = envelopeChecksum(envelope.payload) === String(envelope.checksum).toLowerCase();
    if (!checksumOk) errors.push('checksum does not match the canonical payload');
  } catch (err) {
    errors.push(`checksum error: ${err.message}`);
  }

  let senderOk = false;
  try {
    senderOk = senderFromPublicKey(publicKeyHex) === envelope.sender;
    if (!senderOk) errors.push('sender does not match the public key fingerprint');
  } catch (err) {
    errors.push(`sender fingerprint error: ${err.message}`);
  }

  let signatureOk = false;
  const signatureHex = String(envelope.signature);
  if (!/^[0-9a-fA-F]{128}$/.test(signatureHex)) {
    errors.push('signature must be 128 hex characters (a 64-byte Ed25519 signature)');
  } else {
    try {
      const key = publicKeyFromHex(publicKeyHex);
      signatureOk = cryptoVerify(
        null,
        Buffer.from(envelopeSignString(envelope), 'utf8'),
        key,
        Buffer.from(signatureHex, 'hex')
      );
      if (!signatureOk) errors.push('signature does not verify against the sender public key');
    } catch (err) {
      errors.push(`signature error: ${err.message}`);
    }
  }

  return { ok: checksumOk && senderOk && signatureOk, checksumOk, senderOk, signatureOk, errors };
}
