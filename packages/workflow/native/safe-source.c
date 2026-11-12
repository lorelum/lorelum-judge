#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <linux/openat2.h>
#include <linux/magic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/vfs.h>
#include <sys/syscall.h>
#include <unistd.h>

/* All output is provisional until this process exits successfully. */
static void fail(const char *what) {
  int e = errno;
  fprintf(stderr, "safe-source: %s: %s\n", what, strerror(e));
  exit(1);
}

static int open_beneath(int dir, const char *path, uint64_t flags, uint64_t resolve) {
  struct open_how how = { .flags = flags, .resolve = resolve };
  return (int)syscall(SYS_openat2, dir, path, &how, sizeof(how));
}

static void emit(const void *buffer, size_t length) {
  const char *p = buffer;
  while (length) {
    ssize_t n = write(STDOUT_FILENO, p, length);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) fail("write");
    p += n;
    length -= (size_t)n;
  }
}

static int safe_path(const char *path) {
  if (!*path || *path == '/') return 0;
  const char *p = path;
  while (*p) {
    const char *end = strchr(p, '/');
    size_t n = end ? (size_t)(end - p) : strlen(p);
    if (!n || (n == 1 && p[0] == '.') || (n == 2 && p[0] == '.' && p[1] == '.') ||
        (n == 4 && p[0] == '.' && (p[1] == 'g' || p[1] == 'G') &&
         (p[2] == 'i' || p[2] == 'I') && (p[3] == 't' || p[3] == 'T')) ||
        memchr(p, '\\', n)) return 0;
    if (!end) break;
    p = end + 1;
    if (!*p) return 0;
  }
  return 1;
}

static uintmax_t number(const char *s) {
  char *end;
  if (!*s || *s == '-' || *s == '+') { errno = EINVAL; fail("identity"); }
  errno = 0;
  uintmax_t n = strtoumax(s, &end, 10);
  if (errno || *end) { errno = EINVAL; fail("identity"); }
  return n;
}

static int unchanged(const struct stat *a, const struct stat *b) {
  return a->st_dev == b->st_dev && a->st_ino == b->st_ino &&
    a->st_mode == b->st_mode && a->st_nlink == b->st_nlink &&
    a->st_size == b->st_size && a->st_mtim.tv_sec == b->st_mtim.tv_sec &&
    a->st_mtim.tv_nsec == b->st_mtim.tv_nsec &&
    a->st_ctim.tv_sec == b->st_ctim.tv_sec && a->st_ctim.tv_nsec == b->st_ctim.tv_nsec;
}

int main(int argc, char **argv) {
  if ((argc != 3 && argc != 6) || argv[2][0] != '/' ||
      (strcmp(argv[1], "root") && strcmp(argv[1], "read")) ||
      (argc == 3) != (strcmp(argv[1], "root") == 0)) {
    errno = EINVAL; fail("arguments");
  }
  int slash = open("/", O_PATH | O_DIRECTORY | O_CLOEXEC);
  if (slash < 0) fail("open filesystem root");
  const char *root_path = argv[2][1] ? argv[2] + 1 : ".";
  int root = open_beneath(slash, root_path, O_PATH | O_DIRECTORY | O_CLOEXEC,
    RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS);
  if (root < 0) fail("open project root");
  close(slash);
  struct stat root_stat;
  if (fstat(root, &root_stat)) fail("stat project root");
  if (argc == 3) {
    char header[128];
    int n = snprintf(header, sizeof(header), "R %ju %ju\n", (uintmax_t)root_stat.st_dev, (uintmax_t)root_stat.st_ino);
    if (n < 0 || (size_t)n >= sizeof(header)) { errno = EOVERFLOW; fail("root header"); }
    if (dup2(root, 3) < 0) fail("pin project root");
    emit(header, (size_t)n);
    char byte;
    ssize_t nread;
    do { nread = read(STDIN_FILENO, &byte, 1); } while (nread < 0 && errno == EINTR);
    if (nread < 0) fail("root handoff");
    if (nread != 1) { errno = EPIPE; fail("root handoff"); }
    emit("A\n", 2);
    do { nread = read(STDIN_FILENO, &byte, 1); } while (nread < 0 && errno == EINTR);
    if (nread < 0) fail("root release");
    return 0;
  }
  if ((uintmax_t)root_stat.st_dev != number(argv[3]) || (uintmax_t)root_stat.st_ino != number(argv[4])) {
    errno = ESTALE; fail("project root changed");
  }
  struct stat pinned;
  if (fstat(3, &pinned) || !S_ISDIR(pinned.st_mode) ||
      pinned.st_dev != root_stat.st_dev || pinned.st_ino != root_stat.st_ino) {
    errno = ESTALE; fail("pinned project root changed");
  }
  close(root);
  root = 3;
  if (!safe_path(argv[5])) { errno = EINVAL; fail("path"); }
  int file = open_beneath(root, argv[5], O_PATH | O_CLOEXEC,
    RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_XDEV);
  if (file < 0) {
    if (errno == ENOENT) { emit("M\n", 2); return 0; }
    fail("open source");
  }
  struct stat path_stat, before, after;
  if (fstat(file, &path_stat)) fail("stat source");
  if (!S_ISREG(path_stat.st_mode) || path_stat.st_nlink != 1 || path_stat.st_size < 0) {
    errno = EINVAL; fail("source is not a singly linked regular file");
  }
  /* Reopen the pinned regular inode through the kernel's procfs descriptor
     portal, never by re-resolving the attacker-controlled source pathname. */
  int proc = open("/proc", O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  struct statfs proc_stat;
  if (proc < 0 || fstatfs(proc, &proc_stat) || (unsigned long)proc_stat.f_type != PROC_SUPER_MAGIC) {
    errno = ENOTSUP; fail("trusted procfs is required");
  }
  char descriptors_path[64];
  int path_len = snprintf(descriptors_path, sizeof(descriptors_path), "%jd/fd", (intmax_t)getpid());
  if (path_len < 0 || (size_t)path_len >= sizeof(descriptors_path)) { errno = EOVERFLOW; fail("proc path"); }
  int descriptors = open_beneath(proc, descriptors_path, O_PATH | O_DIRECTORY | O_CLOEXEC,
    RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_XDEV);
  if (descriptors < 0) fail("open proc descriptors");
  char descriptor[32];
  int descriptor_len = snprintf(descriptor, sizeof(descriptor), "%d", file);
  if (descriptor_len < 0 || (size_t)descriptor_len >= sizeof(descriptor)) { errno = EOVERFLOW; fail("descriptor"); }
  int readable = openat(descriptors, descriptor, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
  if (readable < 0) fail("reopen pinned source");
  close(descriptors);
  close(proc);
  close(file);
  file = readable;
  if (fstat(file, &before)) fail("stat reopened source");
  if (!unchanged(&path_stat, &before) || !S_ISREG(before.st_mode) || before.st_nlink != 1) {
    errno = ESTALE; fail("source changed before reading");
  }
  char header[64];
  int n = snprintf(header, sizeof(header), "F %u\n", (unsigned)(before.st_mode & 0777));
  if (n < 0 || (size_t)n >= sizeof(header)) { errno = EOVERFLOW; fail("file header"); }
  emit(header, (size_t)n);
  char buffer[65536];
  uintmax_t count = 0;
  for (;;) {
    ssize_t read_count = read(file, buffer, sizeof(buffer));
    if (read_count < 0 && errno == EINTR) continue;
    if (read_count < 0) fail("read source");
    if (!read_count) break;
    count += (uintmax_t)read_count;
    emit(buffer, (size_t)read_count);
  }
  if (fstat(file, &after)) fail("restat source");
  if (!unchanged(&before, &after) || count != (uintmax_t)before.st_size) {
    errno = ESTALE; fail("source changed while reading");
  }
  if (close(file)) fail("close source");
  return 0;
}
