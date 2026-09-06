import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { load, type CheerioAPI } from 'cheerio';
import type { Champion, CounterRow, Role, StatsSnapshot, TierRow } from '../src/shared/types';

const OP_GG = 'https://op.gg/lol/champions';
const DDRAGON = 'https://ddragon.leagueoflegends.com';
const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ROLE_PATH: Record<Role, string> = { top: 'top', jungle: 'jungle', mid: 'mid', adc: 'adc', support: 'support' };

let configuredCacheDir = path.join(process.cwd(), '.cache');
let configuredAssetsDir = path.join(process.cwd(), 'assets');
let championMemo: Champion[] | undefined;
let championRequest: Promise<Champion[]> | undefined;
const statsRequests = new Map<string, Promise<StatsSnapshot>>();

export function initStats(cacheDir: string, assetsDir: string): void {
  configuredCacheDir = cacheDir;
  configuredAssetsDir = assetsDir;
  championMemo = undefined;
  championRequest = undefined;
  statsRequests.clear();
}

function assertPercent(value: string, label: string): number {
  const normalized = value.replace(/[%\s]/g, '');
  if (!normalized) throw new Error(`Invalid ${label}: value is empty`);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

function patchFromPage($: CheerioAPI): string {
  const text = [
    $('meta[name="description"]').attr('content'),
    $('meta[property="og:description"]').attr('content'),
    $('body').text(),
    $.html(),
  ].filter(Boolean).join(' ');
  const match = text.match(/(?:patch|LoL)\s+(\d+\.\d+(?:\.\d+)?)/i)
    ?? text.match(/\/lol\/(\d+\.\d+(?:\.\d+)?)\/champion\//i);
  if (!match) throw new Error('OP.GG page does not identify its patch');
  return match[1];
}

function championBySlug(champions: Champion[]): Map<string, Champion> {
  const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const result = new Map(champions.flatMap(champion => [
    [normalized(champion.key), champion],
    [normalized(champion.name), champion],
  ]));
  const aliases: Record<string, string> = { wukong: 'MonkeyKing', nunuandwillump: 'Nunu' };
  for (const [alias, key] of Object.entries(aliases)) {
    const champion = result.get(normalized(key));
    if (champion) result.set(alias, champion);
  }
  return result;
}

const tierColors = new Map<string, number>([
  ['#0093ff', 1], ['#00bba3', 2], ['#ffb900', 3], ['#9aa4af', 4], ['#a88a67', 5],
]);

export function parseTierPage(html: string, role: Role, champions: Champion[]): { rows: TierRow[]; patch: string } {
  const $ = load(html);
  const table = $('table').filter((_, element) => $(element).find('caption').text().trim() === 'Ranking Table').first();
  if (!table.length) throw new Error('OP.GG ranking table is absent');
  const headers = table.find('thead th').map((_, element) => $(element).text().trim().toLowerCase()).get();
  const championColumn = headers.indexOf('champion');
  const tierColumn = headers.indexOf('tier');
  const winColumn = headers.indexOf('win rate');
  const pickColumn = headers.indexOf('pick rate');
  if ([championColumn, tierColumn, winColumn, pickColumn].some(index => index < 0)) {
    throw new Error('OP.GG ranking table schema is malformed');
  }
  const lookup = championBySlug(champions);
  const rows: TierRow[] = [];
  table.find('tbody tr').each((_, rowElement) => {
    const cells = $(rowElement).find('td');
    if (cells.length <= Math.max(championColumn, tierColumn, winColumn, pickColumn)) return;
    const href = cells.eq(championColumn).find('a[href*="/lol/champions/"]').attr('href') ?? '';
    const slug = href.match(/\/lol\/champions\/([^/]+)/)?.[1] ?? cells.eq(championColumn).text();
    const champion = lookup.get(slug.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (!champion) return;
    const color = cells.eq(tierColumn).find('[fill]').map((_, node) => ($(node).attr('fill') ?? '').toLowerCase()).get()
      .find(value => tierColors.has(value)) ?? '';
    rows.push({
      championId: champion.id,
      role,
      tier: tierColors.get(color) ?? null,
      winRate: assertPercent(cells.eq(winColumn).text(), 'win rate'),
      pickRate: assertPercent(cells.eq(pickColumn).text(), 'pick rate'),
      games: null,
    });
  });
  if (!rows.length) throw new Error('OP.GG ranking table contains no valid champion rows');
  return { rows, patch: patchFromPage($) };
}

export function parseCounterPage(html: string, role: Role, opponentId: number, champions: Champion[]): { counters: CounterRow[]; patch: string } {
  const $ = load(html);
  const list = $('ul').filter((_, element) => {
    const item = $(element).children('li').first();
    return item.find('img[alt]').length > 0
      && item.find('strong').toArray().some(node => $(node).text().includes('%'))
      && item.find('span').toArray().some(node => /^\d[\d,]*$/.test($(node).text().trim()));
  }).first();
  if (!list.length) throw new Error('OP.GG counter rows are absent');
  const lookup = championBySlug(champions);
  const counters: CounterRow[] = [];
  list.children('li').each((_, element) => {
    const item = $(element);
    const name = item.find('img[alt]').first().attr('alt') ?? item.find('span').first().text();
    const champion = lookup.get(name.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (!champion || champion.id === opponentId) return;
    const displayed = item.find('strong').filter((_, node) => $(node).text().includes('%')).first().text();
    const numericTexts = item.find('span').map((_, node) => $(node).text().trim()).get();
    const gamesText = [...numericTexts].reverse().find((text: string) => /^\d[\d,]*$/.test(text));
    if (!displayed || !gamesText) return;
    const subjectWinRate = assertPercent(displayed, 'counter win rate');
    const games = Number(gamesText.replace(/,/g, ''));
    if (!Number.isSafeInteger(games) || games <= 0) throw new Error(`Invalid counter games: ${gamesText}`);
    counters.push({ championId: champion.id, opponentId, role, winRate: Number((100 - subjectWinRate).toFixed(2)), games });
  });
  if (!counters.length) throw new Error('OP.GG counter rows contain no valid champion data');
  return { counters, patch: patchFromPage($) };
}

async function fetchText(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) RiftCompanion/0.1', 'accept-language': 'en-US,en;q=0.9' },
      });
      if (response.ok) return response.text();
      const error = Object.assign(new Error(`${new URL(url).hostname} returned HTTP ${response.status}`), { retryable: response.status >= 500 });
      if (response.status < 500 || attempt === 2) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if ((error as { retryable?: boolean }).retryable === false || attempt === 2) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
  }
  throw lastError;
}

function parseChampionCatalog(value: unknown, version?: string): Champion[] {
  const records = Array.isArray(value) ? value : Object.values((value as { data?: Record<string, unknown> })?.data ?? {});
  const champions = records.map(item => {
    const raw = item as { id?: number | string; key?: string; name?: string; title?: string; tags?: string[]; image?: string | { full?: string } };
    const ddragonShape = typeof raw.image === 'object';
    const id = Number(ddragonShape ? raw.key : raw.id);
    const key = ddragonShape ? raw.id : raw.key;
    const imageName = typeof raw.image === 'string' ? raw.image : raw.image?.full;
    if (!Number.isSafeInteger(id) || typeof key !== 'string' || !raw.name || !raw.title || !Array.isArray(raw.tags) || !imageName) {
      throw new Error('Champion catalog schema is malformed');
    }
    return { id, key, name: raw.name, title: raw.title, tags: raw.tags, image: version ? `${DDRAGON}/cdn/${version}/img/champion/${imageName}` : imageName };
  });
  if (champions.length < 100) throw new Error('Champion catalog is unexpectedly incomplete');
  return champions;
}

async function loadChampions(): Promise<Champion[]> {
  if (championMemo) return championMemo;
  try {
    const versions = JSON.parse(await fetchText(`${DDRAGON}/api/versions.json`)) as unknown;
    if (!Array.isArray(versions) || typeof versions[0] !== 'string') throw new Error('DDragon version list is malformed');
    const version = versions[0];
    championMemo = parseChampionCatalog(JSON.parse(await fetchText(`${DDRAGON}/cdn/${version}/data/zh_CN/champion.json`)), version);
    try {
      await mkdir(configuredCacheDir, { recursive: true });
      await writeFile(path.join(configuredCacheDir, 'champions.json'), JSON.stringify(championMemo), 'utf8');
    } catch { /* a read-only cache directory must not discard valid network data */ }
    return championMemo;
  } catch (networkError) {
    for (const fallback of [path.join(configuredCacheDir, 'champions.json'), path.join(configuredAssetsDir, 'champions.json')]) {
      try {
        championMemo = parseChampionCatalog(JSON.parse(await readFile(fallback, 'utf8')));
        return championMemo;
      } catch { /* try the next bounded local fallback */ }
    }
    throw new Error(`Unable to load champion catalog: ${String(networkError)}; no valid cached or bundled copy`);
  }
}

export function getChampions(): Promise<Champion[]> {
  if (!championRequest) championRequest = loadChampions().finally(() => { championRequest = undefined; });
  return championRequest;
}

function cachePath(role: Role, opponentId?: number): string {
  return path.join(configuredCacheDir, `opgg-${role}${opponentId ? `-${opponentId}` : ''}.json`);
}

function validateSnapshot(value: unknown): StatsSnapshot {
  const data = value as StatsSnapshot;
  if (!data || !Array.isArray(data.rows) || !data.rows.length || !Array.isArray(data.counters)
    || typeof data.patch !== 'string' || !data.patch || typeof data.fetchedAt !== 'string'
    || !Number.isFinite(Date.parse(data.fetchedAt))) throw new Error('Cached stats schema is malformed');
  return data;
}

async function readCache(role: Role, opponentId?: number): Promise<StatsSnapshot | undefined> {
  try { return validateSnapshot(JSON.parse(await readFile(cachePath(role, opponentId), 'utf8'))); } catch { return undefined; }
}

async function loadStats(role: Role, opponentId?: number, force = false): Promise<StatsSnapshot> {
  if (!(role in ROLE_PATH)) throw new Error(`Unsupported role: ${role}`);
  const cached = await readCache(role, opponentId);
  const cacheAge = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;
  if (!force && cached && cacheAge < CACHE_TTL_MS) return { ...cached, stale: false, error: undefined };
  try {
    const champions = await getChampions();
    const position = ROLE_PATH[role];
    const tierUrl = `${OP_GG}?region=global&tier=emerald_plus&position=${position}`;
    const opponent = opponentId == null ? undefined : champions.find(champion => champion.id === opponentId);
    if (opponentId != null && !opponent) throw new Error(`Unknown opponent champion id: ${opponentId}`);
    const slug = opponent?.key.toLowerCase().replace(/[^a-z0-9]/g, '');
    const counterUrl = slug ? `${OP_GG}/${slug}/counters/${position}?region=global&tier=emerald_plus` : undefined;
    const tierHtml = await fetchText(tierUrl);
    const tier = parseTierPage(tierHtml, role, champions);
    let counter: ReturnType<typeof parseCounterPage> | undefined;
    if (counterUrl && opponentId != null) {
      try {
        counter = parseCounterPage(await fetchText(counterUrl), role, opponentId, champions);
      } catch (error) {
        return {
          rows: tier.rows, counters: [], source: counterUrl, patch: tier.patch,
          region: 'Global (not CN)', rank: 'Emerald+', fetchedAt: new Date().toISOString(), stale: true,
          error: `Counter data unavailable: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    if (counter && counter.patch.split('.').slice(0, 2).join('.') !== tier.patch.split('.').slice(0, 2).join('.')) {
      throw new Error(`OP.GG pages disagree on patch (${tier.patch} vs ${counter.patch})`);
    }
    const snapshot: StatsSnapshot = {
      rows: tier.rows,
      counters: counter?.counters ?? [],
      source: counterUrl ?? tierUrl, patch: tier.patch, region: 'Global (not CN)', rank: 'Emerald+',
      fetchedAt: new Date().toISOString(), stale: false,
    };
    await mkdir(configuredCacheDir, { recursive: true });
    await writeFile(cachePath(role, opponentId), JSON.stringify(snapshot), 'utf8');
    return snapshot;
  } catch (error) {
    if (cached) return { ...cached, stale: true, error: error instanceof Error ? error.message : String(error) };
    throw error;
  }
}

export function getStats(role: Role, opponentId?: number, force = false): Promise<StatsSnapshot> {
  const key = `${role}:${opponentId ?? ''}:${force}`;
  const active = statsRequests.get(key);
  if (active) return active;
  const request = loadStats(role, opponentId, force).finally(() => { statsRequests.delete(key); });
  statsRequests.set(key, request);
  return request;
}
