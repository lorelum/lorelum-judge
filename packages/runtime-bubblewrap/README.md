# @lorelum/runtime-bubblewrap

Linux-only `SandboxPort` adapter using `/usr/bin/bwrap`. The host must provide a
bubblewrap and kernel supporting unprivileged user, mount, PID, network, IPC and
UTS namespaces, `--disable-userns`, `--assert-userns-disabled` and capability
dropping. Failure to create any required isolation fails the command; there is
no unsandboxed fallback. Windows requires a Linux host or VM and is rejected.

The caller must supply an exclusively controlled, private (0700), owned, absolute
copy of the project and keep it unchanged outside the sandbox during each run.
The adapter rejects symbolic links, hard-linked files, special files, Git metadata,
filesystem-device changes, noncanonical paths and mount points at, beneath, or
between the filesystem root and the copy. In particular, copies on a separate
`/tmp` mount are not supported. A private directory is not proof of independent
copy provenance: the trusted caller must create a real independent copy rather
than pass the original project. Writable paths must be existing, non-overlapping
directories strictly beneath the copy; the working directory must also exist.
Commands must be separately authorized to read the entire copy with `readPaths:
["."]`; narrower command read scopes are rejected rather than widened.
This adapter does not authorize commands or prepare the copy. Do not put secrets
in the copy or in the read-only toolchain.

Only `/usr`, existing `/bin`, `/lib`, `/lib64`, a sandbox `/proc` and `/dev`,
and the private project copy are made available. The project is read-only except
for the explicitly mounted writable directories. The environment is cleared,
network namespace is isolated, descendants cannot create user namespaces, and
all capabilities are dropped. Before execution the adapter scans the toolchain
for Unix sockets and other special files. Toolchain roots and their ancestors
must be root-owned and not writable by group or others; untrusted child
directories are not traversed and are covered by empty, read-only mounts.
Ordinary files outside masked subtrees must also be root-owned and not
group/other writable; otherwise execution is rejected. Symlinks resolve only in
the sandbox filesystem, and the cleared environment does not inherit dynamic
linker settings. Every nested toolchain mount and exposed bind alias is masked.
Mounted paths that cannot be safely masked are rejected, as are toolchain roots
beneath another mount. Programs needing hidden contents cannot run successfully.
Host `/etc`, home, Git
metadata, and the original project are not mounted. This is shared-kernel
isolation, not a VM; the kernel, bubblewrap and read-only system toolchain are
trusted. Authorization, resource limits other than elapsed time/output, disk
quotas, and protection from a privileged or concurrently mutating host are
outside this adapter's contract.
The monotonic time limit starts at `run()` entry and includes copy validation
and toolchain scanning. Cancellation and expiry are checked between filesystem
operations and prevent command startup; a single in-flight filesystem operation
cannot be interrupted by this adapter. Once started, cancellation, timeout and
output truncation kill bubblewrap and its PID namespace. No network access grant
is supported.

Tests exercise actual sandbox escape attempts and process cleanup on Linux. They
need the required kernel and bubblewrap features; a startup check alone is not
evidence of isolation. The adapter does not claim verification on a host where
those tests have not passed.
