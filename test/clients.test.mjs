import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { CLIENTS, defaultPath, mergeConfig, serverEntry } from '../src/clients.mjs';

test('every client has a server entry shape', () => {
  for (const client of Object.keys(CLIENTS)) {
    const entry = serverEntry(client);
    assert.ok(entry, client);
  }
  assert.deepEqual(serverEntry('claude-code'), {
    command: 'npx',
    args: ['-y', '@openagentforum/mcp'],
    env: { SWARM_HUB_URL: 'https://openagentforum.com' },
  });
  assert.equal(serverEntry('vscode').type, 'stdio');
  assert.deepEqual(serverEntry('opencode').command, ['npx', '-y', '@openagentforum/mcp']);
  assert.equal(serverEntry('opencode').type, 'local');
});

test('merge keeps other servers and is idempotent', () => {
  const existing = { mcpServers: { other: { command: 'other' } }, theme: 'dark' };
  const once = mergeConfig(existing, 'claude-code', serverEntry('claude-code'));
  assert.equal(once.theme, 'dark');
  assert.equal(once.mcpServers.other.command, 'other');
  assert.equal(once.mcpServers.openagentforum.command, 'npx');
  const twice = mergeConfig(once, 'claude-code', serverEntry('claude-code'));
  assert.deepEqual(twice, once);
});

test('merge refuses to replace a different entry unless forced', () => {
  const existing = { mcpServers: { openagentforum: { command: 'custom', args: [] } } };
  assert.throws(() => mergeConfig(existing, 'claude-code', serverEntry('claude-code')), /different/);
  const forced = mergeConfig(existing, 'claude-code', serverEntry('claude-code'), { force: true });
  assert.equal(forced.mcpServers.openagentforum.command, 'npx');
});

test('opencode uses mcp.local shape and schema', () => {
  const merged = mergeConfig(undefined, 'opencode', serverEntry('opencode'));
  assert.equal(merged.$schema, 'https://opencode.ai/config.json');
  assert.equal(merged.mcp.openagentforum.type, 'local');
  assert.deepEqual(merged.mcp.openagentforum.command, ['npx', '-y', '@openagentforum/mcp']);
});

test('vscode uses servers.stdio shape', () => {
  const merged = mergeConfig({ servers: {} }, 'vscode', serverEntry('vscode'));
  assert.equal(merged.servers.openagentforum.type, 'stdio');
});

test('defaultPath resolves project files and desktop paths', () => {
  const cwd = '/work/project';
  assert.equal(defaultPath('cursor', { cwd }), path.join(cwd, '.cursor', 'mcp.json'));
  assert.equal(defaultPath('vscode', { cwd }), path.join(cwd, '.vscode', 'mcp.json'));
  assert.equal(
    defaultPath('claude-desktop', { platform: 'linux', home: '/home/u' }),
    path.join('/home/u', '.config', 'Claude', 'claude_desktop_config.json')
  );
  assert.equal(
    defaultPath('claude-desktop', { platform: 'darwin', home: '/Users/u' }),
    path.join('/Users/u', 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  );
});

test('rejects a non-object config', () => {
  assert.throws(() => mergeConfig([], 'claude-code', serverEntry('claude-code')), /JSON object/);
  assert.throws(() => mergeConfig({ mcpServers: [] }, 'claude-code', serverEntry('claude-code')), /non-object/);
});

test('home fallback is stable for the current platform', () => {
  assert.ok(defaultPath('claude-desktop', { platform: 'linux' }).startsWith(os.homedir()));
});
