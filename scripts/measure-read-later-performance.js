#!/usr/bin/env node

const DEFAULT_URL = 'https://jeffharr.is/api/read-later';
const DEFAULT_RUNS = 5;

const args = process.argv.slice(2);
const targetUrl = stringArg(args) || DEFAULT_URL;
const runs = integerFlag(args, '--runs', DEFAULT_RUNS);

const results = [];

for (let index = 0; index < runs; index += 1) {
  const result = await measure(targetUrl);
  results.push(result);
  console.log(formatRun(index + 1, result));
}

console.log(formatSummary(results));

async function measure(url) {
  const startedAt = performance.now();
  const response = await fetch(url, {
    headers: {
      accept: 'application/json'
    }
  });
  const headersAt = performance.now();
  const text = await response.text();
  const endedAt = performance.now();
  let count = null;
  try {
    const parsed = JSON.parse(text);
    count = Number.isFinite(parsed?.count) ? parsed.count : null;
  } catch {
    count = null;
  }
  return {
    status: response.status,
    count,
    bytes: Buffer.byteLength(text),
    ttfbMs: headersAt - startedAt,
    totalMs: endedAt - startedAt
  };
}

function integerFlag(values, name, fallback) {
  const index = values.indexOf(name);
  if (index < 0) return fallback;
  const value = Number.parseInt(values[index + 1], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function stringArg(values) {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const previous = values[index - 1];
    if (!value.startsWith('--') && previous !== '--runs') return value;
  }
  return null;
}

function formatRun(index, result) {
  return [
    `run=${index}`,
    `status=${result.status}`,
    `count=${result.count ?? 'n/a'}`,
    `bytes=${result.bytes}`,
    `ttfb=${Math.round(result.ttfbMs)}ms`,
    `total=${Math.round(result.totalMs)}ms`
  ].join(' ');
}

function formatSummary(values) {
  const ttfb = values.map((value) => value.ttfbMs).sort((a, b) => a - b);
  const total = values.map((value) => value.totalMs).sort((a, b) => a - b);
  return [
    'summary',
    `runs=${values.length}`,
    `ttfb_avg=${Math.round(average(ttfb))}ms`,
    `ttfb_p50=${Math.round(percentile(ttfb, 0.5))}ms`,
    `ttfb_p95=${Math.round(percentile(ttfb, 0.95))}ms`,
    `total_avg=${Math.round(average(total))}ms`,
    `total_p50=${Math.round(percentile(total, 0.5))}ms`,
    `total_p95=${Math.round(percentile(total, 0.95))}ms`
  ].join(' ');
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.ceil(values.length * p) - 1);
  return values[index];
}
