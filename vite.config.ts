import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    define: {
        'process.env': process.env,
    },
    server: {
        host: true,
    },
    build: {
        // react-admin + MUI + React have deep circular dependencies that prevent
        // reliable chunk splitting. Suppress the warning for the single bundle.
        chunkSizeWarningLimit: 1800,
        rollupOptions: {
            external: '/amfaext.js',
        },
    },
    base: './',
});