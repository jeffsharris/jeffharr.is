#!/usr/bin/env node

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8766;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const STATE_FILE = 'notes/poem-image-iteration-state.json';
const HANDOFF_FILE = 'notes/poem-image-iteration-handoff.json';
const PUBLISH_PLAN_FILE = 'notes/poem-image-publish-plan.json';
const REVIEW_PAGE = '/notes/poem-image-prompt-review.html';

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp']
]);

export function createPoemImageReviewServer({
  root = process.cwd(),
  stateFile = STATE_FILE,
  handoffFile = HANDOFF_FILE,
  publishPlanFile = PUBLISH_PLAN_FILE
} = {}) {
  const repoRoot = path.resolve(root);
  const files = {
    state: path.join(repoRoot, stateFile),
    handoff: path.join(repoRoot, handoffFile),
    publishPlan: path.join(repoRoot, publishPlanFile)
  };

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://local.poem-images');

      if (url.pathname === '/api/poem-image-iteration/state') {
        await handleStateApi(request, response, files);
        return;
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }

      if (url.pathname === '/') {
        response.writeHead(302, { Location: REVIEW_PAGE });
        response.end();
        return;
      }

      await serveStatic(request, response, repoRoot, url.pathname);
    } catch (error) {
      console.error(error);
      sendJson(response, 500, { error: 'Internal server error' });
    }
  });
}

async function handleStateApi(request, response, files) {
  if (request.method === 'GET') {
    const state = await readJsonIfPresent(files.state);
    sendJson(response, 200, {
      state,
      files: {
        state: files.state,
        handoff: files.handoff,
        publishPlan: files.publishPlan
      }
    });
    return;
  }

  if (request.method === 'PUT') {
    const payload = await readJsonBody(request);
    const state = payload.state || payload;
    if (!isIterationState(state)) {
      sendJson(response, 400, { error: 'Expected an iteration state object with version and items' });
      return;
    }

    await writeJsonAtomic(files.state, state);
    if (payload.handoff) await writeJsonAtomic(files.handoff, payload.handoff);
    if (payload.publishPlan) await writeJsonAtomic(files.publishPlan, payload.publishPlan);

    sendJson(response, 200, {
      ok: true,
      savedAt: new Date().toISOString(),
      files: {
        state: files.state,
        handoff: files.handoff,
        publishPlan: files.publishPlan
      }
    });
    return;
  }

  sendJson(response, 405, { error: 'Method not allowed' });
}

async function serveStatic(request, response, repoRoot, requestPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    sendJson(response, 400, { error: 'Bad request path' });
    return;
  }

  const normalized = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(repoRoot, normalized);
  const resolved = path.resolve(filePath);
  if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${path.sep}`)) {
    sendJson(response, 403, { error: 'Forbidden' });
    return;
  }

  let stats;
  try {
    stats = await stat(resolved);
  } catch {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  if (!stats.isFile()) {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  response.writeHead(200, {
    'Content-Type': MIME_TYPES.get(path.extname(resolved).toLowerCase()) || 'application/octet-stream',
    'Content-Length': stats.size,
    'Cache-Control': 'no-store'
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(resolved).pipe(response);
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw new Error('Request body too large');
    }
  }
  return JSON.parse(body || '{}');
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomic(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, text);
  await rename(tempPath, filePath);
}

function isIterationState(value) {
  return Boolean(value && typeof value === 'object' && value.version && value.items && typeof value.items === 'object');
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload, null, 2));
}

function parseArgs(argv) {
  const options = {
    host: process.env.HOST || DEFAULT_HOST,
    port: Number(process.env.PORT || DEFAULT_PORT),
    root: process.cwd()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--host') options.host = argv[++index] || options.host;
    if (arg === '--port') options.port = Number(argv[++index] || options.port);
    if (arg === '--root') options.root = argv[++index] || options.root;
  }

  return options;
}

if (import.meta.url === pathToFileURL(fileURLToPath(import.meta.url)).href && process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const server = createPoemImageReviewServer({ root: options.root });
  server.listen(options.port, options.host, () => {
    console.log(`Poem image review server: http://${options.host}:${options.port}${REVIEW_PAGE}`);
    console.log(`State file: ${path.resolve(options.root, STATE_FILE)}`);
    console.log(`Handoff file: ${path.resolve(options.root, HANDOFF_FILE)}`);
    console.log(`Publish plan file: ${path.resolve(options.root, PUBLISH_PLAN_FILE)}`);
  });
}
