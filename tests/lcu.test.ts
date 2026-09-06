import { describe, expect, it } from 'vitest';
import {
  parseLockfileContent,
  selectRecentMatches,
  visibleTeammatesFromChampSelect,
  visibleTeammatesFromGameflow,
  historyRoute,
  enemyChampionSlots,
  credentialsFromProcesses,
} from '../electron/lcu';

const game = (id: number, queueId = 420, duration = 1200, creation = id * 1000) => ({
  gameId: id,
  queueId,
  gameDuration: duration,
  gameCreation: creation,
  participants: [
    { participantId: 1, championId: 11, stats: { win: true, kills: 1, deaths: 9, assists: 2 } },
    { participantId: 2, championId: 22, stats: { win: false, kills: 8, deaths: 2, assists: 7 } },
  ],
  participantIdentities: [
    { participantId: 1, player: { summonerId: 100, puuid: 'other' } },
    { participantId: 2, player: { summonerId: 200, puuid: 'wanted' } },
  ],
});

describe('parseLockfileContent', () => {
  it('accepts a valid League lockfile', () => {
    expect(parseLockfileContent('LeagueClient:1234:2999:secret:https')).toEqual({
      port: 2999,
      password: 'secret',
      protocol: 'https',
    });
  });

  it.each([
    '',
    'LeagueClient:abc:2999:secret:https',
    'LeagueClient:1234:0:secret:https',
    'LeagueClient:1234:70000:secret:https',
    'LeagueClient:1234:2999::https',
    'LeagueClient:1234:2999:secret:http',
    'LeagueClient:1234:2999:secret:https:extra',
  ])('rejects invalid lockfile content: %j', (content) => {
    expect(() => parseLockfileContent(content)).toThrow(/lockfile/i);
  });

  it('explains that a zero-byte WeGame lockfile cannot provide credentials', () => {
    expect(() => parseLockfileContent('')).toThrow(/空文件.*管理员权限/);
  });
});

describe('background League process discovery', () => {
  it('uses credentials from LeagueClient.exe when LeagueClientUx metadata is inaccessible', () => {
    expect(credentialsFromProcesses([
      { Name: 'LeagueClientUx.exe', CommandLine: null, ExecutablePath: null },
      { Name: 'LeagueClient.exe', CommandLine: '"F:\\LeagueClient.exe" --app-port=5034 --remoting-auth-token="cn-token"', ExecutablePath: 'F:\\LeagueClient.exe' },
    ])).toEqual({ port: 5034, password: 'cn-token', protocol: 'https' });
  });

  it('reports the privilege mismatch when League processes exist but metadata is hidden', () => {
    expect(() => credentialsFromProcesses([
      { Name: 'LeagueClient.exe', CommandLine: null, ExecutablePath: null },
      { Name: 'LeagueClientUx.exe', CommandLine: null, ExecutablePath: null },
    ])).toThrow(/已检测到.*管理员权限/);
  });
});

describe('selectRecentMatches', () => {
  it('matches the requested identity instead of using the first participant', () => {
    const [match] = selectRecentMatches([game(1)], { puuid: 'wanted', summonerId: 200 }, 420);
    expect(match).toMatchObject({ id: '1', championId: 22, win: false, kills: 8 });
  });

  it('skips games where the requested identity cannot be matched', () => {
    expect(selectRecentMatches([game(1)], { puuid: 'missing', summonerId: 999 }, 420)).toEqual([]);
  });

  it('excludes remakes, filters mode, deduplicates, sorts, and returns at most five', () => {
    const games = [
      game(1, 420, 1200, 1000), game(2, 430, 1200, 2000), game(3, 420, 250, 3000),
      game(4, 420, 1200, 4000), game(5, 420, 1200, 5000), game(6, 420, 1200, 6000),
      game(7, 420, 1200, 7000), game(8, 420, 1200, 8000), game(8, 420, 1200, 8000),
    ];
    expect(selectRecentMatches(games, { puuid: 'wanted' }, 420).map((m) => m.id))
      .toEqual(['8', '7', '6', '5', '4']);
  });

  it('excludes explicit early-surrender remakes and malformed participant stats', () => {
    const explicitRemake = game(10);
    (explicitRemake as any).gameEndedInEarlySurrender = true;
    const malformed = game(11);
    delete (malformed.participants[1] as any).stats.win;
    expect(selectRecentMatches([explicitRemake, malformed], { puuid: 'wanted' }, 420)).toEqual([]);
  });
});

describe('historyRoute', () => {
  it('uses the product route only for a known PUUID', () => {
    expect(historyRoute({ puuid: 'player puuid', summonerId: 42 })).toContain('/products/lol/player%20puuid/matches');
  });

  it('uses the summoner matchlist route when only summonerId is known', () => {
    expect(historyRoute({ summonerId: 42 })).toBe('/lol-match-history/v1/matchlist-by-summoner/42?begIndex=0&endIndex=20');
  });
});

describe('visibleTeammatesFromChampSelect', () => {
  it('keeps only visibly identifiable teammates and preserves anonymity', () => {
    const session = {
      localPlayerCellId: 0,
      myTeam: [
        { cellId: 0, summonerId: 10, puuid: 'self', displayName: 'Me', championId: 1 },
        { cellId: 1, summonerId: 20, puuid: 'known', displayName: 'Visible', championId: 2 },
        { cellId: 2, summonerId: 0, puuid: '', displayName: '', championId: 3, isPlaceholder: true },
        { cellId: 3, summonerId: 30, puuid: 'hidden', displayName: 'Hidden', championId: 4, isNameObfuscated: true },
        { cellId: 4, summonerId: 40, puuid: 'hidden2', displayName: 'Hidden2', championId: 5, nameVisibilityType: 'hidden' },
      ],
    };
    expect(visibleTeammatesFromChampSelect(session)).toEqual([
      expect.objectContaining({ id: 'known', name: 'Visible', championId: 2, anonymous: false }),
      expect.objectContaining({ id: 'anonymous:2', name: '匿名玩家', championId: 3, anonymous: true }),
      expect.objectContaining({ id: 'anonymous:3', name: '匿名玩家', championId: 4, anonymous: true }),
      expect.objectContaining({ id: 'anonymous:4', name: '匿名玩家', championId: 5, anonymous: true }),
    ]);
  });
});

describe('enemyChampionSlots', () => {
  it('preserves unknown enemy slots as zero placeholders', () => {
    expect(enemyChampionSlots({ theirTeam: [{ championId: 10 }, {}, { championId: 30 }] }))
      .toEqual([10, 0, 30]);
  });
});

describe('visibleTeammatesFromGameflow', () => {
  it('uses only named players on the current summoner team', () => {
    const gameflow = { gameData: {
      teamOne: [
        { puuid: 'self', summonerName: 'Me', championId: 1 },
        { puuid: 'ally', summonerName: 'Ally', championId: 2 },
        { puuid: 'hidden', summonerName: '', championId: 3 },
      ],
      teamTwo: [{ puuid: 'enemy', summonerName: 'Enemy', championId: 4 }],
    } };
    expect(visibleTeammatesFromGameflow(gameflow, { puuid: 'self' })).toEqual([
      expect.objectContaining({ id: 'ally', name: 'Ally', championId: 2 }),
    ]);
  });
});
