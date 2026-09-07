import { describe,it,expect } from 'vitest';
import { rateMatches,recommend } from '../src/core/analysis';
import type { Match,StatsSnapshot,Champion } from '../src/shared/types';
const match=(i:number,win=true):Match=>({id:String(i),championId:1,queueId:420,date:i,win,kills:4,deaths:0,assists:6,duration:1800});
describe('近期状态',()=>{
 it('不足三场不评分，空集没有胜率',()=>{expect(rateMatches([]).score).toBeNull();expect(rateMatches([]).winRate).toBeNull();expect(rateMatches([match(1),match(2)]).label).toBe('样本不足');});
 it('只取最近五场并去重，零死亡不会无穷大',()=>{const r=rateMatches([match(0,false),...Array.from({length:5},(_,i)=>match(i+1)),match(5)]);expect(r.count).toBe(5);expect(r.winRate).toBe(100);expect(Number.isFinite(r.kda)).toBe(true);expect(r.label).toBe('上等马');});
 it('五负是低状态',()=>{expect(rateMatches(Array.from({length:5},(_,i)=>({...match(i,false),deaths:10,kills:1,assists:1}))).label).toBe('下等马');});
});
const champions:Champion[]=[1,2,3].map(id=>({id,key:String(id),name:String(id),title:'',tags:['Fighter'],image:''}));
const stats:StatsSnapshot={rows:[1,2,3].map(championId=>({championId,role:'top',tier:2,winRate:50,pickRate:5,games:1000})),counters:[{championId:1,opponentId:9,role:'top',winRate:60,games:1000},{championId:2,opponentId:9,role:'top',winRate:45,games:1000}],source:'test',patch:'test',region:'test',rank:'test',fetchedAt:'',stale:false};
describe('推荐',()=>{
 it('阵容规则按英雄人数而非双标签计数',()=>{const roster=[...champions.map(c=>({...c,tags:['Assassin']})),{id:9,key:'9',name:'9',title:'',tags:['Mage','Marksman'],image:''},{id:10,key:'10',name:'10',title:'',tags:['Mage'],image:''}];const r=recommend('top',[9,10],undefined,[],stats,roster);expect(r[0].reasons.some(x=>x.includes('阵容规则'))).toBe(false);});
 it('按我方打敌方胜率排序且排除已选禁用',()=>{const r=recommend('top',[9],9,[3],stats,champions);expect(r.map(x=>x.championId)).toEqual([1,2]);expect(r[0].matchupWinRate).toBe(60);});
 it('缺失对位统计不伪造50%胜率',()=>{expect(recommend('top',[],undefined,[],stats,champions)[0].matchupWinRate).toBeNull();});
 it('样本很少的极端胜率不会压过充分样本',()=>{const s={...stats,counters:[{championId:1,opponentId:9,role:'top' as const,winRate:100,games:1},stats.counters[0] && {championId:2,opponentId:9,role:'top' as const,winRate:58,games:1000}]};expect(recommend('top',[9],9,[3],s,champions)[0].championId).toBe(2);});
 it('勾选后为自家阵容补充法术伤害和前排因素',()=>{const roster=[{...champions[0],tags:['Mage']},{...champions[1],tags:['Tank']},{...champions[2],tags:['Fighter']},{id:20,key:'ally',name:'射手',title:'',tags:['Marksman'],image:''}];const result=recommend('top',[],undefined,[],stats,roster,[20],true);expect(result.find(x=>x.championId===1)?.reasons.join('')).toContain('法术伤害');expect(result.find(x=>x.championId===2)?.reasons.join('')).toContain('前排');});
 it('未勾选时不加入自家阵容补位分',()=>{expect(recommend('top',[],undefined,[],stats,champions,[1],false).flatMap(x=>x.reasons).some(x=>x.includes('自家阵容'))).toBe(false);});
 it('已有坦克但缺战士时仍会给战士补位加分',()=>{const roster=[...champions,{id:30,key:'tank',name:'坦克',title:'',tags:['Tank'],image:''}];const result=recommend('top',[],undefined,[],stats,roster,[30],true);expect(result.find(x=>x.championId===1)?.reasons.join('')).toContain('战士');});
});

it('strong counter uses only raw matchup win rate, including candidates absent from tiers',()=>{
 const s={...stats,counters:[...stats.counters,{championId:4,opponentId:9,role:'top' as const,winRate:99,games:1}]};
 const result=recommend('top',[9],9,[],s,champions,[1],true,true);
 expect(result.map(r=>r.championId)).toEqual([4,1,2]);
 expect(result[0].score).toBe(99);
 expect(recommend('top',[],undefined,[],s,champions,[],false,true)).toEqual([]);
 expect(recommend('top',[9],9,[4],s,champions,[],false,true).map(r=>r.championId)).toEqual([1,2]);
});
