import { createApp } from '../server/src/app.js';
// A fresh, isolated world prevents tests from inheriting the user's running simulation.
const { app } = await createApp({ dataPath: null, tickMs: 100000, stepMs: 300 });
await app.listen({ port: 9529, host: '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void app.close());
