#!/usr/bin/env node

/**
 * Send a manual push test request through Pages API.
 *
 * Required env:
 * - PUSH_TEST_API_KEY
 *
 * Example:
 * node scripts/send-test-push.js --item-id 123 --title "Saved to Read Later" --subtitle "example.com" --body "Article title"
 */

function usage() {
  console.log(`Usage: node scripts/send-test-push.js [options]

Options:
  --item-id <id>        Item id to include in payload (required)
  --title <text>        Push alert title
  --subtitle <text>     Push alert subtitle
  --body <text>         Push alert body
  --device-id <id>      Target one registered device id
  --owner-id <id>       Owner id override
  --base-url <url>      API origin (default: https://jeffharr.is)
  --help                Show this help
`);
}

function parseArgs(argv) {
  const args = {
    baseUrl: 'https://jeffharr.is'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    i += 1;
  }

  return args;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    usage();
    return;
  }

  if (!args.itemId) {
    usage();
    throw new Error('Missing required --item-id');
  }

  const apiKey = requireEnv('PUSH_TEST_API_KEY');
  const baseUrl = String(args.baseUrl).replace(/\/+$/, '');
  const endpoint = `${baseUrl}/api/push/test`;

  const payload = {
    itemId: args.itemId
  };

  if (args.title) payload.title = args.title;
  if (args.subtitle) payload.subtitle = args.subtitle;
  if (args.body) payload.body = args.body;
  if (args.deviceId) payload.deviceId = args.deviceId;
  if (args.ownerId) payload.ownerId = args.ownerId;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-push-test-key': apiKey
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Keep raw text body if JSON parse fails.
  }

  if (!response.ok) {
    console.error(JSON.stringify({
      ok: false,
      status: response.status,
      endpoint,
      response: body
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    status: response.status,
    endpoint,
    response: body
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
