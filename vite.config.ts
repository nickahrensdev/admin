import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from https://<user>.github.io/<repo>/
// so assets must be built with the repo name as the base path.
export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  define: {
    // Shown in the footer so you can confirm which build is deployed.
    __BUILD_SHA__: JSON.stringify((process.env.GITHUB_SHA ?? 'local').slice(0, 7)),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
});
