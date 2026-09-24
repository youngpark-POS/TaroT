import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/worker.ts', 'src/lambda.ts', 'src/cleanup-lambda.ts'],
  format: ['cjs'],
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  noExternal: [/.*/],
  outExtension: () => ({ js: '.cjs' }),
});
