#!/usr/bin/env node
/*
 * Copies the app's generated OpenAPI spec into this package's bundled openapi.json.
 * Source defaults to the sibling app repo; override with PROOFAGE_OPENAPI_SRC.
 * Regenerate the source first in the app: `cd developer-docs && npm run generate:openapi`.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src =
  process.env.PROOFAGE_OPENAPI_SRC ??
  resolve(here, '../../proofageapp/developer-docs/public/openapi.json');
const dest = resolve(here, '../openapi.json');

if (!existsSync(src)) {
  console.error(`Source spec not found: ${src}`);
  console.error('Run `npm run generate:openapi` in the app, or set PROOFAGE_OPENAPI_SRC.');
  process.exit(1);
}

copyFileSync(src, dest);
console.log(`Synced spec: ${src} -> ${dest}`);
