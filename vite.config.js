import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit()
	],
	build: {
		// Enable compression
		rollupOptions: {
			output: {
				manualChunks: {
					// Split vendor code for better caching
					vendor: ['chart.js', 'chartjs-adapter-date-fns', 'chartjs-plugin-annotation']
				}
			}
		},
		// Enable source maps for better debugging
		sourcemap: true
	},
	server: {
		// Enable compression in dev
		headers: {
			'Cache-Control': 'public, max-age=3600'
		},
		// Fix WebSocket/HMR issues - let Vite choose the port automatically
		hmr: true,
		// Force the server to use the correct host
		host: 'localhost'
	}
});
