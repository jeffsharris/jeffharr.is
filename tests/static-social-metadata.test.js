import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const PAGES = [
  {
    file: 'index.html',
    canonical: 'https://jeffharr.is/',
    title: 'Jeff Harris',
    description: 'Building things, raising humans, tending my inner and outer worlds.',
    image: 'https://jeffharr.is/images/jeff-editorial-portrait.jpg',
    icon: '/apple-touch-icon.png',
    appTitle: 'Jeff Harris'
  },
  {
    file: 'poems/index.html',
    canonical: 'https://jeffharr.is/poems/',
    title: 'Poems | Jeff Harris',
    description: 'Poems I love',
    image: 'https://jeffharr.is/images/social/poems-card.jpg',
    icon: '/poems/apple-touch-icon.png',
    appTitle: 'Poems'
  },
  {
    file: 'read-later/index.html',
    canonical: 'https://jeffharr.is/read-later/',
    title: 'Read Later | Jeff Harris',
    description: 'My queue',
    image: 'https://jeffharr.is/images/social/read-later-card.jpg',
    icon: '/read-later/apple-touch-icon.png',
    appTitle: 'Read Later'
  },
  {
    file: 'share/index.html',
    canonical: 'https://jeffharr.is/share/',
    title: 'Share | Jeff Harris',
    description: 'Create rich, app-friendly share pages for podcasts, X posts, and links.',
    image: 'https://jeffharr.is/images/social/share-card.jpg',
    icon: '/share-assets/apple-touch-icon.png',
    appTitle: 'Share'
  },
  {
    file: 'dharma/index.html',
    canonical: 'https://jeffharr.is/dharma/',
    title: 'Dharma · Voices Shaping My Practice',
    description: 'Talks and teachings from dharma teachers shaping my practice.',
    image: 'https://jeffharr.is/dharma/dharma-preview.jpg',
    icon: '/dharma/apple-touch-icon.png',
    appTitle: 'Dharma'
  }
];

test('static consumable pages expose social preview metadata', () => {
  for (const page of PAGES) {
    const html = readFileSync(page.file, 'utf8');

    assert.match(html, new RegExp(`<link rel="canonical" href="${escapeRegExp(page.canonical)}">`), page.file);
    assert.match(html, new RegExp(`<meta property="og:title" content="${escapeRegExp(page.title)}">`), page.file);
    assert.match(html, new RegExp(`<meta property="og:description" content="${escapeRegExp(page.description)}">`), page.file);
    assert.match(html, new RegExp(`<meta property="og:url" content="${escapeRegExp(page.canonical)}">`), page.file);
    assert.match(html, new RegExp(`<meta property="og:image" content="${escapeRegExp(page.image)}">`), page.file);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/, page.file);
    assert.match(html, new RegExp(`<link rel="apple-touch-icon" sizes="180x180" href="${escapeRegExp(page.icon)}">`), page.file);
    assert.match(html, new RegExp(`<meta name="apple-mobile-web-app-title" content="${escapeRegExp(page.appTitle)}">`), page.file);

    const localImagePath = page.image.replace('https://jeffharr.is/', '');
    assert.ok(existsSync(localImagePath), `${page.file} image should exist at ${localImagePath}`);
    assert.ok(existsSync(page.icon.replace(/^\//, '')), `${page.file} icon should exist at ${page.icon}`);
  }
});

test('new static social cards use large preview dimensions', () => {
  for (const file of ['poems/index.html', 'read-later/index.html', 'share/index.html']) {
    const html = readFileSync(file, 'utf8');
    assert.match(html, /<meta property="og:image:width" content="1200">/, file);
    assert.match(html, /<meta property="og:image:height" content="630">/, file);
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
