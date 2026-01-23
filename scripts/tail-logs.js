#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const opts = {
  project: 'jeffharr-is',
  env: 'production',
  source: null,
  event: null,
  level: null,
  requestId: null,
  contains: null,
  sample: 1,
  pretty: false,
  raw: false
};

function readFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) return '';
  args.splice(index, 2);
  return value;
}

function hasFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function parseFloatSafe(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function showHelp() {
  const text = `Usage: node scripts/tail-logs.js [options]

Options:
  --project <name>     Pages project name (default: jeffharr-is)
  --env <name>         Pages environment (default: production)
  --source <name>      Filter by log source
  --event <name>       Filter by log event
  --level <name>       Filter by log level (info|warn|error)
  --request-id <id>    Filter by requestId
  --contains <text>    Filter by substring match on JSON line
  --sample <ratio>     Sampling ratio 0-1 (default: 1)
  --pretty             Emit compact one-line summaries
  --raw                Emit raw wrangler JSON lines when parsing fails
  --help               Show this help

Examples:
  node scripts/tail-logs.js --source read-later --level error
  node scripts/tail-logs.js --event cover_generation_failed --pretty
  node scripts/tail-logs.js --request-id <cf-ray> --pretty
`;
  console.log(text);
}

if (hasFlag('--help')) {
  showHelp();
  process.exit(0);
}

const project = readFlag('--project');
if (project) opts.project = project;
const env = readFlag('--env');
if (env) opts.env = env;
opts.source = readFlag('--source') || null;
opts.event = readFlag('--event') || null;
opts.level = readFlag('--level') || null;
opts.requestId = readFlag('--request-id') || null;
opts.contains = readFlag('--contains') || null;
const sample = readFlag('--sample');
if (sample) {
  const ratio = parseFloatSafe(sample);
  if (ratio !== null) {
    opts.sample = Math.max(0, Math.min(1, ratio));
  }
}
opts.pretty = hasFlag('--pretty');
opts.raw = hasFlag('--raw');

function normalizeMessage(message) {
  if (typeof message === 'string') {
    const trimmed = message.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return message;
      }
    }
    return message;
  }

  if (message && typeof message === 'object') {
    return message;
  }

  return null;
}

function extractMessages(entry) {
  if (!entry || typeof entry !== 'object') return [];

  if (Array.isArray(entry.logs)) {
    return entry.logs
      .map((log) => log?.message ?? log?.log ?? log?.text ?? log)
      .filter((value) => value !== undefined);
  }

  const direct = entry.message ?? entry.log ?? entry.text;
  if (direct !== undefined) return [direct];

  return [];
}

function matchesFilters(payload, rawLine) {
  if (!payload || typeof payload !== 'object') {
    if (opts.contains && rawLine && !rawLine.includes(opts.contains)) {
      return false;
    }
    return Boolean(opts.raw);
  }

  if (opts.source && payload.source !== opts.source) return false;
  if (opts.event && payload.event !== opts.event) return false;
  if (opts.level && payload.level !== opts.level) return false;
  if (opts.requestId && payload.requestId !== opts.requestId) return false;

  if (opts.contains) {
    const line = JSON.stringify(payload);
    if (!line.includes(opts.contains)) return false;
  }

  return true;
}

function formatPretty(payload) {
  const parts = [
    payload.timestamp || '',
    payload.level || '',
    payload.source || '',
    payload.event || ''
  ].filter(Boolean);

  const details = [
    payload.stage ? `stage=${payload.stage}` : null,
    payload.requestId ? `request=${payload.requestId}` : null,
    payload.url ? `url=${payload.url}` : null,
    payload.title ? `title=${payload.title}` : null,
    payload.status ? `status=${payload.status}` : null,
    payload.error ? `error=${payload.error}` : null
  ].filter(Boolean);

  const header = parts.join(' ');
  if (details.length === 0) return header;
  return `${header} ${details.join(' ')}`;
}

function shouldSample() {
  if (opts.sample >= 1) return true;
  return Math.random() <= opts.sample;
}

const wranglerArgs = [
  'wrangler',
  'pages',
  'deployment',
  'tail',
  '--project-name',
  opts.project,
  '--environment',
  opts.env,
  '--format',
  'json'
];

const child = spawn('npx', wranglerArgs, {
  stdio: ['inherit', 'pipe', 'pipe']
});

child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

const rl = createInterface({ input: child.stdout });
rl.on('line', (line) => {
  if (!line.trim()) return;
  if (!shouldSample()) return;

  let entry = null;
  try {
    entry = JSON.parse(line);
  } catch {
    if (opts.raw) {
      console.log(line);
    }
    return;
  }

  const messages = extractMessages(entry);
  if (messages.length === 0) {
    if (opts.raw) {
      console.log(JSON.stringify(entry));
    }
    return;
  }

  messages.forEach((message) => {
    const payload = normalizeMessage(message);
    if (!matchesFilters(payload, typeof message === 'string' ? message : '')) return;

    if (!payload || typeof payload !== 'object') {
      if (opts.raw) {
        console.log(message);
      }
      return;
    }

    if (opts.pretty) {
      console.log(formatPretty(payload));
    } else {
      console.log(JSON.stringify(payload));
    }
  });
});

child.on('close', (code) => {
  process.exitCode = code || 0;
});
