import https from 'node:https';
import type {LiveEnemy} from '../src/shared/types';

type Json=Record<string,any>;
function liveGet<T>(route:string):Promise<T>{return new Promise((resolve,reject)=>{const request=https.get({hostname:'127.0.0.1',port:2999,path:`/liveclientdata/${route}`,rejectUnauthorized:false,timeout:1600},response=>{let body='';response.setEncoding('utf8');response.on('data',chunk=>body+=chunk);response.on('end',()=>{if((response.statusCode??500)>=400)return reject(new Error(`局内接口 ${response.statusCode}`));try{resolve(JSON.parse(body) as T);}catch{reject(new Error('局内接口返回无效数据'));}});});request.on('timeout',()=>request.destroy(new Error('局内接口连接超时')));request.on('error',reject);});}

export function parseLiveEnemies(activeName:string,players:Json[]):LiveEnemy[]{
 const self=players.find(player=>String(player.summonerName)===String(activeName)||String(player.riotIdGameName)===String(activeName));
 if(!self?.team)throw new Error('无法从局内接口识别己方队伍');
 return players.filter(player=>player.team&&player.team!==self.team).slice(0,5).map((player,index)=>({slot:index+1,championName:String(player.championName||player.rawChampionName||`敌方英雄 ${index+1}`),summonerName:String(player.riotId||(player.riotIdGameName&&player.riotIdTagLine?`${player.riotIdGameName}#${player.riotIdTagLine}`:player.riotIdGameName)||player.summonerName||'')}));
}

export async function getLiveEnemies():Promise<LiveEnemy[]>{
 const [activeName,players]=await Promise.all([liveGet<string>('activeplayername'),liveGet<Json[]>('playerlist')]);
 return parseLiveEnemies(activeName,players);
}
