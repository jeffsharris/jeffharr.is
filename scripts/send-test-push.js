#!/usr/bin/env node

/**
 * Send a manual push test request through Pages API.
 *
 * Required env:
 * - PUSH_TEST_API_KEY
 *
 * Example:
 * node scripts/send-test-push.js --item-id 123 --title "Saved to Read Later" --subtitle "example.com" --body "Article title" --cover-url "https://example.com/cover.jpg" --data-json '{"channel":"read-later","itemId":"123"}'
 */

function usage() {
  console.log(`Usage: node scripts/send-test-push.js [options]

Options:
  --item-id <id>        Item id to include in payload (required)
  --title <text>        Push alert title
  --subtitle <text>     Push alert subtitle
  --body <text>         Push alert body
  --cover-url <url>     Cover image URL for payload (rich media candidate)
  --image-url <url>     Alias for --cover-url
  --media-url <url>     Generic media URL (first attachment)
  --media-type <type>   Generic media type (default: image)
  --thread-id <id>      APNs thread-id for notification grouping
  --category <id>       APNs category identifier
  --target-content-id <id> APNs target-content-id for updates
  --interruption-level <level> APNs level (passive|active|time-sensitive|critical)
  --relevance-score <0-1> APNs relevance score
  --mutable-content <bool> Force APS mutable-content (true/false/1/0)
  --data-json <json>    Custom data object payload (e.g. '{"route":"read-later"}')
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

function parseJsonObject(value, flagName) {
  if (!value) return null;
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Invalid JSON for ${flagName}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${flagName} must be a JSON object`);
  }

  return parsed;
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

  if (args.dataJson) payload.data = parseJsonObject(args.dataJson, '--data-json');
  if (args.deviceId) payload.deviceId = args.deviceId;
  if (args.ownerId) payload.ownerId = args.ownerId;

  const mediaURL = args.mediaUrl || args.coverUrl || args.imageUrl;
  const mediaType = args.mediaType || 'image';
  const notification = {};
  if (args.title || args.subtitle || args.body) {
    notification.alert = {};
    if (args.title) notification.alert.title = args.title;
    if (args.subtitle) notification.alert.subtitle = args.subtitle;
    if (args.body) notification.alert.body = args.body;
  }
  if (args.threadId) notification.threadId = args.threadId;
  if (args.category) notification.category = args.category;
  if (args.targetContentId) notification.targetContentId = args.targetContentId;
  if (args.interruptionLevel) notification.interruptionLevel = args.interruptionLevel;
  if (args.relevanceScore) notification.relevanceScore = args.relevanceScore;
  if (args.mutableContent) notification.mutableContent = args.mutableContent;
  if (mediaURL) {
    notification.media = [{ type: mediaType, url: mediaURL }];
  }

  payload.notification = Object.keys(notification).length > 0
    ? notification
    : {
      alert: {
        title: 'Sukha Test Push',
        subtitle: 'Sukha',
        body: `Triggered at ${new Date().toISOString()}`
      },
      media: []
    };

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
