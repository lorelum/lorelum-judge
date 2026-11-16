import { readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

export interface WorkspaceSession {
  dispatch(action: string, payload: unknown): Promise<unknown>;
  snapshot(): unknown;
  subscribe(listener: (event: unknown) => void): () => void;
}

export interface WorkspaceServerOptions {
  session: WorkspaceSession;
  /** An explicitly supplied directory containing the built application. */
  staticDirectory?: string;
  port?: number;
}

const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENT_STREAMS = 16;
const MAX_PENDING_EVENT_BYTES = 256 * 1024;
const encoder = new TextEncoder();
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const securityHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...securityHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function denied(status: number): Response {
  return json(
    {
      error:
        status === 404 ? "Not found" : status === 413 ? "Request too large" : "Request rejected",
    },
    status,
  );
}

async function readJson(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new RangeError("request too large");
  }
  if (!request.body) throw new SyntaxError("missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel();
        throw new RangeError("request too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** Starts a loopback-only server. Creating it never invokes the session's actions. */
export function createWorkspaceServer(options: WorkspaceServerOptions) {
  const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const streams = new Set<() => void>();
  const staticRoot =
    options.staticDirectory === undefined ? undefined : realpath(options.staticDirectory);
  // Handle an invalid directory when requested rather than leaving a rejected promise unhandled.
  staticRoot?.catch(() => {});

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    idleTimeout: 0,
    async fetch(request, currentServer) {
      const host = `127.0.0.1:${currentServer.port}`;
      const origin = `http://${host}`;
      const suppliedOrigin = request.headers.get("origin");
      const fetchSite = request.headers.get("sec-fetch-site");
      if (
        request.headers.get("host") !== host ||
        (suppliedOrigin !== null && suppliedOrigin !== origin) ||
        (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none")
      ) {
        return denied(403);
      }
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        if (request.headers.get("x-local-workspace") !== "1") return denied(403);
        if (url.pathname === "/api/bootstrap" && request.method === "GET") {
          try {
            return json({ token, state: options.session.snapshot() });
          } catch {
            return json({ error: "Session unavailable" }, 500);
          }
        }
        if (request.headers.get("x-csrf-token") !== token) return denied(403);
        if (url.pathname === "/api/state" && request.method === "GET") {
          try {
            return json({ state: options.session.snapshot() });
          } catch {
            return json({ error: "Session unavailable" }, 500);
          }
        }
        if (url.pathname === "/api/events" && request.method === "GET") {
          if (streams.size >= MAX_EVENT_STREAMS) return denied(429);
          let unsubscribe: (() => void) | undefined;
          let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
          let closed = false;
          const close = () => {
            if (closed) return;
            closed = true;
            streams.delete(close);
            request.signal.removeEventListener("abort", close);
            unsubscribe?.();
            try {
              controller?.close();
            } catch {
              /* Already cancelled. */
            }
          };
          const stream = new ReadableStream<Uint8Array>(
            {
              start(c) {
                controller = c;
                streams.add(close);
                request.signal.addEventListener("abort", close, { once: true });
                if (request.signal.aborted) {
                  close();
                  return;
                }
                c.enqueue(encoder.encode(": connected\n\n"));
                try {
                  const dispose = options.session.subscribe((event) => {
                    if (closed) return;
                    try {
                      const serialized = JSON.stringify(event);
                      if (serialized === undefined) return;
                      const data = encoder.encode(`data: ${serialized}\n\n`);
                      if (
                        data.byteLength > MAX_PENDING_EVENT_BYTES ||
                        (c.desiredSize ?? 0) < data.byteLength
                      ) {
                        close();
                        return;
                      }
                      c.enqueue(data);
                    } catch {
                      close();
                    }
                  });
                  unsubscribe = dispose;
                  if (closed) dispose();
                } catch {
                  close();
                }
              },
              cancel() {
                close();
              },
            },
            { highWaterMark: MAX_PENDING_EVENT_BYTES, size: (chunk) => chunk?.byteLength ?? 0 },
          );
          return new Response(stream, {
            headers: {
              ...securityHeaders,
              "Content-Type": "text/event-stream; charset=utf-8",
              Connection: "keep-alive",
            },
          });
        }
        const actionMatch = /^\/api\/action\/([a-zA-Z0-9][a-zA-Z0-9_.-]{0,63})$/.exec(url.pathname);
        if (actionMatch && request.method === "POST") {
          if (
            !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
              request.headers.get("content-type") ?? "",
            )
          )
            return denied(415);
          let payload: unknown;
          try {
            payload = await readJson(request);
          } catch (error) {
            return denied(error instanceof RangeError ? 413 : 400);
          }
          try {
            return json({ result: await options.session.dispatch(actionMatch[1]!, payload) });
          } catch {
            return json({ error: "Action failed" }, 500);
          }
        }
        return denied(404);
      }
      if (request.method !== "GET" || !staticRoot) return denied(404);
      try {
        const pathname = decodeURIComponent(url.pathname);
        if (
          pathname.includes("\\") ||
          pathname.includes("\0") ||
          pathname.split("/").some((part) => part === "." || part === "..")
        )
          return denied(404);
        const root = await staticRoot;
        const candidate = await realpath(
          resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`),
        );
        const pathFromRoot = relative(root, candidate);
        if (
          !pathFromRoot ||
          pathFromRoot === ".." ||
          pathFromRoot.startsWith(`..${sep}`) ||
          isAbsolute(pathFromRoot)
        )
          return denied(404);
        const type = contentTypes[extname(candidate).toLowerCase()];
        if (!type) return denied(404);
        return new Response(await readFile(candidate), {
          headers: { ...securityHeaders, "Content-Type": type },
        });
      } catch {
        return denied(404);
      }
    },
  });
  let stopped = false;
  return {
    port: server.port,
    url: `http://127.0.0.1:${server.port}`,
    stop() {
      if (stopped) return;
      stopped = true;
      for (const close of streams) close();
      server.stop(true);
    },
  };
}
