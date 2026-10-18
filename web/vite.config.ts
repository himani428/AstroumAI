import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const here = import.meta.dirname;

export default defineConfig({
  root: here,
  plugins: [react()],
  build: { outDir: path.resolve(here, '..', 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
});
