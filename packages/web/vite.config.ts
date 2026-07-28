import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../web-dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/echarts/') || id.includes('/zrender/') || id.includes('/echarts-for-react/')) return 'charts';
          if (id.includes('/@tanstack/')) return 'tanstack';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react';
          if (id.includes('/lucide-react/')) return 'icons';
          return 'vendor';
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4319,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4320',
    },
  },
});
