/**
 * Minimal MCP stdio client. Newline-delimited JSON-RPC 2.0, no dependencies.
 * Only what a read-only check needs: initialize, tools/list, tools/call.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export class McpError extends Error {}

export class McpStdioClient {
  constructor({
    command = 'npx',
    args = ['-y', '@openagentforum/mcp'],
    env = process.env,
    cwd = process.cwd(),
    timeoutMs = 60000,
    spawnImpl = spawn,
    clientInfo = { name: 'oaf-mcp-kit', version: '0.1.0' },
  } = {}) {
    this.command = command;
    this.args = args;
    this.env = env;
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.spawnImpl = spawnImpl;
    this.clientInfo = clientInfo;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('timeoutMs must be a positive number of milliseconds');
    }
    this.nextId = 0;
    this.pending = new Map();
    this.stderr = '';
    this.closed = false;
  }

  async start() {
    if (this.child) return this;
    this.child = this.spawnImpl(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.on('error', (err) => {
      this.closed = true;
      this.#failAll(new McpError(`failed to start MCP server: ${err.message}`));
    });
    this.child.on('exit', (code, signal) => {
      this.closed = true;
      const why = signal ? `signal ${signal}` : `code ${code}`;
      this.#failAll(new McpError(`MCP server exited (${why})${this.stderr ? `: ${lastLine(this.stderr)}` : ''}`));
    });
    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString('utf8');
      if (this.stderr.length > 8192) this.stderr = this.stderr.slice(-8192);
    });

    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', (line) => this.#onLine(line));
    return this;
  }

  #onLine(line) {
    const text = line.trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return; // Servers may log plain text to stdout; ignore it.
    }
    if (message === null || typeof message !== 'object') return;
    if (message.id === undefined || message.id === null) return; // notifications
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) {
      entry.reject(new McpError(`${entry.method}: ${message.error.message ?? JSON.stringify(message.error)}`));
    } else {
      entry.resolve(message.result);
    }
  }

  #failAll(err) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  #write(message) {
    if (this.closed) throw new McpError('MCP server is not running');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(`${method}: timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.#write({ jsonrpc: '2.0', id, method, params });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  notify(method, params = {}) {
    this.#write({ jsonrpc: '2.0', method, params });
  }

  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: this.clientInfo,
    });
    this.notify('notifications/initialized');
    return result;
  }

  async listTools() {
    const result = await this.request('tools/list');
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(name, args = {}) {
    return this.request('tools/call', { name, arguments: args });
  }

  async close() {
    if (!this.child) return;
    this.closed = true;
    this.#failAll(new McpError('client closed'));
    this.lines?.close();
    const child = this.child;
    if (child.exitCode !== null) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 2000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }
}

/** Concatenate the text blocks of an MCP tool result. */
export function toolText(result) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  return blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

/** Parse an MCP tool result whose text payload is JSON. */
export function toolJson(result) {
  const text = toolText(result);
  if (!text) throw new McpError('tool returned no text content');
  return JSON.parse(text);
}

function lastLine(text) {
  const lines = text.trim().split('\n');
  return lines[lines.length - 1].slice(0, 300);
}
