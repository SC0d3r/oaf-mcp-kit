#!/usr/bin/env node
/**
 * Fixture MCP server used by the tests. It speaks newline-delimited JSON-RPC
 * over stdio and returns real Ed25519-signed envelopes, so the verification
 * path is exercised without network access.
 */
import { createInterface } from 'node:readline';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { envelopeChecksum, envelopeSignString, senderFromPublicKey } from '../../src/envelope.mjs';

const privateKey = process.env.FAKE_PRIVATE_KEY_PEM
  ? createPrivateKey(process.env.FAKE_PRIVATE_KEY_PEM)
  : generateKeyPairSync('ed25519').privateKey;

const publicKeyHex = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const sender = process.env.FAKE_SENDER || senderFromPublicKey(publicKeyHex);
const channels = [
  { name: 'general', title: 'General', isPrivate: false },
  { name: 'intel-exchange', title: 'Intel exchange', isPrivate: false },
];

function makeEnvelope(index, channel = 'general') {
  const envelope = {
    id: `00000000-0000-4000-8000-00000000000${index}`,
    channel,
    sender,
    type: 'message',
    sequence: index,
    timestamp: 1760000000000 + index,
    payload: { text: `fixture message ${index}`, tags: ['test', 'fixture'] },
  };
  envelope.checksum = envelopeChecksum(envelope.payload);
  envelope.signature = sign(null, Buffer.from(envelopeSignString(envelope), 'utf8'), privateKey).toString('hex');
  return envelope;
}

const messages = process.env.FAKE_EMPTY === '1' ? [] : [makeEnvelope(1), makeEnvelope(2), makeEnvelope(3)];

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (process.env.FAKE_HANG === '1') return; // accept input, never answer
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return; // notifications/initialized

  if (message.method === 'initialize') {
    reply(message.id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'fake-oaf', version: '0.0.1' },
    });
    return;
  }
  if (message.method === 'tools/list') {
    reply(message.id, {
      tools: [
        { name: 'list_channels', description: 'list channels', inputSchema: { type: 'object', properties: {} } },
        { name: 'read_channel', description: 'read a channel', inputSchema: { type: 'object', properties: {} } },
      ],
    });
    return;
  }
  if (message.method === 'tools/call') {
    const name = message.params?.name;
    if (name === 'list_channels') {
      reply(message.id, { content: [{ type: 'text', text: JSON.stringify(channels) }] });
      return;
    }
    if (name === 'read_channel') {
      reply(message.id, { content: [{ type: 'text', text: JSON.stringify(messages) }] });
      return;
    }
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } })}\n`);
});
