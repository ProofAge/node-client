# Agent Instructions

## npm Releases

When preparing a release for this package:

- Update the version with `npm version <patch|minor|major> --no-git-tag-version` so both `package.json` and `package-lock.json` stay in sync.
- Run `npm test` and `npm run build` before claiming the release is ready.
- Commit the version bump and code changes together when they are part of the same release.
- Create a git tag that matches the package version, prefixed with `v` (for example, package `0.1.1` -> tag `v0.1.1`).
- Push both the commit and the tag. The npm publish workflow is triggered by `v*` tags.
- Do not run `npm publish` manually unless explicitly requested; the GitHub Actions Trusted Publishing workflow should publish releases.

If npm reports package metadata auto-fixes, run `npm pkg fix`, review the diff, and commit any resulting `package.json` or lockfile changes before tagging.
