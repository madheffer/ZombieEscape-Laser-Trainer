// A Valve VPK (v1/v2) directory, read-only: list its files and read one's bytes.
//   const vpk = openVpk('<csgo>/pak01_dir.vpk'); vpk.files (Map path -> entry); vpk.read(path) -> Buffer | null
// Entries in the _dir file itself (archive index 0x7fff) and in the numbered archives (pak01_003.vpk) both work.
import fs from 'node:fs';
import path from 'node:path';

export function openVpk(dirFile) {
  const b = fs.readFileSync(dirFile);
  if (b.readUInt32LE(0) !== 0x55aa1234) throw new Error(`${dirFile}: not a VPK`);
  const version = b.readUInt32LE(4);
  const treeSize = b.readUInt32LE(8);
  const headerSize = version === 2 ? 28 : 12;
  const dataStart = headerSize + treeSize; // where archive 0x7fff's data begins (the dir file's own payload)
  let p = headerSize;
  const cstr = () => { const e = b.indexOf(0, p); const s = b.toString('utf8', p, e); p = e + 1; return s; };
  const files = new Map();
  for (;;) {
    const ext = cstr();
    if (!ext) break;
    for (;;) {
      const dir = cstr();
      if (!dir) break;
      for (;;) {
        const name = cstr();
        if (!name) break;
        const entry = {
          crc: b.readUInt32LE(p), preload: b.readUInt16LE(p + 4), archive: b.readUInt16LE(p + 6),
          offset: b.readUInt32LE(p + 8), length: b.readUInt32LE(p + 12), preloadAt: p + 18,
        };
        p += 18 + entry.preload; // + terminator (0xffff) is inside the 18
        const full = `${dir === ' ' ? '' : `${dir}/`}${name}${ext === ' ' ? '' : `.${ext}`}`;
        files.set(full.toLowerCase(), entry);
      }
    }
  }
  const base = dirFile.replace(/_dir\.vpk$/i, '');
  const fds = new Map();
  const read = (file) => {
    const e = files.get(String(file).toLowerCase().replace(/\\/g, '/'));
    if (!e) return null;
    const pre = b.subarray(e.preloadAt, e.preloadAt + e.preload);
    if (!e.length) return Buffer.from(pre);
    let fd, at = e.offset;
    if (e.archive === 0x7fff) { fd = fds.get(-1) ?? fs.openSync(dirFile, 'r'); fds.set(-1, fd); at += dataStart; }
    else { const f = `${base}_${String(e.archive).padStart(3, '0')}.vpk`; fd = fds.get(e.archive) ?? fs.openSync(f, 'r'); fds.set(e.archive, fd); }
    const out = Buffer.alloc(e.preload + e.length);
    pre.copy(out, 0);
    fs.readSync(fd, out, e.preload, e.length, at);
    return out;
  };
  const close = () => { for (const fd of fds.values()) fs.closeSync(fd); fds.clear(); };
  return { files, read, close, name: path.basename(dirFile) };
}
