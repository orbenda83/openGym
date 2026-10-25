// Writes that survive a power cut or a host reset, not only a killed process.
//
// Every file the API keeps is written to a temporary name and renamed over the real one, so a
// crash never leaves half a file. But without an fsync the rename and the bytes sit in the page
// cache: the 200 (and the revision it names) went out first, and a reset in the next seconds
// brought the previous file back — or, on filesystems without ext4's rename heuristic, an empty
// one. The device that had been told "saved" then took the older copy and deleted the workout
// locally too (QA 2026-10-06, on a host known to hard-reset). So the bytes are flushed before the
// rename, and the directory after it. A few milliseconds per write.
import fs from 'node:fs';
import path from 'node:path';

/** fsync of a directory, so a rename inside it is on disk. Best effort: some filesystems refuse. */
export function syncDir(dir) {
  let fd = null;
  try { fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd); }
  catch { /* a filesystem that cannot fsync a directory */ }
  finally { if (fd != null) try { fs.closeSync(fd); } catch { /* closed */ } }
}

/** fsync of a file that is already written (an upload streamed to disk). */
export function syncFile(file) {
  const fd = fs.openSync(file, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/** `content` at `file`, durably: temporary file, fsync, rename, fsync of the directory. */
export function atomicWrite(file, content, mode = 0o600) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w', mode);
  try {
    // open's mode only affects a new file. Restrict a stale temp before it receives secrets.
    fs.fchmodSync(fd, mode);
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  syncDir(path.dirname(file));
}
