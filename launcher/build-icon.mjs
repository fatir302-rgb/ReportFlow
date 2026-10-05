import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const launcherRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(launcherRoot);
const requireFromWeb = createRequire(path.join(repoRoot, "web", "package.json"));
const sharp = requireFromWeb("sharp");

const source = path.join(launcherRoot, "assets", "reportflow-icon-source.png");
const icoOutput = path.join(launcherRoot, "assets", "reportflow.ico");
const browserOutput = path.join(repoRoot, "web", "app", "icon.png");
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];

const sourceBytes = await readFile(source);
const frames = await Promise.all(sizes.map((size) => sharp(sourceBytes)
  .resize(size, size, { fit: "cover" })
  .png({ compressionLevel: 9 })
  .toBuffer()));

const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let index = 0; index < sizes.length; index += 1) {
  const entry = 6 + index * 16;
  const size = sizes[index];
  header.writeUInt8(size === 256 ? 0 : size, entry);
  header.writeUInt8(size === 256 ? 0 : size, entry + 1);
  header.writeUInt8(0, entry + 2);
  header.writeUInt8(0, entry + 3);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frames[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frames[index].length;
}

await writeFile(icoOutput, Buffer.concat([header, ...frames]));
await sharp(sourceBytes).resize(512, 512, { fit: "cover" }).png({ compressionLevel: 9 }).toFile(browserOutput);
console.log(`Created ${icoOutput} and ${browserOutput}`);
