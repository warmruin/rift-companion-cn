import type { Champion, Match, Rating, Recommendation, Role, StatsSnapshot } from '../shared/types';

export const RATING_RULES = { minimumGames:3, upper:70, lower:40, winWeight:70, kdaWeight:30, kdaCap:5 };
export function rateMatches(input:Match[]):Rating {
 const matches=[...new Map(input.map(x=>[x.id,x])).values()].sort((a,b)=>b.date-a.date).slice(0,5);
 const count=matches.length;
 const winRate=count?100*matches.filter(m=>m.win).length/count:null;
 const kda=count?matches.reduce((s,m)=>s+m.kills+m.assists,0)/Math.max(1,matches.reduce((s,m)=>s+m.deaths,0)):null;
 const score=count>=RATING_RULES.minimumGames?Math.round((winRate!/100)*70+Math.min(kda!/5,1)*30):null;
 return {count,winRate,kda,score,label:score===null?'样本不足':score>=70?'上等马':score<40?'下等马':'中等马',explanation:'仅代表近期状态。近五场胜率 × 70 + min(总击杀助攻 / max(1, 总死亡) / 5, 1) × 30；≥70 上等马，<40 下等马，其余中等马。少于三场不评级。'};
}

export function recommend(role:Role,enemies:number[],opponentId:number|undefined,excluded:number[],stats:StatsSnapshot,champions:Champion[]):Recommendation[] {
 const blocked=new Set([...enemies,...excluded]);
 const byId=new Map(champions.map(c=>[c.id,c]));
 const enemyGroups=[...new Set(enemies)].map(id=>byId.get(id)?.tags??[]);
 return stats.rows.filter(row=>row.role===role&&!blocked.has(row.championId)).map(row=>{
  const matchup=stats.counters.find(c=>c.role===role&&c.championId===row.championId&&c.opponentId===opponentId);
  // Shrink small matchup samples toward neutral; these points are not a predicted win rate.
  const reliability=matchup?matchup.games/(matchup.games+200):0;
  const matchupPoints=matchup?(matchup.winRate-50)*reliability*2:0;
  const tierPoints=row.tier===null?0:Math.max(0,6-row.tier)*2;
  const reasons:string[]=[];
  if(matchup) reasons.push(`对位胜率 ${matchup.winRate.toFixed(2)}% · ${matchup.games.toLocaleString()} 场${matchup.games<200?'，小样本已降权':''}`);
  else reasons.push(opponentId?'暂无该对位统计，按分路强度参考':'未指定主要对位，按分路强度参考');
  if(row.tier!==null)reasons.push(`OP.GG T${row.tier} · 分路胜率 ${row.winRate.toFixed(2)}%`);
  let composition=0;
  const tags=byId.get(row.championId)?.tags??[];
  if(enemyGroups.filter(group=>group.includes('Assassin')).length>=2&&tags.includes('Tank')){composition+=3;reasons.push('阵容规则 +3：敌方多刺客，坦克可提供承伤空间');}
  if(enemyGroups.filter(group=>group.some(t=>t==='Marksman'||t==='Mage')).length>=3&&tags.includes('Assassin')){composition+=2;reasons.push('阵容规则 +2：敌方后排较多，可考虑切入英雄');}
  const score=Math.round((50+(row.winRate-50)+tierPoints+matchupPoints+composition)*10)/10;
  return {championId:row.championId,score,matchupWinRate:matchup?.winRate??null,games:matchup?.games??null,tier:row.tier,reasons};
 }).sort((a,b)=>b.score-a.score);
}
