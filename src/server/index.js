import { createServer } from './server.js';
import { pythonWorker } from '../reasoning/worker-client.js';

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '0.0.0.0';
const server = createServer();

// Eagerly start the persistent worker in the background so it's warm by
// the time the first real request arrives; the HTTP server itself does not
// wait for this (readiness is exposed via GET /ready), and `synthetic`
// requests never depend on the worker at all.
pythonWorker.start().catch((error) => {
  console.error(`LatentForge: the local Python worker failed to start (${error.code}): ${error.message}`);
});

server.listen(port, host, () => {
  console.log(`LatentForge is running at http://${host}:${port}`);
});

async function shutdown(signal) {
  console.log(`LatentForge: received ${signal}, shutting down.`);
  await new Promise((resolve) => server.close(resolve));
  await pythonWorker.stop();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
