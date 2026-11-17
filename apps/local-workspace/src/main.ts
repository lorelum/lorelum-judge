import { resolve } from "node:path";
import { createWorkspaceServer } from "./server.js";
import { SessionRouter } from "./session.js";

const endpoint = process.env.LORELUM_MODEL_ENDPOINT;
const model = process.env.LORELUM_MODEL_NAME;
if (!!endpoint !== !!model)
  throw new Error("LORELUM_MODEL_ENDPOINT and LORELUM_MODEL_NAME must both be set");
const port =
  process.env.LORELUM_WORKSPACE_PORT === undefined ? 0 : Number(process.env.LORELUM_WORKSPACE_PORT);
if (!Number.isSafeInteger(port) || port < 0 || port > 65535)
  throw new Error("Invalid LORELUM_WORKSPACE_PORT");
const session = new SessionRouter(
  endpoint && model
    ? {
        configuredModel: {
          endpoint,
          config: { model },
          ...(process.env.LORELUM_MODEL_API_KEY === undefined
            ? {}
            : { apiKey: process.env.LORELUM_MODEL_API_KEY }),
        },
      }
    : {},
);
const server = createWorkspaceServer({
  session,
  staticDirectory: resolve(import.meta.dir, "../dist"),
  port,
});
console.log(`Local workspace: ${server.url}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    server.stop();
    process.exit(0);
  });
