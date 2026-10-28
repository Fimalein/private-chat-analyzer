import { crc32Zip } from "@/lib/export/zip-crc";

export function createChatStoryZip(files: readonly { name: string; content: string }[]): Uint8Array {
  if (!files.length || files.length > 65535) throw new Error("ZIP_FILE_COUNT");
  const encoder = new TextEncoder();
  const entries = files.map((file) => {
    if (!file.name || /[/\\]/.test(file.name) || file.name === "..") throw new Error("ZIP_NAME");
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    if (name.length > 65535 || data.length > 0xffffffff) throw new Error("ZIP_ENTRY_TOO_LARGE");
    return { name, data, crc: crc32Zip(data) };
  });
  const dataSize = entries.reduce((sum, x) => sum + 30 + x.name.length + x.data.length, 0);
  const directorySize = entries.reduce((sum, x) => sum + 46 + x.name.length, 0);
  const totalSize = dataSize + directorySize + 22;
  if (totalSize > 0xffffffff) throw new Error("ZIP_TOO_LARGE");
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);
  const w16 = (at: number, value: number) => view.setUint16(at, value, true);
  const w32 = (at: number, value: number) => view.setUint32(at, value, true);
  let p = 0;
  const offsets: number[] = [];
  for (const e of entries) {
    offsets.push(p);
    w32(p, 0x04034b50);
    w16(p + 4, 20);
    w16(p + 6, 0x0800);
    w16(p + 8, 0);
    w16(p + 10, 0);
    w16(p + 12, 0x0021);
    w32(p + 14, e.crc);
    w32(p + 18, e.data.length);
    w32(p + 22, e.data.length);
    w16(p + 26, e.name.length);
    w16(p + 28, 0);
    p += 30;
    out.set(e.name, p);
    p += e.name.length;
    out.set(e.data, p);
    p += e.data.length;
  }
  const dirOffset = p;
  entries.forEach((e, i) => {
    w32(p, 0x02014b50);
    w16(p + 4, 20);
    w16(p + 6, 20);
    w16(p + 8, 0x0800);
    w16(p + 10, 0);
    w16(p + 12, 0);
    w16(p + 14, 0x0021);
    w32(p + 16, e.crc);
    w32(p + 20, e.data.length);
    w32(p + 24, e.data.length);
    w16(p + 28, e.name.length);
    w16(p + 30, 0);
    w16(p + 32, 0);
    w16(p + 34, 0);
    w16(p + 36, 0);
    w32(p + 38, 0);
    w32(p + 42, offsets[i]);
    p += 46;
    out.set(e.name, p);
    p += e.name.length;
  });
  w32(p, 0x06054b50);
  w16(p + 4, 0);
  w16(p + 6, 0);
  w16(p + 8, entries.length);
  w16(p + 10, entries.length);
  w32(p + 12, p - dirOffset);
  w32(p + 16, dirOffset);
  w16(p + 20, 0);
  return out;
}
