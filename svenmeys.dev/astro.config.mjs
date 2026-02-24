import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://svenmeys.dev',
  output: 'static',
  integrations: [sitemap()],
});
