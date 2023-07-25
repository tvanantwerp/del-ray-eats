import image from '@astrojs/image';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';
import serviceWorker from 'astrojs-service-worker';

export default defineConfig({
  integrations: [
    react(),
    image({
      serviceEntryPoint: '@astrojs/image/sharp',
    }),
    serviceWorker(),
  ],
});
