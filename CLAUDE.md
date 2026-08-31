# Working in this repo

## Releasing

**Take the next version from the registry, never from `git tag` or `package.json`.**
Run `npm run check-release <version>` first — it prints what npm serves and refuses a number
that is already taken or below the published latest.

This is not a formality. In the sibling `proofage/laravel-client` the git tags are missing
several published releases, and picking the next version from `git tag` there produced a tag on
a number Packagist already served from different code. The habit is what keeps both repos safe.

Release steps: `npm version <patch|minor> --no-git-tag-version` → commit `chore: release X.Y.Z`
→ push `main` → `git tag vX.Y.Z` → push the tag. The tag triggers Trusted Publishing; never run
`npm publish` by hand.

## Changing the API surface

The API contract lives in the app repo, not here: see `developer-docs/README.md` §
"Keeping the SDK clients in sync" in `proofageapp`. In short — `npm run sync-spec`, then make
`tests/api-contract.test.ts` pass by updating `OPERATIONS`, `src/types.ts` and `AGENTS.md`
together. `AGENTS.md` ships to consumers and is the authoritative response contract; this file
does not ship (see `files` in package.json), so maintainer notes belong here.
