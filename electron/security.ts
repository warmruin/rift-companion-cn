import type {Role} from '../src/shared/types';
export function validateStatsArgs(role:unknown,opponentId:unknown):{role:Role;opponentId?:number}{
 if(typeof role!=='string'||!['top','jungle','mid','adc','support'].includes(role))throw new Error('无效分路');
 if(opponentId!==undefined&&(!Number.isInteger(opponentId)||Number(opponentId)<=0||Number(opponentId)>10000))throw new Error('无效英雄');
 return {role:role as Role,opponentId:opponentId as number|undefined};
}
export function allowedSource(url:string):boolean {
 try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&['op.gg','www.op.gg','support-developer.riotgames.com','developer.riotgames.com'].includes(u.hostname);}catch{return false;}
}

export function elevationRelaunchSpec(executablePath:string){
 if(!executablePath.trim())throw new Error('无法确定助手程序路径');
 return {
  file:'powershell.exe',
  args:['-NoProfile','-NonInteractive','-Command','Start-Process -FilePath $env:RIFT_COMPANION_EXE -Verb RunAs'],
  environment:{RIFT_COMPANION_EXE:executablePath},
 };
}
