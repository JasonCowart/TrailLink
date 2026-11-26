import { defineConfig } from 'vite';

// Served from https://<user>.github.io/TrailLink/ on GitHub Pages.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/TrailLink/',
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
  server: { fs: { allow: ['..'] } }, // lets the web app import the shared engine in ../src/core
});
