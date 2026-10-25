import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api/onramp': 'http://127.0.0.1:8787', '/api/trust': 'http://127.0.0.1:8787', '/api/verification': 'http://127.0.0.1:8787' } },
});
