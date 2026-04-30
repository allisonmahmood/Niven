import path from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { AuthStorage } from "@mariozechner/pi-coding-agent";
import { getWealthHarnessPaths } from "@niven/wealth-chat-bridge";
import { createSandboxService } from "@niven/wealth-sandbox";

import { createApiApp } from "./app.js";
import { InMemoryWealthChatRegistry } from "./chatRegistry.js";
import { readWealthApiEnv } from "./env.js";

const env = readWealthApiEnv();
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const paths = getWealthHarnessPaths(repoRoot);
const service = createSandboxService();
const chatRegistry = new InMemoryWealthChatRegistry({
  authStorage: AuthStorage.create(paths.authPath),
  repoRoot,
  service,
});
const app = createApiApp({
  ...(env.apiToken ? { apiToken: env.apiToken } : {}),
  chatRegistry,
  service,
});

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
