import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { request } from 'node:https';
import { promisify } from 'node:util';
import type { ClientSnapshot, Match, Role, Teammate } from '../src/shared/types';

const execFileAsync = promisify(execFile);
const REQUEST_TIMEOUT_MS = 2_500;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const SNAPSHOT_TTL_MS = 5_000;
const HISTORY_TTL_MS = 60_000;
const REMAKE_SECONDS = 300;

type Json = Record<string, any>;
type Credentials = { port: number; password: string; protocol: 'https' };
type Identity = { puuid?: string; summonerId?: string | number };
type LeagueProcess = { Name?: string; CommandLine?: string | null; ExecutablePath?: string | null };

let configuredLockfile: string | undefined;
let snapshotCache: { expires: number; value: ClientSnapshot } | undefined;
let snapshotInflight: { generation: number; promise: Promise<ClientSnapshot> } | undefined;
let configurationGeneration = 0;
const historyCache = new Map<string, { expires: number; matches: Match[] }>();

export function setLockfile(path: string): void {
  configuredLockfile = path.trim() || undefined;
  snapshotCache = undefined;
  snapshotInflight = undefined;
  configurationGeneration += 1;
  historyCache.clear();
}

export function parseLockfileContent(content: string): Credentials {
  if (!content.trim()) {
    throw new Error('选择的 lockfile 是空文件；国服 WeGame 客户端通常需要以管理员权限读取后台进程凭据');
  }
  const parts = content.trim().split(':');
  if (parts.length !== 5) throw new Error('Invalid League lockfile');
  const [, pidText, portText, password, protocol] = parts;
  const pid = Number(pidText);
  const port = Number(portText);
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port) || port <= 0 || port > 65_535 || !password || protocol !== 'https') {
    throw new Error('Invalid League lockfile');
  }
  return { port, password, protocol };
}

function credentialsFromCommandLine(commandLine: string): Credentials | undefined {
  const port = /--app-port=(?:"(\d+)"|(\d+))/i.exec(commandLine);
  const token = /--remoting-auth-token=(?:"([^"]+)"|([^\s"]+))/i.exec(commandLine);
  const portNumber = Number(port?.[1] ?? port?.[2]);
  const password = token?.[1] ?? token?.[2];
  if (!Number.isInteger(portNumber) || portNumber <= 0 || portNumber > 65_535 || !password) return undefined;
  return { port: portNumber, password, protocol: 'https' };
}

export function credentialsFromProcesses(processes: LeagueProcess[]): Credentials {
  for (const process of processes) {
    const credentials = credentialsFromCommandLine(process.CommandLine ?? '');
    if (credentials) return credentials;
  }
  if (processes.length && processes.every(process => !process.CommandLine && !process.ExecutablePath)) {
    throw new Error('已检测到 LOL 客户端，但无法读取连接凭据；请以管理员权限运行本助手后自动重连');
  }
  throw new Error('已检测到 LOL 客户端，但启动参数中没有可用的连接凭据');
}

async function discoverCredentials(): Promise<Credentials> {
  if (configuredLockfile) {
    try {
      return parseLockfileContent(await readFile(configuredLockfile, 'utf8'));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
        throw new Error('lockfile 正被国服客户端独占，无法直接读取；请以管理员权限运行本助手后自动连接');
      }
      throw error;
    }
  }

  const script = [
    "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('LeagueClient.exe','LeagueClientUx.exe') } | Select-Object Name,CommandLine,ExecutablePath",
    'if ($null -eq $p) { exit 3 }',
    '@($p) | ConvertTo-Json -Compress',
  ].join('; ');
  let processes: LeagueProcess[];
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: REQUEST_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 128 * 1024,
    });
    const parsed = JSON.parse(stdout.trim()) as LeagueProcess[] | LeagueProcess;
    processes = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    throw new Error('未检测到正在运行的 LeagueClientUx');
  }

  try {
    return credentialsFromProcesses(processes);
  } catch (processError) {
    for (const process of processes) {
      if (!process.ExecutablePath) continue;
      const lockfile = process.ExecutablePath.replace(/[\\/][^\\/]+$/, '\\lockfile');
      try { return parseLockfileContent(await readFile(lockfile, 'utf8')); } catch { /* try next process */ }
    }
    throw processError;
  }
}

async function lcuGet<T>(credentials: Credentials, pathname: string): Promise<T> {
  if (!pathname.startsWith('/')) throw new Error('Invalid LCU path');
  return new Promise<T>((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1',
      port: credentials.port,
      path: pathname,
      method: 'GET',
      auth: `riot:${credentials.password}`,
      rejectUnauthorized: false,
      timeout: REQUEST_TIMEOUT_MS,
      headers: { Accept: 'application/json' },
    }, (res) => {
      const chunks: Buffer[] = [];
      let length = 0;
      res.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('LCU response exceeded size limit'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
          reject(new Error(`LCU request failed (${res.statusCode ?? 'unknown'})`));
          return;
        }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T); }
        catch { reject(new Error('LCU returned invalid JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('LCU request timed out')));
    req.on('error', reject);
    req.end();
  });
}

function sameIdentity(player: Json, identity: Identity): boolean {
  return Boolean(
    (identity.puuid && player.puuid && String(player.puuid) === String(identity.puuid)) ||
    (identity.summonerId != null && player.summonerId != null && String(player.summonerId) === String(identity.summonerId)),
  );
}

export function selectRecentMatches(games: Json[], identity: Identity, queueId?: number): Match[] {
  const seen = new Set<string>();
  return games
    .filter((game) => queueId == null || Number(game.queueId) === queueId)
    .filter((game) => Number(game.gameDuration ?? 0) >= REMAKE_SECONDS)
    .filter((game) => game.gameEndedInEarlySurrender !== true)
    .sort((a, b) => Number(b.gameCreation ?? b.gameStartTimestamp ?? 0) - Number(a.gameCreation ?? a.gameStartTimestamp ?? 0))
    .flatMap((game): Match[] => {
      const id = String(game.gameId ?? game.id ?? '');
      if (!id || seen.has(id)) return [];
      const identityRow = Array.isArray(game.participantIdentities)
        ? game.participantIdentities.find((row: Json) => sameIdentity(row.player ?? row, identity))
        : undefined;
      let participant: Json | undefined;
      if (identityRow) {
        participant = game.participants?.find((row: Json) => Number(row.participantId) === Number(identityRow.participantId));
      } else {
        participant = game.participants?.find((row: Json) => sameIdentity(row, identity));
      }
      if (!participant) return [];
      const stats = participant.stats ?? participant;
      if (typeof stats.win !== 'boolean' || ![stats.kills, stats.deaths, stats.assists].every(Number.isFinite)) return [];
      seen.add(id);
      return [{
        id,
        championId: Number(participant.championId ?? 0),
        queueId: Number(game.queueId ?? 0),
        date: Number(game.gameCreation ?? game.gameStartTimestamp ?? 0),
        win: Boolean(stats.win),
        kills: Number(stats.kills ?? 0),
        deaths: Number(stats.deaths ?? 0),
        assists: Number(stats.assists ?? 0),
        duration: Number(game.gameDuration ?? 0),
      }];
    })
    .slice(0, 5);
}

function isAnonymous(member: Json): boolean {
  return Boolean(member.isNameObfuscated || member.isPlaceholder || member.obfuscatedPuuid || String(member.nameVisibilityType ?? '').toUpperCase() === 'HIDDEN');
}

export function enemyChampionSlots(session: Json): number[] {
  return (Array.isArray(session.theirTeam) ? session.theirTeam : []).map((member: Json) => Number(member.championId ?? 0));
}

export function visibleTeammatesFromChampSelect(session: Json): Teammate[] {
  const localCell = Number(session.localPlayerCellId);
  return (Array.isArray(session.myTeam) ? session.myTeam : [])
    .filter((member: Json) => Number(member.cellId) !== localCell)
    .map((member: Json) => {
      const anonymous = isAnonymous(member) || (!member.puuid && !member.summonerId) || !String(member.displayName ?? member.gameName ?? '').trim();
      const cellId = Number(member.cellId);
      return {
        id: anonymous ? `anonymous:${cellId}` : String(member.puuid ?? member.summonerId),
        name: anonymous ? '匿名玩家' : String(member.displayName ?? member.gameName),
        championId: Number(member.championId ?? member.championPickIntent ?? 0),
        role: String(member.assignedPosition ?? ''),
        matches: [],
        anonymous,
        ...(!anonymous && member.puuid ? { puuid: String(member.puuid) } : {}),
        ...(!anonymous && member.summonerId != null ? { summonerId: member.summonerId } : {}),
        ...(anonymous ? { error: '匿名玩家不查询战绩' } : {}),
      };
    });
}

function visibleLobbyMembers(lobby: Json, self: Json): Teammate[] {
  const selfId = String(self.puuid ?? self.summonerId ?? '');
  return (Array.isArray(lobby.members) ? lobby.members : [])
    .filter((member: Json) => String(member.puuid ?? member.summonerId ?? '') !== selfId)
    .filter((member: Json) => member.puuid || member.summonerId)
    .map((member: Json) => ({
      id: String(member.puuid ?? member.summonerId),
      name: String(member.gameName ?? member.summonerName ?? member.displayName ?? '队友'),
      championId: Number(member.championId ?? 0), role: String(member.assignedPosition ?? ''), matches: [], anonymous: false,
      ...(member.puuid ? { puuid: String(member.puuid) } : {}),
      ...(member.summonerId != null ? { summonerId: member.summonerId } : {}),
    }));
}

export function visibleTeammatesFromGameflow(gameflow: Json, self: Json): Teammate[] {
  const selfId = String(self.puuid ?? self.summonerId ?? '');
  const data = gameflow.gameData ?? {};
  const teams: Json[][] = [data.teamOne, data.teamTwo].filter(Array.isArray);
  const ownTeam = teams.find((team) => team.some((member) => String(member.puuid ?? member.summonerId ?? '') === selfId));
  if (!ownTeam) return [];
  return ownTeam
    .filter((member) => String(member.puuid ?? member.summonerId ?? '') !== selfId)
    .filter((member) => Boolean(member.puuid || member.summonerId))
    .filter((member) => !isAnonymous(member) && Boolean(String(member.summonerName ?? member.gameName ?? member.displayName ?? '').trim()))
    .map((member) => ({
      id: String(member.puuid ?? member.summonerId),
      name: String(member.summonerName ?? member.gameName ?? member.displayName),
      championId: Number(member.championId ?? 0), role: String(member.assignedPosition ?? ''), matches: [], anonymous: false,
      ...(member.puuid ? { puuid: String(member.puuid) } : {}),
      ...(member.summonerId != null ? { summonerId: member.summonerId } : {}),
    }));
}

function roleOf(value: unknown): Role | undefined {
  const normalized = String(value ?? '').toLowerCase();
  const map: Record<string, Role> = { top: 'top', jungle: 'jungle', middle: 'mid', mid: 'mid', bottom: 'adc', adc: 'adc', utility: 'support', support: 'support' };
  return map[normalized];
}

async function loadHistory(credentials: Credentials, teammate: Teammate, queueId?: number): Promise<Match[]> {
  const key = `${teammate.id}:${queueId ?? 'all'}`;
  const cached = historyCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.matches;
  const identity = { puuid: teammate.puuid, summonerId: teammate.summonerId };
  const payload = await lcuGet<Json>(credentials, historyRoute(identity));
  const games = payload.games?.games ?? payload.games ?? [];
  const matches = selectRecentMatches(Array.isArray(games) ? games : [], identity, queueId);
  historyCache.set(key, { expires: Date.now() + HISTORY_TTL_MS, matches });
  return matches;
}

export function historyRoute(identity: Identity): string {
  if (identity.puuid) return `/lol-match-history/v1/products/lol/${encodeURIComponent(identity.puuid)}/matches?begIndex=0&endIndex=20`;
  if (identity.summonerId != null && String(identity.summonerId)) {
    return `/lol-match-history/v1/matchlist-by-summoner/${encodeURIComponent(String(identity.summonerId))}?begIndex=0&endIndex=20`;
  }
  throw new Error('玩家缺少可用身份标识');
}

async function optionalGet<T>(credentials: Credentials, path: string): Promise<T | undefined> {
  try { return await lcuGet<T>(credentials, path); } catch { return undefined; }
}

async function fetchClientSnapshot(): Promise<ClientSnapshot> {
  const updatedAt = new Date().toISOString();
  try {
    const credentials = await discoverCredentials();
    const [phase, self, gameflow, champSelect, lobby] = await Promise.all([
      lcuGet<string>(credentials, '/lol-gameflow/v1/gameflow-phase'),
      lcuGet<Json>(credentials, '/lol-summoner/v1/current-summoner'),
      optionalGet<Json>(credentials, '/lol-gameflow/v1/session'),
      optionalGet<Json>(credentials, '/lol-champ-select/v1/session'),
      optionalGet<Json>(credentials, '/lol-lobby/v2/lobby'),
    ]);
    const queueId = Number(gameflow?.gameData?.queue?.id ?? gameflow?.gameData?.queueId ?? lobby?.gameConfig?.queueId ?? 0) || undefined;
    const gameflowTeammates = gameflow ? visibleTeammatesFromGameflow(gameflow, self) : [];
    const teammates = champSelect
      ? visibleTeammatesFromChampSelect(champSelect)
      : gameflowTeammates.length ? gameflowTeammates : lobby ? visibleLobbyMembers(lobby, self) : [];
    const known = teammates.filter((player) => !player.anonymous).slice(0, 4);
    await Promise.all(known.map(async (player) => {
      try {
        player.matches = await loadHistory(credentials, player, queueId);
        if (!player.matches.length) player.error = '接口未返回符合当前模式的有效对局';
      }
      catch (error) { player.error = error instanceof Error ? error.message : '战绩不可用'; }
    }));
    const actions: Json[] = champSelect?.actions?.flat?.() ?? [];
    const completed = actions.filter((action) => action.completed && Number(action.championId) > 0);
    const banned = completed.filter((action) => action.type === 'ban').map((action) => Number(action.championId));
    const picked = completed.filter((action) => action.type === 'pick').map((action) => Number(action.championId));
    const local = champSelect?.myTeam?.find((member: Json) => Number(member.cellId) === Number(champSelect.localPlayerCellId));
    const snapshot: ClientSnapshot = {
      connected: true,
      phase: String(phase),
      message: '已连接 League 客户端',
      selfName: String(self.gameName ?? self.displayName ?? self.summonerName ?? ''),
      role: roleOf(local?.assignedPosition),
      queueId,
      enemies: enemyChampionSlots(champSelect ?? {}),
      banned: [...new Set(banned)], picked: [...new Set(picked)], teammates, updatedAt,
    };
    return snapshot;
  } catch (error) {
    return { connected: false, phase: 'Unavailable', message: error instanceof Error ? error.message : 'League 客户端不可用', enemies: [], banned: [], picked: [], teammates: [], updatedAt };
  }
}

export async function getClientSnapshot(): Promise<ClientSnapshot> {
  if (snapshotCache && snapshotCache.expires > Date.now()) return snapshotCache.value;
  const generation = configurationGeneration;
  if (snapshotInflight?.generation === generation) return snapshotInflight.promise;
  const promise = fetchClientSnapshot().then((value) => {
    if (configurationGeneration === generation) snapshotCache = { expires: Date.now() + SNAPSHOT_TTL_MS, value };
    return value;
  }).finally(() => {
    if (snapshotInflight?.generation === generation) snapshotInflight = undefined;
  });
  snapshotInflight = { generation, promise };
  return promise;
}
