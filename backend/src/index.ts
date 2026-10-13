import { createServer } from "./http/server";
import { getDatabase } from "./database";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be a valid TCP port.");

async function start(): Promise<void> {
  await getDatabase();
  const server = createServer();
  server.listen(port, host, () => console.log(`Backend listening on http://${host}:${port}`));
}

void start().catch((error: unknown) => {
  console.error("Backend startup failed:", error);
  process.exitCode = 1;
});
