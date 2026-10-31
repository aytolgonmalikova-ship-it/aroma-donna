import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createRateLimiter, handleContact } from './api/_lib/contactHandler.js';

/**
 * В `npm run dev` отвечает на POST /api/contact той же логикой, что и Vercel Function (api/contact.js).
 * Переменные TELEGRAM_* читаются из .env только здесь, на сервере, и не попадают в браузер:
 * в клиентский код Vite передаёт лишь переменные с префиксом VITE_.
 */
function contactApiDev(env) {
  const rateLimiter = createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 });
  return {
    name: 'contact-api-dev',
    configureServer(server) {
      server.middlewares.use('/api/contact', async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const result = await handleContact({
          method: req.method,
          headers: req.headers,
          body: Buffer.concat(chunks),
          ip: req.socket.remoteAddress,
          env,
          rateLimiter,
        });
        res.statusCode = result.status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
        res.end(JSON.stringify(result.body));
      });
    },
  };
}

// Конфигурация Vite: подключаем плагин React (JSX + быстрая перезагрузка).
export default defineConfig(({ mode }) => ({
  plugins: [react(), contactApiDev(loadEnv(mode, process.cwd(), ''))],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    // Firebase подгружается отдельным чанком, поэтому поднимаем порог предупреждения
    chunkSizeWarningLimit: 900,
  },
}));
