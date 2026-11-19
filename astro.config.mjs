// @ts-check
import { defineConfig } from 'astro/config';

import preact from '@astrojs/preact';

// https://astro.build/config
export default defineConfig({
  // On GitHub Pages the site lives in a sub-folder (https://<user>.github.io/<repo>/).
  // The deploy workflow passes both values from actions/configure-pages; locally the
  // site stays at the root. All links and audio paths go through import.meta.env.BASE_URL.
  site: process.env.SITE_ORIGIN || undefined,
  base: process.env.SITE_BASE || '/',
  integrations: [preact()],
});
