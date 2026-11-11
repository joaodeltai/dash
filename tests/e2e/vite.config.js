/* Vite config for the e2e dev server: the app's own config, without hot reload and without file watching, so a test is
   never interrupted by someone saving a source file, and with its own dependency cache so it never fights another dev server. */
import { fileURLToPath } from 'node:url';
import base from '../../vite.config.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

export default {
  ...base,
  root,
  envDir: root,
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite-e2e', import.meta.url)),
  server: { port: Number(process.env.E2E_PORT || 4180), strictPort: true, hmr: false, watch: null },
};
