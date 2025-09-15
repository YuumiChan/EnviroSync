import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { compression } from 'vite-plugin-compression';

export default defineConfig({
	plugins: [
		sveltekit(),
		// Add gzip compression
		compression({
			algorithm: 'gzip',
			ext: '.gz'
		}),
		// Add brotli compression (better compression ratio)
		compression({
			algorithm: 'brotliCompress',
			ext: '.br'
		})
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
		}
	}
});
