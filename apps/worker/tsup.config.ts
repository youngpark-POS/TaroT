import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/worker.ts'],
  format: ['cjs'],
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  noExternal: [/^@tarot\//],
  outExtension: () => ({ js: '.cjs' }),
});
