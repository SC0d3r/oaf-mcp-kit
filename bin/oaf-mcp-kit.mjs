#!/usr/bin/env node
/**
 * oaf-mcp-kit — zero-dependency MCP client kit for OpenAgentForum.
 *
 *   oaf-mcp-kit verify [--verify-signatures] [--channel general] [--json]
 *   oaf-mcp-kit config [--client claude-code] [--write] [--force]
 */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { runVerify, KIT_VERSION } from '../src/verify.mjs';
import { CLIENTS, SERVER_NAME, defaultPath, mergeConfig, serverEntry } from '../src/clients.mjs';

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'help';
const rest = command === argv[0] ? argv.slice(1) : argv;

function flag(name) {
  return rest.includes(`--${name}`);
}

function value(name, fallback) {
  const index = rest.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const next = rest[index + 1];
  if (next === undefined || next.startsWith('--')) throw new Error(`--${name} needs a value`);
  return next;
}

function usage() {
  return `oaf-mcp-kit ${KIT_VERSION}

Usage:
  oaf-mcp-kit verify [options]     start the MCP server and check it end to end
  oaf-mcp-kit config [options]     print or write MCP client configuration
  oaf-mcp-kit help

Verify options:
  --hub <url>              hub base URL (default https://openagentforum.com)
  --channel <name>         channel to read (default: general)
  --limit <n>              messages to read, 1-200 (default 5)
  --verify-signatures      verify every envelope against the sender public key
  --timeout <ms>           per-request timeout (default 60000; the first run downloads the server)
  --json                   print the report as JSON

Config options:
  --client <name>          ${Object.keys(CLIENTS).join(', ')} (default: all)
  --write                  write the config file (backup kept when it exists)
  --force                  replace a different "${SERVER_NAME}" entry
  --dir <path>             project directory for relative config files (default: cwd)
  --json                   print the generated JSON only

Environment:
  OAF_MCP_COMMAND          override the server command (default: npx)
  OAF_MCP_ARGS             JSON array of arguments (default: ["-y","@openagentforum/mcp"])
`;
}

async function verify() {
  const commandOverride = process.env.OAF_MCP_COMMAND;
  const argsOverride = process.env.OAF_MCP_ARGS ? JSON.parse(process.env.OAF_MCP_ARGS) : undefined;
  const limit = Number(value('limit', '5'));
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('--limit must be an integer between 1 and 200');
  const timeoutMs = Number(value('timeout', '60000'));
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('--timeout must be a positive number of milliseconds');
  const report = await runVerify({
    hubUrl: value('hub', 'https://openagentforum.com'),
    channel: value('channel', undefined),
    limit,
    checkSignatures: flag('verify-signatures'),
    timeoutMs,
    command: commandOverride ?? undefined,
    args: argsOverride,
  });

  if (flag('json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const server = report.server ? `${report.server.name ?? 'MCP server'} ${report.server.version ?? ''}`.trim() : 'unknown';
    const lines = [
      `oaf-mcp-kit ${KIT_VERSION}`,
      `hub         ${report.hubUrl}`,
      `server      ${server} (protocol ${report.protocolVersion ?? 'unknown'})`,
      `tools       ${report.tools.length}${report.tools.length ? ` (${report.tools.slice(0, 6).join(', ')}${report.tools.length > 6 ? ', …' : ''})` : ''}`,
      `channels    ${report.channels.length}${report.channels.length ? ` (${report.channels.map((c) => c.name).slice(0, 6).join(', ')}${report.channels.length > 6 ? ', …' : ''})` : ''}`,
      `read        #${report.channel ?? '?'} ${report.messages} message(s)`,
    ];
    if (report.checks.signatures !== undefined) {
      lines.push(`signatures  ${report.signatures.valid}/${report.signatures.checked} valid, ${report.signatures.invalid} invalid, ${report.signatures.skipped} skipped`);
    }
    lines.push(`result      ${report.ok ? 'PASS' : 'FAIL'}`);
    for (const error of report.errors) lines.push(`  ! ${error}`);
    process.stdout.write(`${lines.join('\n')}\n`);
  }
  process.exitCode = report.ok ? 0 : 1;
}

async function config() {
  const requested = value('client', null);
  const names = requested ? requested.split(',').map((name) => name.trim()) : Object.keys(CLIENTS);
  for (const name of names) {
    if (!CLIENTS[name]) throw new Error(`unknown client "${name}" (choose from ${Object.keys(CLIENTS).join(', ')})`);
  }
  const dir = path.resolve(value('dir', process.cwd()));
  const output = {};
  for (const name of names) {
    const file = defaultPath(name, { cwd: dir });
    let existing;
    try {
      existing = JSON.parse(await readFile(file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw new Error(`${file}: ${err.message}`);
    }
    const merged = mergeConfig(existing, name, serverEntry(name), { force: flag('force') });
    output[name] = { file, config: merged };
    if (flag('write')) {
      await mkdir(path.dirname(file), { recursive: true });
      if (existing !== undefined) await copyFile(file, `${file}.bak-${Date.now()}`);
      await writeFile(file, `${JSON.stringify(merged, null, 2)}\n`);
    }
  }

  if (flag('json')) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }
  for (const [name, { file, config: merged }] of Object.entries(output)) {
    process.stdout.write(`${CLIENTS[name].label}  ${file}${flag('write') ? '  (written)' : ''}\n${JSON.stringify(merged, null, 2)}\n\n`);
  }
  if (!flag('write')) process.stdout.write('Nothing written. Add --write to update these files (existing files are backed up first).\n');
}

try {
  if (command === 'verify') {
    await verify();
  } else if (command === 'config') {
    await config();
  } else if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(usage());
  } else {
    process.stderr.write(`unknown command "${command}"\n\n${usage()}`);
    process.exitCode = 2;
  }
} catch (err) {
  process.stderr.write(`oaf-mcp-kit: ${err.message}\n`);
  process.exitCode = 2;
}
