import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'assets', 'champions.json');
const outputDir = path.join(root, 'assets', 'champion-icons');
const concurrency = 5;
const timeoutMs = 10_000;
const retries = 2;

const champions = JSON.parse(await readFile(catalogPath, 'utf8'));
if (!Array.isArray(champions) || champions.length < 100) throw new Error('Champion catalog is missing or incomplete');
await mkdir(outputDir, { recursive: true });

async function alreadyDownloaded(file) {
  try { return (await stat(file)).size > 0; } catch { return false; }
}

async function download(champion) {
  if (!champion?.key || !champion?.image) throw new Error('Malformed champion catalog row');
  const destination = path.join(outputDir, `${champion.key}.png`);
  if (await alreadyDownloaded(destination)) return { status: 'cached', key: champion.key };
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(champion.image, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < 100) throw new Error(`Invalid image (${bytes.byteLength} bytes)`);
      const temporary = `${destination}.tmp`;
      await writeFile(temporary, bytes);
      await rename(temporary, destination);
      return { status: 'fetched', key: champion.key };
    } catch (error) {
      lastError = error;
      try { await unlink(`${destination}.tmp`); } catch { /* no temporary file */ }
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  return { status: 'failed', key: champion.key, error: String(lastError) };
}

const results = [];
let cursor = 0;
async function worker() {
  while (cursor < champions.length) {
    const index = cursor++;
    results[index] = await download(champions[index]);
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));

const fetched = results.filter(result => result.status === 'fetched').length;
const cached = results.filter(result => result.status === 'cached').length;
const failures = results.filter(result => result.status === 'failed');
console.log(JSON.stringify({ total: champions.length, fetched, cached, failed: failures.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
