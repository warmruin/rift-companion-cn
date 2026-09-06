import {expect,it} from 'vitest';
import {selectRecentMatches} from '../electron/lcu';
import {rateMatches} from '../src/core/analysis';

// Synthetic fixture: validates processing only, not availability of the CN LCU service.
const match=(id:number,queueId:number,win:boolean)=>({
 gameId:id,queueId,gameDuration:900,gameCreation:id*1000,
 participantIdentities:[{participantId:1,player:{puuid:'test-mayhem-player'}}],
 participants:[{participantId:1,championId:103,stats:{win,kills:8,deaths:4,assists:12}}]
});
it('accepts queue 2400 and selects its latest five without mixing normal ARAM or ranked',()=>{
 const games=[match(10,450,true),match(9,420,true),...Array.from({length:6},(_,i)=>match(i+1,2400,i>=3))];
 const recent=selectRecentMatches(games,{puuid:'test-mayhem-player'},2400);
 expect(recent.map(g=>g.id)).toEqual(['6','5','4','3','2']);
 expect(recent.every(g=>g.queueId===2400)).toBe(true);
 expect(rateMatches(recent).winRate).toBe(60);
 expect(rateMatches(recent).count).toBe(5);
});
it('reports only actual available same-mode samples',()=>{
 const recent=selectRecentMatches([match(1,2400,true),match(2,450,true)],{puuid:'test-mayhem-player'},2400);
 expect(rateMatches(recent).count).toBe(1);
 expect(rateMatches(recent).label).toBe('样本不足');
});
