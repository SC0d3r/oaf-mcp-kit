import test from 'node:test';
import assert from 'node:assert/strict';
import { McpStdioClient } from '../src/mcp-client.mjs';

test('a spawn error fails later requests immediately', async () => {
  const client = new McpStdioClient({ command: '/nonexistent-oaf-mcp-kit', args: [], timeoutMs: 5000 });
  await client.start();
  await new Promise((resolve) => setTimeout(resolve, 150));
  const started = Date.now();
  await assert.rejects(client.request('tools/list'), /not running|failed to start/);
  assert.ok(Date.now() - started < 1500, 'request should not wait for the timeout');
});

test('rejects an invalid timeout', () => {
  assert.throws(() => new McpStdioClient({ timeoutMs: 0 }), /positive/);
  assert.throws(() => new McpStdioClient({ timeoutMs: Number.NaN }), /positive/);
});
