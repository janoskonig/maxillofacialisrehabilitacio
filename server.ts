import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { initSocketIO } from './lib/socket-server';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

// Fail fast in production if JWT_SECRET is missing or left at the source-committed
// default. middleware.ts / lib/auth-server.ts / lib/socket-auth.ts all fall back to
// 'change-this-to-a-random-secret-in-production', so booting without a real secret
// would let anyone forge an admin token. Better to refuse to start than to run wide open.
const DEFAULT_JWT_SECRET = 'change-this-to-a-random-secret-in-production';
if (!dev) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === DEFAULT_JWT_SECRET) {
    console.error(
      '[Server] FATAL: JWT_SECRET is unset or still the built-in default in production. ' +
        'Auth tokens would be forgeable by anyone. Set a strong, unique JWT_SECRET and restart.'
    );
    process.exit(1);
  }
  if (secret.length < 32) {
    console.error(
      '[Server] FATAL: JWT_SECRET is too short (<32 chars) for production. Use a long, random secret.'
    );
    process.exit(1);
  }
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url || '/', true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Initialize Socket.io
  const socketIO = initSocketIO(httpServer);
  console.log('[Server] Socket.io initialized:', socketIO ? '✓' : '✗');

  httpServer
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
      console.log(`[Server] Socket.io available at ws://${hostname}:${port}/socket.io`);
    });
});
