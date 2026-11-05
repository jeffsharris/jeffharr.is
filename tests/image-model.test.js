import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ensureCoverImage } from '../functions/api/read-later/covers.js';

const model = 'gpt-image-2.6-sunburst';
const item = { id: 'cover-test', title: 'Test cover', url: 'https://example.com/article' };
const reader = { contentHtml: `<p>${'A quiet morning in the garden. '.repeat(20)}</p>` };
const assetStore = { getCover: async () => null, saveCover: async (_, cover) => cover };

function assertPayload(payload) {
  assert.equal(payload.model, 'gpt-5.5');
  assert.equal(payload.tools[0].model, model);
  assert.equal(payload.tools[0].quality, 'high');
  assert.equal(payload.tools[0].size, '1024x1536');
  assert.equal(payload.tools[0].output_format, 'png');
}

test('article covers and prompt retries use Sunburst without changing output settings', async (t) => {
  const payloads = [];
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    payloads.push(JSON.parse(options.body));
    return Response.json({ output: payloads.length === 1 ? [] : [{ type: 'image_generation_call', result: 'aW1hZ2U=' }] });
  });
  const cover = await ensureCoverImage({ item, reader, assetStore, env: { OPENAI_API_KEY: 'test-key' } });
  assert.equal(cover.base64, 'aW1hZ2U=');
  assert.equal(payloads.length, 2);
  payloads.forEach(assertPayload);
});

test('streaming covers use Sunburst and preserve partial-image events', async (t) => {
  const partials = [];
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    const payload = JSON.parse(options.body);
    assertPayload(payload);
    assert.equal(payload.stream, true);
    assert.equal(payload.tools[0].partial_images, 2);
    const events = [
      { type: 'response.image_generation_call.partial_image', partial_image_b64: 'cGFydGlhbA==', partial_image_index: 0 },
      { type: 'response.output_item.done', item: { type: 'image_generation_call', result: 'aW1hZ2U=' } }
    ];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
  });
  const cover = await ensureCoverImage({ item, reader, assetStore, env: { OPENAI_API_KEY: 'test-key' }, onPartial: p => partials.push(p) });
  assert.equal(cover.base64, 'aW1hZ2U=');
  assert.deepEqual(partials, [{ index: 0, base64: 'cGFydGlhbA==' }]);
});

test('poem generation instructions select Sunburst separately from historical candidate models', () => {
  const review = readFileSync(new URL('../notes/poem-image-prompt-review.html', import.meta.url), 'utf8');
  const builder = readFileSync(new URL('../scripts/build-poem-image-prompts.js', import.meta.url), 'utf8');
  for (const source of [review, builder]) assert.ok(source.includes(`imageModel: '${model}'`));
  assert.match(review, /model: candidate\.model \|\| 'gpt-image-2'/);
  assert.ok(builder.includes(`companion images with \`${model}\``));
});
