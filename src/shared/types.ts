export type Role = 'top' | 'jungle' | 'mid' | 'adc' | 'support';
export interface Champion { id:number; key:string; name:string; title:string; tags:string[]; image:string }
export interface TierRow { championId:number; role:Role; tier:number|null; winRate:number; pickRate:number|null; games:number|null }
export interface CounterRow { championId:number; opponentId:number; role:Role; winRate:number; games:number }
export interface StatsSnapshot { rows:TierRow[]; counters:CounterRow[]; source:string; patch:string; region:string; rank:string; fetchedAt:string; stale:boolean; error?:string }
export interface Match { id:string; championId:number; queueId:number; date:number; win:boolean; kills:number; deaths:number; assists:number; duration:number }
export interface Rating { label:string; score:number|null; winRate:number|null; kda:number|null; count:number; explanation:string }
export interface Teammate { id:string; name:string; championId:number; role:string; matches:Match[]; error?:string; anonymous?:boolean; puuid?:string; summonerId?:number|string }
export interface ClientSnapshot { connected:boolean; phase:string; message:string; selfName?:string; role?:Role; queueId?:number; enemies:number[]; banned:number[]; picked:number[]; teammates:Teammate[]; updatedAt:string }
export interface Recommendation { championId:number; score:number; matchupWinRate:number|null; games:number|null; tier:number|null; reasons:string[] }
export interface AppApi {
 champions():Promise<Champion[]>;
 stats(role:Role,opponentId?:number,force?:boolean):Promise<StatsSnapshot>;
 client():Promise<ClientSnapshot>;
 chooseLockfile():Promise<string|null>;
 restartElevated():Promise<void>;
 openSource(url:string):Promise<void>;
}
declare global { interface Window { assistant:AppApi } }
