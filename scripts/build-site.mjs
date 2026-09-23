import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import './build-collection-indexes.mjs';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
await rm(output, { recursive: true, force: true });
await mkdir(output);
// Only public assets enter the deployment; never publish the repository root.
const publicDirectories = ['css', 'dharma', 'images', 'js', 'poems', 'quotes', 'read-later', 'share', 'share-assets', 'trainingimages'];
const publicFiles = ['_headers', '_redirects', '_routes.json', 'apple-touch-icon.png', 'favicon.ico', 'favicon.gif'];
const htmlFiles = (await readdir(root)).filter(name => name.endsWith('.html'));
for (const name of [...publicDirectories, ...publicFiles, ...htmlFiles]) {
  await cp(new URL(name, root), new URL(name, output), {
    recursive: true, filter: source => !source.split('/').some(part => part.startsWith('.') && part !== '.')
  });
}
console.log('Built public assets in dist/.');
