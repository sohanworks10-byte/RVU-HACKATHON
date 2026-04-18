import { createClient } from 'redis';

let pubClient = null;
let subClient = null;

export async function getRedisPub() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (pubClient) return pubClient;

  pubClient = createClient({ url });
  pubClient.on('error', () => {});
  await pubClient.connect();
  return pubClient;
}

export async function getRedisSub() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (subClient) return subClient;

  subClient = createClient({ url });
  subClient.on('error', () => {});
  await subClient.connect();
  return subClient;
}
