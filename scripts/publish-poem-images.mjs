#!/usr/bin/env node

import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  plan: 'notes/poem-image-publish-plan.json',
  reviewData: 'notes/poem-image-review-data.js',
  reviewPage: 'notes/poem-image-prompt-review.html',
  state: 'notes/poem-image-iteration-state.json',
  handoff: 'notes/poem-image-iteration-handoff.json',
  message: 'Publish finalized poem image replacements'
};

const REVIEW_DATA_RE = /^window\.POEM_IMAGE_REVIEW_DATA = (.*);\s*$/s;
const REVIEW_DATA_SRC_RE = /poem-image-review-data\.js\?v=[^"]+/;

main().catch((error) => {
  console.error(`publish-poem-images: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const planPath = resolveRepoPath(options.plan);
  const plan = await readJson(planPath);
  const replacements = normalizeReplacements(plan.replacements || []);

  if (!replacements.length) {
    console.log('No poem image replacements ready to publish.');
    return;
  }

  console.log(`Publishing ${replacements.length} poem image replacement${replacements.length === 1 ? '' : 's'}:`);
  for (const replacement of replacements) {
    console.log(`- ${replacement.title} (${replacement.source.id})`);
  }

  if (options.dryRun) {
    console.log('\nDry run only. No files changed.');
    return;
  }

  if (options.push) {
    assertOriginMainIsAncestor();
  }

  await publishImageFiles(replacements, options);
  await updateReviewData(replacements, options);
  await clearPublishedWorkflowState(replacements, options);

  if (!options.skipTests) {
    run('npm', ['test']);
  }

  if (options.commit || options.push) {
    await commitChanges(replacements, options);
  } else {
    console.log('\nPublished locally. Review the diff, then commit/push when ready.');
  }

  if (options.push) {
    pushToMain();
  }
}

function parseArgs(args) {
  const options = {
    ...DEFAULTS,
    dryRun: false,
    skipTests: false,
    commit: false,
    push: false,
    jpegQuality: '90'
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--skip-tests') {
      options.skipTests = true;
    } else if (arg === '--commit') {
      options.commit = true;
    } else if (arg === '--push') {
      options.push = true;
      options.commit = true;
    } else if (arg === '--plan') {
      options.plan = requireValue(args, ++index, arg);
    } else if (arg === '--review-data') {
      options.reviewData = requireValue(args, ++index, arg);
    } else if (arg === '--review-page') {
      options.reviewPage = requireValue(args, ++index, arg);
    } else if (arg === '--state') {
      options.state = requireValue(args, ++index, arg);
    } else if (arg === '--handoff') {
      options.handoff = requireValue(args, ++index, arg);
    } else if (arg === '--message') {
      options.message = requireValue(args, ++index, arg);
    } else if (arg === '--jpeg-quality') {
      options.jpegQuality = requireValue(args, ++index, arg);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function requireValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: npm run poem-images:publish -- [options]

Reads notes/poem-image-publish-plan.json, copies finalized candidates into poems/images,
updates review data so the replacements are marked published, clears stale workflow state,
and optionally commits/pushes.

Options:
  --dry-run             Print replacements without changing files
  --skip-tests          Skip npm test
  --commit              Stage and commit changed publish files
  --push                Commit, fetch origin, and push HEAD to main
  --message <text>      Commit message
  --jpeg-quality <n>    JPEG quality passed to sips, default 90
`);
}

function normalizeReplacements(replacements) {
  return replacements.map((replacement, index) => {
    const source = replacement.source || {};
    if (!replacement.slug) throw new Error(`Replacement ${index + 1} is missing slug`);
    if (!replacement.title) throw new Error(`Replacement ${replacement.slug} is missing title`);
    if (!source.id) throw new Error(`Replacement ${replacement.slug} is missing source.id`);
    if (!source.file) throw new Error(`Replacement ${replacement.slug} is missing source.file`);
    if (!replacement.target) throw new Error(`Replacement ${replacement.slug} is missing target`);

    return {
      slug: replacement.slug,
      title: replacement.title,
      source: {
        id: source.id,
        file: source.file
      },
      target: replacement.target
    };
  });
}

async function publishImageFiles(replacements, options) {
  for (const replacement of replacements) {
    const source = resolveRepoPath(replacement.source.file);
    const target = resolveRepoPath(replacement.target);
    await assertFile(source, `Source image not found for ${replacement.slug}`);
    await mkdir(path.dirname(target), { recursive: true });

    const sourceExt = path.extname(source).toLowerCase();
    const targetExt = path.extname(target).toLowerCase();
    if ((sourceExt === '.jpg' || sourceExt === '.jpeg') && (targetExt === '.jpg' || targetExt === '.jpeg')) {
      await copyFile(source, target);
    } else {
      run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', options.jpegQuality, source, '--out', target]);
    }
  }
}

async function updateReviewData(replacements, options) {
  const reviewDataPath = resolveRepoPath(options.reviewData);
  const reviewPagePath = resolveRepoPath(options.reviewPage);
  const raw = await readFile(reviewDataPath, 'utf8');
  const match = raw.match(REVIEW_DATA_RE);
  if (!match) throw new Error(`Could not parse ${options.reviewData}`);

  const data = JSON.parse(match[1]);
  const publishedCandidateIds = data.publishedCandidateIds || [];
  const preferredCandidateIds = data.preferredCandidateIds || {};

  for (const replacement of replacements) {
    if (!publishedCandidateIds.includes(replacement.source.id)) {
      publishedCandidateIds.push(replacement.source.id);
    }
    delete preferredCandidateIds[replacement.slug];
  }

  data.version = Number(data.version || 0) + 1;
  data.generatedAt = new Date().toISOString();
  data.publishedCandidateIds = publishedCandidateIds;
  data.preferredCandidateIds = preferredCandidateIds;

  await writeFile(
    reviewDataPath,
    `window.POEM_IMAGE_REVIEW_DATA = ${JSON.stringify(data, null, 2)};\n`
  );

  const cacheToken = `poem-image-review-data.js?v=${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-published-${Date.now()}`;
  const reviewPage = await readFile(reviewPagePath, 'utf8');
  if (!REVIEW_DATA_SRC_RE.test(reviewPage)) {
    throw new Error(`Could not find review data script tag in ${options.reviewPage}`);
  }
  await writeFile(reviewPagePath, reviewPage.replace(REVIEW_DATA_SRC_RE, cacheToken));
}

async function clearPublishedWorkflowState(replacements, options) {
  const publishedIds = new Set(replacements.map((replacement) => replacement.source.id));
  const publishedSlugs = new Set(replacements.map((replacement) => replacement.slug));
  const now = new Date().toISOString();

  const statePath = resolveRepoPath(options.state);
  const state = await readJsonIfPresent(statePath) || { version: 2, items: {} };
  const items = state.items || {};
  for (const slug of Object.keys(items)) {
    const item = items[slug] || {};
    if (!publishedSlugs.has(slug)) continue;
    if (publishedIds.has(item.contenderId)) {
      delete items[slug];
    }
  }
  await writeJson(statePath, { version: 2, items });

  const remainingIterating = Object.values(items).filter((item) => item?.mode === 'iterate').length;
  const handoffPath = resolveRepoPath(options.handoff);
  const previousHandoff = await readJsonIfPresent(handoffPath) || {};
  const iterating = (previousHandoff.iterating || []).filter((item) => !publishedSlugs.has(item.slug));
  const total = previousHandoff.counts?.total || 55;
  await writeJson(handoffPath, {
    version: 2,
    exportedAt: now,
    stateKey: 'jeffharr-poem-image-iteration-v1',
    counts: {
      total,
      iterating: iterating.length || remainingIterating,
      finalized: total - (iterating.length || remainingIterating),
      replacementsReady: 0
    },
    iterating,
    replacementsReady: []
  });

  const planPath = resolveRepoPath(options.plan);
  await writeJson(planPath, {
    version: 2,
    exportedAt: now,
    stateKey: 'jeffharr-poem-image-iteration-v1',
    summary: '0 poem image replacements ready for publish',
    publishSteps: [
      'Run npm run poem-images:publish -- --commit --push.'
    ],
    replacements: []
  });
}

async function commitChanges(replacements, options) {
  const files = [
    options.reviewData,
    options.reviewPage,
    ...replacements.map((replacement) => replacement.target)
  ];

  run('git', ['add', ...files]);
  run('git', ['commit', '-m', options.message]);
}

function pushToMain() {
  assertOriginMainIsAncestor();
  run('git', ['push', 'origin', 'HEAD:main']);
}

function assertOriginMainIsAncestor() {
  run('git', ['fetch', 'origin']);
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], {
    cwd: repoRoot,
    stdio: 'inherit'
  });
  if (ancestor.status !== 0) {
    throw new Error('origin/main is not an ancestor of HEAD. Rebase or merge before pushing.');
  }
}

function resolveRepoPath(relativePath) {
  const resolved = path.resolve(repoRoot, relativePath);
  if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error(`Path escapes repo root: ${relativePath}`);
  }
  return resolved;
}

async function assertFile(filePath, message) {
  try {
    const stats = await stat(filePath);
    if (stats.isFile()) return;
  } catch {
    // handled below
  }
  throw new Error(`${message}: ${path.relative(repoRoot, filePath)}`);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readJsonIfPresent(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
}
