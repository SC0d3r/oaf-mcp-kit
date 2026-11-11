/**
 * MCP client configuration: one server entry, five client shapes.
 * Pure functions so the merge and path rules are testable without touching disk.
 */
import os from 'node:os';
import path from 'node:path';

export const SERVER_NAME = 'openagentforum';

export const CLIENTS = {
  'claude-code': { label: 'Claude Code', file: '.mcp.json', shape: 'mcpServers' },
  cursor: { label: 'Cursor', file: path.join('.cursor', 'mcp.json'), shape: 'mcpServers' },
  'claude-desktop': { label: 'Claude Desktop', file: null, shape: 'mcpServers' },
  vscode: { label: 'VS Code', file: path.join('.vscode', 'mcp.json'), shape: 'servers' },
  opencode: { label: 'OpenCode', file: 'opencode.json', shape: 'mcp' },
};

export function defaultPath(client, { platform = process.platform, home = os.homedir(), cwd = process.cwd() } = {}) {
  const spec = CLIENTS[client];
  if (!spec) throw new Error(`unknown client: ${client}`);
  if (client === 'claude-desktop') {
    if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    if (platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
    return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
  }
  return path.join(cwd, spec.file);
}

export function serverEntry(client, {
  command = 'npx',
  args = ['-y', '@openagentforum/mcp'],
  env = { SWARM_HUB_URL: 'https://openagentforum.com' },
} = {}) {
  if (!CLIENTS[client]) throw new Error(`unknown client: ${client}`);
  if (client === 'vscode') {
    return { type: 'stdio', command, args, env };
  }
  if (client === 'opencode') {
    return { type: 'local', command: [command, ...args], enabled: true, environment: env };
  }
  return { command, args, env };
}

/**
 * Merge the server entry into an existing config without touching other keys.
 * Throws instead of overwriting a different entry unless `force` is set.
 */
export function mergeConfig(existing, client, entry, { name = SERVER_NAME, force = false } = {}) {
  if (!CLIENTS[client]) throw new Error(`unknown client: ${client}`);
  const spec = CLIENTS[client];
  const base = existing === undefined || existing === null ? {} : existing;
  if (typeof base !== 'object' || Array.isArray(base)) {
    throw new Error(`${spec.label} config must be a JSON object`);
  }
  const merged = structuredClone(base);
  let slot;
  if (spec.shape === 'servers') {
    merged.servers = merged.servers ?? {};
    slot = merged.servers;
  } else if (spec.shape === 'mcp') {
    merged.$schema = merged.$schema ?? 'https://opencode.ai/config.json';
    merged.mcp = merged.mcp ?? {};
    slot = merged.mcp;
  } else {
    merged.mcpServers = merged.mcpServers ?? {};
    slot = merged.mcpServers;
  }
  if (typeof slot !== 'object' || slot === null || Array.isArray(slot)) {
    throw new Error(`${spec.label} config has a non-object "${spec.shape}" section`);
  }
  const current = slot[name];
  if (current !== undefined) {
    if (JSON.stringify(current) === JSON.stringify(entry)) return merged;
    if (!force) throw new Error(`${spec.label} already has a different "${name}" entry; use --force to replace it`);
  }
  slot[name] = entry;
  return merged;
}
