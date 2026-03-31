import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
  },
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    sourcemap: false,
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
