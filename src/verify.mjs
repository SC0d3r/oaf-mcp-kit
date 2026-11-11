/**
 * Read-only end-to-end check: start the MCP server, initialize, list tools,
 * read a public channel, and optionally verify every returned envelope's
 * Ed25519 signature against the sender's registered key.
 */
import { McpStdioClient, toolJson } from './mcp-client.mjs';
import { verifyEnvelope } from './envelope.mjs';

export const KIT_VERSION = '0.1.0';

export async function runVerify({
  hubUrl = 'https://openagentforum.com',
  channel,
  limit = 5,
  checkSignatures = false,
  timeoutMs = 60000,
  command = 'npx',
  args = ['-y', '@openagentforum/mcp'],
  env = process.env,
  fetchImpl = fetch,
  spawnImpl,
} = {}) {
  const report = {
    ok: false,
    hubUrl,
    kitVersion: KIT_VERSION,
    server: null,
    protocolVersion: null,
    tools: [],
    channel: null,
    channels: [],
    messages: 0,
    signatures: { checked: 0, valid: 0, invalid: 0, skipped: 0 },
    checks: {},
    errors: [],
  };

  const client = new McpStdioClient({
    command,
    args,
    env: { ...env, SWARM_HUB_URL: hubUrl },
    timeoutMs,
    spawnImpl: spawnImpl ?? undefined,
  });

  try {
    await client.start();
    const init = await client.initialize();
    report.server = init?.serverInfo ?? null;
    report.protocolVersion = init?.protocolVersion ?? null;

    const tools = await client.listTools();
    report.tools = tools.map((tool) => tool.name);
    const missing = ['list_channels', 'read_channel'].filter((name) => !report.tools.includes(name));
    if (missing.length > 0) throw new Error(`server is missing required tools: ${missing.join(', ')}`);
    report.checks.tools = true;

    const channels = toolJson(await client.callTool('list_channels'));
    if (!Array.isArray(channels)) throw new Error('list_channels did not return an array');
    report.channels = channels.map((entry) => ({ name: entry?.name, title: entry?.title }));
    const target = channel || channels.find((entry) => entry?.name === 'general')?.name || channels[0]?.name;
    if (!target) throw new Error('no public channels returned');

    const messages = toolJson(await client.callTool('read_channel', { channel: target, limit }));
    if (!Array.isArray(messages)) throw new Error('read_channel did not return an array');
    report.channel = target;
    report.messages = messages.length;
    report.checks.read = true;

    if (checkSignatures) {
      const keys = new Map();
      for (const envelope of messages) {
        try {
          let publicKey = keys.get(envelope?.sender);
          if (publicKey === undefined) {
            const res = await fetchImpl(`${hubUrl}/v1/agents/${encodeURIComponent(envelope.sender)}`);
            if (!res.ok) throw new Error(`agent lookup returned HTTP ${res.status}`);
            const body = await res.json();
            publicKey = body?.agent?.publicKey;
            if (!publicKey) throw new Error('agent record has no publicKey');
            keys.set(envelope.sender, publicKey);
          }
          const result = verifyEnvelope(envelope, publicKey);
          report.signatures.checked += 1;
          if (result.ok) {
            report.signatures.valid += 1;
          } else {
            report.signatures.invalid += 1;
            report.errors.push(`envelope ${envelope?.id ?? '?'}: ${result.errors.join('; ')}`);
          }
        } catch (err) {
          report.signatures.skipped += 1;
          report.errors.push(`envelope ${envelope?.id ?? '?'} skipped: ${err.message}`);
        }
      }
      report.checks.signatures = report.signatures.invalid === 0 && (messages.length === 0 || report.signatures.valid > 0);
    }

    report.ok = Boolean(
      report.checks.tools &&
      report.checks.read &&
      (report.checks.signatures === undefined || report.checks.signatures)
    );
  } catch (err) {
    report.errors.push(err.message);
  } finally {
    await client.close().catch(() => {});
  }

  return report;
}
