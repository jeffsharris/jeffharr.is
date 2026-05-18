import { getNowIso, hashText } from './ids.js';
import { upsertAsset } from './db.js';

async function putJsonAsset({ db, bucket, itemId, role, key, value, contentType = 'application/json; charset=utf-8' }) {
  if (!bucket) throw new Error('Content asset bucket unavailable');
  const body = JSON.stringify(value);
  await bucket.put(key, body, {
    httpMetadata: { contentType },
    customMetadata: {
      itemId,
      role,
      createdAt: getNowIso()
    }
  });
  return upsertAsset(db, {
    itemId,
    role,
    kind: contentType.includes('html') ? 'html' : 'document',
    r2Key: key,
    mimeType: contentType,
    byteSize: new TextEncoder().encode(body).length,
    contentSha256: await hashText(body)
  });
}

async function getJsonAsset({ bucket, asset }) {
  if (!bucket || !asset?.r2_key) return null;
  const object = await bucket.get(asset.r2_key);
  if (!object) return null;
  return object.json();
}

async function putBinaryAsset({
  db,
  bucket,
  itemId,
  role,
  kind,
  key,
  bytes,
  contentType,
  extra = {}
}) {
  if (!bucket) throw new Error('Content asset bucket unavailable');
  await bucket.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      itemId,
      role,
      createdAt: getNowIso()
    }
  });
  return upsertAsset(db, {
    itemId,
    role,
    kind,
    r2Key: key,
    mimeType: contentType,
    byteSize: bytes?.byteLength || bytes?.length || null,
    contentSha256: await hashBytes(bytes),
    extra
  });
}

async function getBinaryAsset({ bucket, asset }) {
  if (!bucket || !asset?.r2_key) return null;
  const object = await bucket.get(asset.r2_key);
  if (!object) return null;
  return {
    bytes: await object.arrayBuffer(),
    contentType: object.httpMetadata?.contentType || asset.mime_type || 'application/octet-stream'
  };
}

async function hashBytes(bytes) {
  const source = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export {
  getBinaryAsset,
  getJsonAsset,
  putBinaryAsset,
  putJsonAsset
};
