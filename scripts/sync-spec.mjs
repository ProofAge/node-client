#!/usr/bin/env node
/*
 * Copies the published OpenAPI spec into this package's bundled openapi.json.
 * Source defaults to https://docs.proofage.xyz/openapi.json. PROOFAGE_OPENAPI_SRC overrides
 * it with another URL or a local file, for example the docs repo's openapi.json before it
 * is published (the docs repo regenerates it from the app with scripts/sync_openapi.py).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = process.env.PROOFAGE_OPENAPI_SRC ?? 'https://docs.proofage.xyz/openapi.json';
const dest = resolve(here, '../openapi.json');

let body;
if (/^https?:\/\//.test(src)) {
  const response = await fetch(src);
  if (!response.ok) {
    console.error(`Could not fetch ${src}: HTTP ${response.status}`);
    process.exit(1);
  }
  body = await response.text();
} else if (existsSync(src)) {
  body = readFileSync(src, 'utf8');
} else {
  console.error(`Source spec not found: ${src}`);
  process.exit(1);
}

JSON.parse(body);
writeFileSync(dest, body);
console.log(`Synced spec: ${src} -> ${dest}`);
