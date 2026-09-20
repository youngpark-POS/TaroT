import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
