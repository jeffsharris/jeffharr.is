import { readFile, writeFile } from 'node:fs/promises';
import { parsePoem } from '../functions/api/poems.js';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('poems/manifest.json', root), 'utf8'));
const slugs = [...new Set([...manifest.memorized, ...manifest.learning])];
const poems = await Promise.all(slugs.map(async slug => {
  const markdown = await readFile(new URL(`poems/content/${slug}.md`, root), 'utf8');
  const { title, author } = parsePoem(markdown);
  const content = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/)?.[1]?.trim();
  if (!title || !content) throw new Error(`Invalid poem: ${slug}`);
  return { slug, title, author, content, image: manifest.images?.[slug] || '' };
}));
await writeFile(new URL('poems/collection.json', root), JSON.stringify({ memorized: manifest.memorized, poems }) + '\n');

const counts = {};
for (const corpus of ['brensilver', 'burbea', 'watts']) {
  const data = JSON.parse(await readFile(new URL(`dharma/${corpus}/talks.json`, root), 'utf8'));
  counts[corpus] = (Array.isArray(data) ? data : data.talks || data.items || []).length;
}
await writeFile(new URL('dharma/counts.json', root), JSON.stringify(counts) + '\n');
console.log(`Indexed ${poems.length} poems and ${Object.values(counts).reduce((a, b) => a + b, 0)} talks.`);
