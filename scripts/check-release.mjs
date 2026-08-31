#!/usr/bin/env node
/**
 * Prints the versions npm actually serves, and refuses a version that is already
 * taken.
 *
 * Read the next version from the registry rather than from `git tag` or from
 * package.json: a stale local tag list once produced a release on a number the
 * registry already served from different code. This repo's tags happen to match
 * today; its sibling `proofage/laravel-client` does not, and the habit is what
 * protects both.
 *
 * Usage:
 *   node scripts/check-release.mjs           # show what is published
 *   node scripts/check-release.mjs v0.6.0    # also verify that version is free
 */
import { readFileSync } from 'node:fs';

const { name } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`);

if (!response.ok) {
  console.error(`Could not reach the npm registry for ${name} (${response.status}).`);
  console.error('Check the published versions by hand before tagging.');
  process.exit(2);
}

const registry = await response.json();
const published = Object.keys(registry.versions ?? {});
const latest = registry['dist-tags']?.latest ?? published.at(-1);

console.log(`Published on npm (${name}):`);
for (const version of published.slice(-5)) {
  console.log(`  ${version}${version === latest ? '  <- latest' : ''}`);
}

const [major, minor, patch] = latest.split('.').map(Number);
console.log(`\nLatest published: ${latest}`);
console.log(`Next patch: ${major}.${minor}.${patch + 1}  |  next minor: ${major}.${minor + 1}.0`);

const candidate = process.argv[2]?.replace(/^v/, '');

if (!candidate) {
  process.exit(0);
}

if (published.includes(candidate)) {
  console.error(`\nREFUSED: ${candidate} is already published. npm will reject the publish, and the tag would lie.`);
  process.exit(1);
}

const ordered = [candidate, latest].sort((a, b) =>
  a.localeCompare(b, undefined, { numeric: true }),
);

if (ordered[0] === candidate) {
  console.error(`\nREFUSED: ${candidate} is below the published ${latest}, so it would never resolve as latest.`);
  process.exit(1);
}

console.log(`\n${candidate} is free and above the published latest.`);
