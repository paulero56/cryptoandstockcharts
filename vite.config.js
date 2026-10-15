import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

// Two pages: the terminal (index.html) and the studies guide (guide.html)
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        guide: resolve(root, 'guide.html'),
      },
    },
  },
});
