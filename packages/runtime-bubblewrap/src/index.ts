import { spawn } from "node:child_process";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { SandboxPort, SandboxRunRequest, SandboxRunResult } from "@lorelum/judge-runtime";
import { rejectMountedSubtrees, validateToolchain } from "./host-validation.js";

class PreparationStopped extends Error {
  constructor(readonly status: "cancelled" | "timed_out") {
    super(status);
  }
}

function relativeDirectory(value: string, allowRoot: boolean): string {
  if (value === "." && allowRoot) return value;
  if (
    !value ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.posix.isAbsolute(value) ||
    value.split("/").some((part) => !part || part === "." || part === ".." || part === ".git")
  ) {
    throw new Error(`Invalid sandbox relative directory: ${value}`);
  }
  return value;
}

async function validateCopy(root: string, checkpoint: () => void): Promise<void> {
  checkpoint();
  if (!path.isAbsolute(root) || path.normalize(root) !== root || (await realpath(root)) !== root) {
    throw new Error(
      "Sandbox root must be a canonical absolute directory without symlink ancestors",
    );
  }
  checkpoint();
  const rootStat = await lstat(root);
  checkpoint();
  if (
    !rootStat.isDirectory() ||
    rootStat.uid !== process.getuid?.() ||
    (rootStat.mode & 0o077) !== 0
  ) {
    throw new Error("Sandbox root must be a private directory owned by the current user");
  }
  await rejectMountedSubtrees(root, [], checkpoint);
  const visit = async (directory: string): Promise<void> => {
    checkpoint();
    for (const name of await readdir(directory)) {
      checkpoint();
      if (name === ".git") throw new Error("Git metadata cannot be exposed to the sandbox");
      const entry = path.join(directory, name);
      const stat = await lstat(entry);
      checkpoint();
      if (
        stat.dev !== rootStat.dev ||
        stat.isSymbolicLink() ||
        (!stat.isDirectory() && !stat.isFile()) ||
        (stat.isFile() && stat.nlink !== 1)
      ) {
        throw new Error(`Sandbox copy contains a link, mount, or special file: ${entry}`);
      }
      if (stat.isDirectory()) await visit(entry);
    }
  };
  await visit(root);
  checkpoint();
}

async function validate(request: SandboxRunRequest, checkpoint: () => void): Promise<void> {
  checkpoint();
  if (process.platform !== "linux") throw new Error("bubblewrap sandbox requires Linux");
  if (
    !Number.isSafeInteger(request.timeoutMs) ||
    request.timeoutMs <= 0 ||
    !Number.isSafeInteger(request.maxOutputBytes) ||
    request.maxOutputBytes <= 0
  ) {
    throw new Error("Sandbox time and output limits must be positive safe integers");
  }
  if (
    !Array.isArray(request.readPaths) ||
    request.readPaths.length !== 1 ||
    request.readPaths[0] !== "."
  ) {
    throw new Error("bubblewrap requires explicit authorization to read the entire private copy");
  }
  if (
    !request.executable ||
    request.executable.startsWith("-") ||
    [request.executable, ...request.args].some(
      (arg) => typeof arg !== "string" || arg.includes("\0"),
    )
  ) {
    throw new Error("Invalid sandbox executable or argument");
  }
  const cwd = relativeDirectory(request.cwd, true);
  const writable = request.writablePaths.map((item) => relativeDirectory(item, false));
  for (const [index, item] of writable.entries()) {
    if (
      writable.some(
        (other, otherIndex) =>
          otherIndex !== index && (item === other || item.startsWith(`${other}/`)),
      )
    ) {
      throw new Error("Writable sandbox directories must not overlap");
    }
  }
  await validateCopy(request.root, checkpoint);
  for (const directory of [cwd, ...writable]) {
    checkpoint();
    if (!(await lstat(path.join(request.root, directory))).isDirectory()) {
      throw new Error(`Sandbox directory does not exist: ${directory}`);
    }
    checkpoint();
  }
}

async function runChecked(
  request: SandboxRunRequest,
  deadline: number,
  checkpoint: () => void,
): Promise<SandboxRunResult> {
  await validate(request, checkpoint);
  checkpoint();

  // All bubblewrap options are constructed here, never from the command argv.
  const options = [
    "--unshare-user",
    "--unshare-pid",
    "--unshare-net",
    "--unshare-ipc",
    "--unshare-uts",
    "--disable-userns",
    "--assert-userns-disabled",
    "--cap-drop",
    "ALL",
    "--new-session",
    "--die-with-parent",
    "--as-pid-1",
    "--clearenv",
    "--setenv",
    "PATH",
    "/usr/local/bin:/usr/bin:/bin",
    "--setenv",
    "HOME",
    "/nonexistent",
    "--setenv",
    "LANG",
    "C",
    "--ro-bind",
    "/usr",
    "/usr",
  ];
  // The host toolchain must not expose Unix sockets or user-mutable directories.
  // Symlinked library roots are inspected at their canonical host locations.
  const checkedToolchains = ["/usr"];
  const masks = await validateToolchain("/usr", 0, checkpoint);
  const bindings = [{ source: "/usr", destination: "/usr" }];
  for (const dir of ["/bin", "/lib", "/lib64"]) {
    checkpoint();
    let canonical: string;
    try {
      canonical = await realpath(dir);
      checkpoint();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!checkedToolchains.some((root) => canonical === root || canonical.startsWith(`${root}/`))) {
      masks.push(...(await validateToolchain(canonical, 0, checkpoint)));
      checkedToolchains.push(canonical);
    }
    options.push("--ro-bind", dir, dir);
    bindings.push({ source: canonical, destination: dir });
  }
  const destinations: string[] = [];
  for (const binding of bindings) {
    checkpoint();
    for (const mask of masks) {
      if (mask === binding.source || binding.source.startsWith(`${mask}/`)) {
        destinations.push(binding.destination);
      } else if (mask.startsWith(`${binding.source}/`)) {
        destinations.push(`${binding.destination}${mask.slice(binding.source.length)}`);
      }
    }
  }
  destinations.sort((a, b) => a.length - b.length);
  const covered: string[] = [];
  for (const directory of destinations) {
    checkpoint();
    if (covered.some((parent) => directory === parent || directory.startsWith(`${parent}/`)))
      continue;
    options.push("--tmpfs", directory, "--remount-ro", directory);
    covered.push(directory);
  }
  options.push("--proc", "/proc", "--dev", "/dev", "--ro-bind", request.root, "/work");
  for (const directory of request.writablePaths) {
    options.push("--bind", path.join(request.root, directory), `/work/${directory}`);
  }
  options.push(
    "--chdir",
    request.cwd === "." ? "/work" : `/work/${request.cwd}`,
    "--",
    request.executable,
    ...request.args,
  );

  checkpoint();
  return await new Promise<SandboxRunResult>((resolve, reject) => {
    const child = spawn("/usr/bin/bwrap", options, {
      detached: true,
      env: {},
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (process.env.JUDGE_SANDBOX_DIAG === "1") {
      child.on("exit", (code, signal) => console.error("sandbox exit", child.pid, code, signal));
      child.on("close", (code, signal) => console.error("sandbox close", child.pid, code, signal));
    }
    let stop: "cancelled" | "timed_out" | "truncated" | undefined;
    let used = 0;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const terminate = (reason: NonNullable<typeof stop>): void => {
      if (stop) return;
      stop = reason;
      // --die-with-parent also kills the sandbox process even after setsid();
      // --as-pid-1 makes the kernel reap all remaining namespace descendants.
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
          if (process.env.JUDGE_SANDBOX_DIAG === "1") console.error("sandbox kill", child.pid, reason);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") reject(error);
        }
      }
    };
    const capture =
      (target: Buffer[]) =>
      (chunk: Buffer): void => {
        const remaining = request.maxOutputBytes - used;
        if (remaining > 0) target.push(chunk.subarray(0, remaining));
        used += Math.min(chunk.length, Math.max(remaining, 0));
        if (chunk.length > remaining) terminate("truncated");
      };
    child.stdout.on("data", capture(stdout));
    child.stderr.on("data", capture(stderr));
    const abort = (): void => terminate("cancelled");
    request.signal.addEventListener("abort", abort, { once: true });
    let timer: NodeJS.Timeout | undefined;
    const armDeadline = (): void => {
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        terminate("timed_out");
      } else {
        timer = setTimeout(armDeadline, Math.min(remaining, 2_147_483_647));
      }
    };
    armDeadline();
    if (request.signal.aborted) abort();
    child.once("error", (error) => {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
      resolve({
        status: stop ?? (exitCode === 0 ? "completed" : "failed"),
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function run(request: SandboxRunRequest): Promise<SandboxRunResult> {
  const started = performance.now();
  const deadline =
    Number.isSafeInteger(request.timeoutMs) && request.timeoutMs > 0
      ? started + request.timeoutMs
      : Infinity;
  const checkpoint = (): void => {
    if (request.signal.aborted) throw new PreparationStopped("cancelled");
    if (performance.now() >= deadline) throw new PreparationStopped("timed_out");
  };
  try {
    checkpoint();
    return await runChecked(request, deadline, checkpoint);
  } catch (error) {
    if (
      error instanceof PreparationStopped ||
      request.signal.aborted ||
      performance.now() >= deadline
    ) {
      const status =
        error instanceof PreparationStopped
          ? error.status
          : request.signal.aborted
            ? "cancelled"
            : "timed_out";
      return { status, exitCode: null, stdout: "", stderr: "" };
    }
    throw error;
  }
}

export function createBubblewrapSandbox(): SandboxPort {
  return { run };
}
