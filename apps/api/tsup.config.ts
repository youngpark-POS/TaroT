import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/lambda.ts'],
  format: ['cjs'],
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  noExternal: [/.*/],
  outExtension: () => ({ js: '.cjs' }),
});
