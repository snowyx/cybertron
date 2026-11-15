import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 9527);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error('PORT 必须是 0–65535 的整数');
const { app } = await createApp({
  logger: true,
  dataPath: process.env.CYBERTRON_DATA_PATH,
  tickMs: Number(process.env.CYBERTRON_TICK_MS) || 3000,
  stepMs: Number(process.env.CYBERTRON_DISCUSS_STEP_MS) || 1500,
});
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    void app.close().then(
      () => process.exit(0),
      (e) => {
        app.log.error(e);
        process.exit(1);
      },
    );
  });
try {
  await app.listen({ port, host: process.env.CYBERTRON_HOST ?? '127.0.0.1' });
} catch (e) {
  app.log.error(e);
  await app.close();
  process.exit(1);
}
