import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Champion } from '../src/shared/types';
import { getStats, initStats, parseCounterPage, parseTierPage } from '../electron/stats';

const champions: Champion[] = [
  { id: 103, key: 'Ahri', name: '阿狸', title: '九尾妖狐', tags: ['Mage'], image: 'Ahri.png' },
  { id: 134, key: 'Syndra', name: '辛德拉', title: '暗黑元首', tags: ['Mage'], image: 'Syndra.png' },
  { id: 62, key: 'MonkeyKing', name: '孙悟空', title: '齐天大圣', tags: ['Fighter'], image: 'MonkeyKing.png' },
];

describe('OP.GG stats parser', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('parses visible tier-table columns', () => {
    const html = `<html><head><meta name="description" content="LoL champion tier list for patch 16.17." /></head><body>
      <table><caption>Ranking Table</caption><thead><tr><th>Rank</th><th>Champion</th><th>Tier</th><th>Role</th><th>Win rate</th><th>Pick rate</th><th>Ban rate</th></tr></thead>
      <tbody><tr><td>1</td><td><a href="/lol/champions/ahri/build/mid"><strong>Ahri</strong></a></td><td><svg><path fill="#0093FF" /></svg></td><td></td><td>51.25%</td><td>8.40%</td><td>3.1%</td></tr></tbody></table>
    </body></html>`;
    const result = parseTierPage(html, 'mid', champions);
    expect(result.patch).toBe('16.17');
    expect(result.rows).toEqual([{ championId: 103, role: 'mid', tier: 1, winRate: 51.25, pickRate: 8.4, games: null }]);
  });

  it('inverts the subject win rate so direction is candidate champion vs opponent', () => {
    const html = `<html><head><meta name="description" content="Ahri counter data for LoL 16.17." /></head><body>
      <div><span>Win rate</span><span>Games</span></div><ul>
        <li><div><img alt="Syndra"/><span>Syndra</span></div><div><strong>49.50%</strong></div><div><span>7,438</span></div></li>
      </ul></body></html>`;
    expect(parseCounterPage(html, 'mid', 103, champions).counters).toEqual([
      { championId: 134, opponentId: 103, role: 'mid', winRate: 50.5, games: 7438 },
    ]);
  });

  it('rejects missing or malformed live data instead of manufacturing rows', () => {
    expect(() => parseTierPage('<html><body>No table</body></html>', 'mid', champions)).toThrow(/ranking table/i);
    expect(() => parseCounterPage('<html><body><li>Syndra 49.5%</li></body></html>', 'mid', 103, champions)).toThrow(/counter rows/i);
  });

  it('recognizes OP.GG aliases and its verified tier-five color', () => {
    const counterHtml = `<meta name="description" content="Ahri counters in LoL 16.17."/><ul><li>
      <img alt="Wukong"/><strong>47%</strong><span>1,200</span></li></ul>`;
    expect(parseCounterPage(counterHtml, 'mid', 103, champions).counters[0]).toMatchObject({ championId: 62, winRate: 53 });

    const tierHtml = `<meta name="description" content="LoL 16.17."/><table><caption>Ranking Table</caption>
      <thead><tr><th>Rank</th><th>Champion</th><th>Tier</th><th>Role</th><th>Win rate</th><th>Pick rate</th></tr></thead>
      <tbody><tr><td>1</td><td><a href="/lol/champions/ahri/build/mid">Ahri</a></td><td><svg><path fill="none"/><path fill="#A88A67"/></svg></td><td></td><td>49%</td><td>1%</td></tr></tbody></table>`;
    expect(parseTierPage(tierHtml, 'mid', champions).rows[0].tier).toBe(5);
  });

  it('rejects an empty percentage cell rather than treating it as zero', () => {
    const html = `<meta name="description" content="LoL 16.17."/><table><caption>Ranking Table</caption>
      <thead><tr><th>Rank</th><th>Champion</th><th>Tier</th><th>Role</th><th>Win rate</th><th>Pick rate</th></tr></thead>
      <tbody><tr><td>1</td><td><a href="/lol/champions/ahri/build/mid">Ahri</a></td><td></td><td></td><td></td><td>1%</td></tr></tbody></table>`;
    expect(() => parseTierPage(html, 'mid', champions)).toThrow(/empty/i);
  });

  it('deduplicates concurrent refreshes and returns uncached tier rows when counters fail', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'rift-stats-'));
    initStats(cacheDir, path.resolve('assets'));
    const catalog = JSON.parse(await readFile(path.resolve('assets/champions.json'), 'utf8'));
    const tierHtml = `<meta name="description" content="LoL 16.17."/><table><caption>Ranking Table</caption>
      <thead><tr><th>Rank</th><th>Champion</th><th>Tier</th><th>Role</th><th>Win rate</th><th>Pick rate</th></tr></thead>
      <tbody><tr><td>1</td><td><a href="/lol/champions/ahri/build/mid">Ahri</a></td><td></td><td></td><td>51%</td><td>8%</td></tr></tbody></table>`;
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/api/versions.json')) return new Response(JSON.stringify(['16.17.1']));
      if (url.includes('/data/zh_CN/champion.json')) return new Response(JSON.stringify(catalog));
      if (url.includes('position=mid')) return new Response(tierHtml);
      throw new TypeError('socket reset');
    });
    try {
      const [first, second] = await Promise.all([getStats('mid', 103, true), getStats('mid', 103, true)]);
      expect(first).toEqual(second);
      expect(first.rows).toHaveLength(1);
      expect(first.counters).toEqual([]);
      expect(first.stale).toBe(true);
      expect(first.error).toMatch(/counter data unavailable/i);
      expect(first.source).toContain('/ahri/counters/mid');
      expect(calls.filter(url => url.includes('position=mid'))).toHaveLength(1);
      expect(calls.filter(url => url.includes('/ahri/counters/mid'))).toHaveLength(3);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
