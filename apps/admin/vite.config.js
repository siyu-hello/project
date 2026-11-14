import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({ plugins: [vue()], cacheDir: '../../.local/vite-cache', server: { watch: { ignored: ['**/.*.tmpdir/**', '**/.*.tmp'] }, proxy: { '/api': { target: 'http://localhost:3000', rewrite: p => p.replace(/^\/api/, '') }, '/uploads': { target: 'http://localhost:3000' } } } });
