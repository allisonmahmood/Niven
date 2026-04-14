import { serve } from "@hono/node-server";

import { createApiApp } from "./app.js";
import { readWealthApiEnv } from "./env.js";

const env = readWealthApiEnv();
const app = createApiApp(env.apiToken ? { apiToken: env.apiToken } : {});

serve(
  {
    fetch: app.fetch,
    hostname: env.host,
    port: env.port,
  },
  (info) => {
    console.log(`Wealth API listening on http://${info.address}:${info.port}`);
  },
);

export { createApiApp } from "./app.js";
export { readWealthApiEnv } from "./env.js";
