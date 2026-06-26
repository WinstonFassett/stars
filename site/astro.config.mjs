// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages project site: served at https://winstonfassett.github.io/stars/
// `base` flows into import.meta.env.BASE_URL, which every absolute asset path
// (CSS, favicon, /data/stars.csv) is built from — see index.astro + FacetedBrowse.svelte.
// https://astro.build/config
export default defineConfig({
	site: process.env.DEPLOY_PRIME_URL || 'https://winstonfassett.github.io',
	base: process.env.DEPLOY_PRIME_URL ? '/' : '/stars',
	// Honor PORT/HOST when set (e.g. by portless: `portless run pnpm dev`).
	// Unset → Astro's defaults, so a bare `pnpm dev` still works for anyone.
	server: {
		port: process.env.PORT ? Number(process.env.PORT) : undefined,
		host: process.env.HOST || undefined,
	},
	integrations: [svelte()],
	vite: {
		plugins: [tailwindcss()],
	},
});
