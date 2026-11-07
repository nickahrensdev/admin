import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from https://<user>.github.io/<repo>/
// so assets must be built with the repo name as the base path.
export default defineConfig({
  plugins: [react()],
  base: '/admin/',
});
