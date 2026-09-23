import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

test('public build excludes private project files and bundles complete collections', async () => {
  execFileSync(process.execPath, ['scripts/build-site.mjs']);
  for (const path of ['.env.1password', 'AGENTS.md', 'notes', 'tests', 'scripts', 'workers', 'functions', 'node_modules', 'package.json']) {
    await assert.rejects(access(`dist/${path}`));
  }
  const manifest = JSON.parse(await readFile('poems/manifest.json', 'utf8'));
  const collection = JSON.parse(await readFile('dist/poems/collection.json', 'utf8'));
  assert.equal(collection.poems.length, new Set([...manifest.memorized, ...manifest.learning]).size);
  for (const poem of collection.poems) {
    const markdown = await readFile(`poems/content/${poem.slug}.md`, 'utf8');
    assert.ok(markdown.includes(poem.content));
    assert.equal(poem.image, manifest.images[poem.slug]);
  }
  const counts = JSON.parse(await readFile('dist/dharma/counts.json', 'utf8'));
  for (const [corpus, count] of Object.entries(counts)) {
    const data = JSON.parse(await readFile(`dharma/${corpus}/talks.json`, 'utf8'));
    assert.equal(count, (Array.isArray(data) ? data : data.talks || data.items).length);
  }
});
