import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';

// IWSDK's dev plugin injects the IWER WebXR emulator so the island can be
// flown in a desktop browser without a headset. On a real Quest browser it
// stays out of the way and the native WebXR session is used.
/** the build: the commit (CI's, or the checkout's), shown on the landing card */
const BUILD = ((): string => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim() + '-dev';
  } catch {
    return 'dev';
  }
})();

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [
    iwsdkDev({
      // Emulate a Quest 3 device profile during local development.
      emulator: { device: 'metaQuest3' },
    }),
  ],
  server: {
    host: true,
    port: 5180,
  },
  build: {
    target: 'esnext',
    // the game, and the page the LOG IN email's link opens on a phone
    rollupOptions: { input: { main: 'index.html', login: 'login.html' } },
  },
});
