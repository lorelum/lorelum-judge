import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  watch,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SandboxRunRequest } from "@lorelum/judge-runtime";
import { validateToolchain, validateToolchainEntries } from "../src/host-validation.js";
import { createBubblewrapSandbox } from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture(): Promise<SandboxRunRequest> {
  const root = await mkdtemp(path.join(tmpdir(), "judge-bwrap-"));
  directories.push(root);
  await chmod(root, 0o700);
  await mkdir(path.join(root, "allowed"));
  await mkdir(path.join(root, "readonly"));
  await writeFile(path.join(root, "readonly", "file"), "original");
  return {
    root,
    readPaths: ["."],
    writablePaths: ["allowed"],
    cwd: ".",
    executable: "/usr/bin/bash",
    args: [],
    timeoutMs: 120000,
    maxOutputBytes: 16384,
    signal: new AbortController().signal,
  };
}

const linux = process.platform === "linux" ? describe : describe.skip;
linux("bubblewrap isolation", () => {
  test("creates each required namespace and drops capabilities and host environment", async () => {
    const request = await fixture();
    const names = ["user", "mnt", "pid", "net", "ipc", "uts"];
    const host = await Promise.all(names.map((name) => readlink(`/proc/self/ns/${name}`)));
    const result = await createBubblewrapSandbox().run({
      ...request,
      args: [
        "-c",
        "for n in user mnt pid net ipc uts; do /usr/bin/readlink /proc/self/ns/$n; done; /usr/bin/cat /proc/self/status; /usr/bin/env",
      ],
    });
    expect(result.status).toBe("completed");
    const lines = result.stdout.split("\n");
    for (let index = 0; index < names.length; index++) {
      expect(lines[index]).toMatch(new RegExp(`^${names[index]}:\\[\\d+\\]$`));
      expect(lines[index]).not.toBe(host[index]);
    }
    expect(result.stdout).toMatch(/CapEff:\s+0+\n/);
    expect(result.stdout).not.toContain("AWS_SECRET_ACCESS_KEY=");
  });

  test("masks every toolchain submount and untrusted directory through all library aliases", async () => {
    const request = await fixture();
    const mounts = (await readFile("/proc/self/mountinfo", "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const field = line.split(" ")[4];
        if (!field) throw new Error("Invalid mountinfo");
        return field.replace(/\\([0-7]{3})/g, (_, octal: string) =>
          String.fromCharCode(Number.parseInt(octal, 8)),
        );
      });
    const unsafePaths = await validateToolchain("/usr", 0);
    const bindings = [{ source: "/usr", destination: "/usr" }];
    for (const dir of ["/bin", "/lib", "/lib64"]) {
      try {
        bindings.push({ source: await realpath(dir), destination: dir });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const hidden: string[] = [];
    for (const binding of bindings) {
      for (const mount of mounts) {
        if (mount.startsWith(`${binding.source}/`))
          hidden.push(`${binding.destination}${mount.slice(binding.source.length)}`);
        else if (mount === binding.source && binding.source !== "/usr")
          hidden.push(binding.destination);
        else if (mount !== "/" && binding.source.startsWith(`${mount}/`))
          hidden.push(binding.destination);
      }
      for (const unsafe of unsafePaths) {
        if (unsafe.startsWith(`${binding.source}/`))
          hidden.push(`${binding.destination}${unsafe.slice(binding.source.length)}`);
        else if (unsafe === binding.source || binding.source.startsWith(`${unsafe}/`))
          hidden.push(binding.destination);
      }
    }
    const result = await createBubblewrapSandbox().run({
      ...request,
      args: [
        "-c",
        'for d in "$@"; do if /usr/bin/test -e "$d"; then /usr/bin/test -d "$d" || exit 40; /usr/bin/test -z "$(/usr/bin/ls -A "$d")" || exit 41; /usr/bin/touch "$d/escape" 2>/dev/null && exit 42; fi; done; exit 0',
        "mount-check",
        ...hidden,
      ],
    });
    expect(result.status).toBe("completed");
  }, 30000);

  test("allows only approved writes and hides host files from children", async () => {
    const request = await fixture();
    const secret = await mkdtemp(path.join(tmpdir(), "judge-host-secret-"));
    directories.push(secret);
    await writeFile(path.join(secret, "secret"), "private");
    const result = await createBubblewrapSandbox().run({
      ...request,
      args: [
        "-c",
        `echo ok > /work/allowed/file; (echo bad > /work/readonly/file) 2>/dev/null && exit 21; /usr/bin/ln -s '${secret}/secret' /work/allowed/link; /usr/bin/test ! -e /work/allowed/link || exit 22; /usr/bin/cat /work/allowed/file`,
      ],
    });
    expect(result.status).toBe("completed");
    expect(result.stdout.trim()).toBe("ok");
    expect(await readFile(path.join(request.root, "readonly", "file"), "utf8")).toBe("original");
  });

  test("isolates network and blocks child user namespaces", async () => {
    const request = await fixture();
    const server = createServer((socket) => socket.end("host"));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing server address");
      const result = await createBubblewrapSandbox().run({
        ...request,
        args: [
          "-c",
          `/usr/bin/test -x /usr/bin/unshare || exit 30; (/usr/bin/bash -c 'echo hello > /dev/tcp/127.0.0.1/${address.port}') 2>/dev/null && exit 31; /usr/bin/unshare -Ur /usr/bin/true 2>/dev/null && exit 32; exit 0`,
        ],
      });
      expect(result.status).toBe("completed");
    } finally {
      server.close();
    }
  });

  test("rejects links, traversal and bwrap option injection", async () => {
    const request = await fixture();
    const sandbox = createBubblewrapSandbox();
    await expect(sandbox.run({ ...request, cwd: "../" })).rejects.toThrow();
    await expect(sandbox.run({ ...request, readPaths: ["readonly"] })).rejects.toThrow(
      "entire private copy",
    );
    await expect(sandbox.run({ ...request, writablePaths: ["../etc"] })).rejects.toThrow();
    await expect(sandbox.run({ ...request, executable: "--bind" })).rejects.toThrow();
    await symlink("/etc", path.join(request.root, "allowed", "escape"));
    await expect(sandbox.run(request)).rejects.toThrow();
    await rm(path.join(request.root, "allowed", "escape"));
    await link(
      path.join(request.root, "readonly", "file"),
      path.join(request.root, "allowed", "hardlink"),
    );
    await expect(sandbox.run(request)).rejects.toThrow();
  });

  test("rejects a real Unix socket in a toolchain tree", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "judge-toolchain-"));
    directories.push(root);
    const server = createServer();
    server.listen(path.join(root, "host.sock"));
    await once(server, "listening");
    try {
      await expect(validateToolchainEntries(root, process.getuid!())).rejects.toThrow(
        "Unix socket",
      );
    } finally {
      server.close();
    }
  });

  test("rejects writable toolchain files in trusted directories", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "judge-toolchain-file-"));
    directories.push(root);
    const file = path.join(root, "program");
    await writeFile(file, "program");
    await chmod(file, 0o644);
    expect(await validateToolchainEntries(root, process.getuid!())).toEqual([]);
    await chmod(file, 0o664);
    await expect(validateToolchainEntries(root, process.getuid!())).rejects.toThrow(
      "file is not administrator-controlled",
    );
  });

  test("identifies an untrusted toolchain directory containing a real socket for masking", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "judge-untrusted-toolchain-"));
    directories.push(root);
    const unsafe = path.join(root, "unsafe");
    await mkdir(unsafe);
    await chmod(unsafe, 0o777);
    const server = createServer();
    server.listen(path.join(unsafe, "host.sock"));
    await once(server, "listening");
    try {
      expect(await validateToolchainEntries(root, process.getuid!())).toEqual([unsafe]);
    } finally {
      server.close();
    }
  });

  test("rejects same-device bind mounts at the root, writable child, and ancestor", async () => {
    const source = await mkdtemp(path.join(tmpdir(), "judge-source-"));
    const target = await mkdtemp(path.join(tmpdir(), "judge-bind-"));
    const request = await fixture();
    directories.push(source, target);
    await mkdir(path.join(source, "copy"), { mode: 0o700 });
    const moduleUrl = pathToFileURL(path.resolve(import.meta.dir, "../src/index.ts")).href;
    const code = `import {createBubblewrapSandbox} from ${JSON.stringify(moduleUrl)}; try { await createBubblewrapSandbox().run({root:process.env.ROOT,readPaths:["."],writablePaths:["allowed"],cwd:".",executable:"/usr/bin/true",args:[],timeoutMs:10000,maxOutputBytes:1000,signal:new AbortController().signal}); process.exit(1); } catch (error) { if (!String(error).includes(process.env.TARGET)) { console.error(error); process.exit(2); } }`;
    const cases: ReadonlyArray<readonly [string, string]> = [
      [target, target],
      [path.join(request.root, "allowed"), request.root],
      [target, path.join(target, "copy")],
    ];
    for (const [mountTarget, root] of cases) {
      const result = spawnSync(
        "/usr/bin/unshare",
        [
          "-Ur",
          "-m",
          "/usr/bin/bash",
          "-c",
          '/usr/bin/mount --bind "$1" "$2" || exit; export TARGET="$2" ROOT="$5"; exec "$3" -e "$4"',
          "bind-test",
          source,
          mountTarget,
          process.execPath,
          code,
          root,
        ],
        { encoding: "utf8", timeout: 15000 },
      );
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    }
  });

  test("cancellation and expiry during preparation never start the command", async () => {
    const request = await fixture();
    await Promise.all(
      Array.from({ length: 256 }, (_, index) =>
        writeFile(path.join(request.root, "readonly", `file-${index}`), "content"),
      ),
    );
    const controller = new AbortController();
    const command = ["-c", "echo started > /work/allowed/started"];
    const pending = createBubblewrapSandbox().run({
      ...request,
      signal: controller.signal,
      args: command,
    });
    // Real scheduling is required: cancellation must arrive while filesystem validation is active.
    setTimeout(() => controller.abort(), 0);
    expect((await pending).status).toBe("cancelled");
    expect(await Bun.file(path.join(request.root, "allowed", "started")).exists()).toBe(false);
    const expired = await createBubblewrapSandbox().run({
      ...request,
      timeoutMs: 1,
      args: command,
    });
    expect(expired.status).toBe("timed_out");
    expect(await Bun.file(path.join(request.root, "allowed", "started")).exists()).toBe(false);
  });

  test("timeout kills background descendants before they can write", async () => {
    const request = await fixture();
    const result = await createBubblewrapSandbox().run({
      ...request,
      timeoutMs: 10000,
      args: [
        "-c",
        "/usr/bin/setsid /usr/bin/bash -c 'echo started > /work/allowed/started; while [ ! -e /work/allowed/gate ]; do sleep 0.05; done; echo escaped > /work/allowed/late' & wait",
      ],
    });
    expect(result.status).toBe("timed_out");
    expect(await Bun.file(path.join(request.root, "allowed", "started")).exists()).toBe(true);
    await writeFile(path.join(request.root, "allowed", "gate"), "release");
    // Real time is essential to exercise cleanup of a separate Linux process.
    await Bun.sleep(1200);
    expect(await Bun.file(path.join(request.root, "allowed", "late")).exists()).toBe(false);
  }, 30000);
  test("abort and output truncation terminate the sandbox", async () => {
    const request = await fixture();
    const controller = new AbortController();
    const watcher = watch(path.join(request.root, "allowed"))[Symbol.asyncIterator]();
    const started = watcher.next();
    const pending = createBubblewrapSandbox().run({
      ...request,
      signal: controller.signal,
      args: [
        "-c",
        "/usr/bin/setsid /usr/bin/bash -c 'echo started > /work/allowed/started; while [ ! -e /work/allowed/gate ]; do sleep 0.05; done; echo escaped > /work/allowed/late' & wait",
      ],
    });
    await Promise.race([
      started,
      pending.then(() => {
        throw new Error("Sandbox exited before child started");
      }),
    ]);
    controller.abort();
    await watcher.return?.();
    const cancelled = await pending;
    expect(cancelled.status).toBe("cancelled");
    expect(await Bun.file(path.join(request.root, "allowed", "started")).exists()).toBe(true);
    await writeFile(path.join(request.root, "allowed", "gate"), "release");
    // Real time is essential to exercise cleanup of a separate Linux process.
    await Bun.sleep(1200);
    expect(await Bun.file(path.join(request.root, "allowed", "late")).exists()).toBe(false);
    const truncated = await createBubblewrapSandbox().run({
      ...request,
      maxOutputBytes: 64,
      args: ["-c", "while :; do echo 1234567890; done"],
    });
    expect(truncated.status).toBe("truncated");
    expect(
      Buffer.byteLength(truncated.stdout) + Buffer.byteLength(truncated.stderr),
    ).toBeLessThanOrEqual(64);
  }, 20000);
});

test("rejects unsupported platforms", async () => {
  if (process.platform === "linux") return;
  const request = await fixture();
  await expect(createBubblewrapSandbox().run(request)).rejects.toThrow("requires Linux");
});
