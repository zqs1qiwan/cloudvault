// ─── Streaming ZIP ────────────────────────────────────────────────────
//
// The archive is never assembled in memory: each file is opened, piped straight
// into the response, and only a 4-byte CRC accumulator follows the bytes. With
// no compression the payload is the file itself, so a 200MB folder costs 200MB
// of bandwidth and a few hundred KB of heap.
//
// Sizes are not known before the body is read, so entries use a data descriptor
// (flag 0x0008) - the shape every unzip tool, Explorer and Finder understand.
// Names are UTF-8 (flag 0x0800), which is what keeps non-ASCII filenames intact.

import { sanitizeEntryName } from './mime';

export interface ZipSource {
  name: string;          // full path inside the archive, e.g. `docs/report.pdf`
  size: number;          // bytes as reported by the store
  modified: Date;
  open: () => Promise<ReadableStream<Uint8Array> | null>;
}

const UTF8_FLAG = 0x0800;
const DESCRIPTOR_FLAG = 0x0008;

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32Update(crc: number, bytes: Uint8Array): number {
  const table = getCrcTable();
  let c = crc;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

interface EntryState {
  nameBytes: Uint8Array;
}

function localHeader(entry: EntryState, modified: Date): Uint8Array {
  const buf = new Uint8Array(30 + entry.nameBytes.length);
  const view = new DataView(buf.buffer);
  const stamp = dosDateTime(modified);
  writeU32(view, 0, 0x04034b50);
  view.setUint16(4, 20, true);                    // version needed
  view.setUint16(6, UTF8_FLAG | DESCRIPTOR_FLAG, true);
  view.setUint16(8, 0, true);                     // stored
  view.setUint16(10, stamp.time, true);
  view.setUint16(12, stamp.date, true);
  writeU32(view, 14, 0);                          // crc in descriptor
  writeU32(view, 18, 0);
  writeU32(view, 22, 0);
  view.setUint16(26, entry.nameBytes.length, true);
  view.setUint16(28, 0, true);
  buf.set(entry.nameBytes, 30);
  return buf;
}

function dataDescriptor(crc: number, size: number): Uint8Array {
  const buf = new Uint8Array(16);
  const view = new DataView(buf.buffer);
  writeU32(view, 0, 0x08074b50);
  writeU32(view, 4, crc);
  writeU32(view, 8, size);
  writeU32(view, 12, size);
  return buf;
}

function centralEntry(entry: EntryState, modified: Date, crc: number, size: number, offset: number): Uint8Array {
  const buf = new Uint8Array(46 + entry.nameBytes.length);
  const view = new DataView(buf.buffer);
  const stamp = dosDateTime(modified);
  writeU32(view, 0, 0x02014b50);
  view.setUint16(4, 20, true);                    // version made by
  view.setUint16(6, 20, true);                    // version needed
  view.setUint16(8, UTF8_FLAG | DESCRIPTOR_FLAG, true);
  view.setUint16(10, 0, true);                    // stored
  view.setUint16(12, stamp.time, true);
  view.setUint16(14, stamp.date, true);
  writeU32(view, 16, crc);
  writeU32(view, 20, size);
  writeU32(view, 24, size);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint16(30, 0, true);                    // extra
  view.setUint16(32, 0, true);                    // comment
  view.setUint16(34, 0, true);                    // disk
  view.setUint16(36, 0, true);                    // internal attrs
  writeU32(view, 38, 0);                          // external attrs
  writeU32(view, 42, offset);
  buf.set(entry.nameBytes, 46);
  return buf;
}

function endOfCentralDirectory(count: number, size: number, offset: number): Uint8Array {
  const buf = new Uint8Array(22);
  const view = new DataView(buf.buffer);
  writeU32(view, 0, 0x06054b50);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  writeU32(view, 12, size);
  writeU32(view, 16, offset);
  view.setUint16(20, 0, true);
  return buf;
}

/** Distinct names, because two folders can hold files with the same basename. */
export function uniqueEntryNames(names: string[]): string[] {
  const used = new Map<string, number>();
  return names.map((raw) => {
    const base = sanitizeEntryName(raw) || 'file';
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    if (count === 0) return base;
    const dot = base.lastIndexOf('.');
    return dot > 0 ? `${base.slice(0, dot)} (${count})${base.slice(dot)}` : `${base} (${count})`;
  });
}

export function buildZipStream(sources: ZipSource[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const entries: EntryState[] = sources.map((source) => ({ nameBytes: encoder.encode(source.name) }));

  let index = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let crc = 0xffffffff;
  let written = 0;
  let offset = 0;
  let headerOffset = 0;
  const central: Uint8Array[] = [];
  let centralBytes = 0;
  let sealed = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (!sealed) {
          if (index < sources.length) {
            const source = sources[index];
            const entry = entries[index];

            if (!reader) {
              const body = await source.open();
              if (!body) throw new Error(`Missing object: ${source.name}`);
              reader = body.getReader();
              crc = 0xffffffff;
              written = 0;
              headerOffset = offset;
              const header = localHeader(entry, source.modified);
              offset += header.length;
              controller.enqueue(header);
              return;
            }

            const chunk = await reader.read();
            if (!chunk.done) {
              crc = crc32Update(crc, chunk.value);
              written += chunk.value.length;
              offset += chunk.value.length;
              controller.enqueue(chunk.value);
              return;
            }

            reader = null;
            const finalCrc = (crc ^ 0xffffffff) >>> 0;
            const descriptor = dataDescriptor(finalCrc, written);
            offset += descriptor.length;
            controller.enqueue(descriptor);

            const directoryEntry = centralEntry(entry, source.modified, finalCrc, written, headerOffset);
            central.push(directoryEntry);
            centralBytes += directoryEntry.length;
            index++;
            continue;
          }

          // Central directory, then the end record: both are tiny.
          const centralOffset = offset;
          for (const chunk of central) controller.enqueue(chunk);
          controller.enqueue(endOfCentralDirectory(sources.length, centralBytes, centralOffset));
          sealed = true;
          controller.close();
          return;
        }
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await reader?.cancel().catch(() => {});
    },
  });
}
