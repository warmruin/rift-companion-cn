import type {Role} from '../src/shared/types';
export function validateStatsArgs(role:unknown,opponentId:unknown):{role:Role;opponentId?:number}{
 if(typeof role!=='string'||!['top','jungle','mid','adc','support'].includes(role))throw new Error('无效分路');
 if(opponentId!==undefined&&(!Number.isInteger(opponentId)||Number(opponentId)<=0||Number(opponentId)>10000))throw new Error('无效英雄');
 return {role:role as Role,opponentId:opponentId as number|undefined};
}
export function allowedSource(url:string):boolean {
 try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&['op.gg','www.op.gg','support-developer.riotgames.com','developer.riotgames.com'].includes(u.hostname);}catch{return false;}
}
export function normalizeHotkey(value:unknown):string{
 if(typeof value!=='string')throw new Error('无效快捷键');
 const parts=value.trim().split('+').map(part=>part.trim()).filter(Boolean);const key=parts.pop()?.toUpperCase();
 if(!key||!/^F(?:[1-9]|1[0-2])$/.test(key))throw new Error('评级快捷键需使用 F1–F12，可搭配 Ctrl、Alt 或 Shift');
 const modifiers:string[]=[];
 for(const part of parts){const name=part.toLowerCase();const normalized=name==='ctrl'||name==='control'?'Control':name==='alt'?'Alt':name==='shift'?'Shift':'';if(!normalized||modifiers.includes(normalized))throw new Error('评级快捷键格式无效');modifiers.push(normalized);}
 return [...modifiers,key].join('+');
}

export function elevationRelaunchSpec(executablePath:string){
 if(!executablePath.trim())throw new Error('无法确定助手程序路径');
 return {
  file:'powershell.exe',
  args:['-NoProfile','-NonInteractive','-Command','Start-Process -FilePath $env:RIFT_COMPANION_EXE -Verb RunAs'],
  environment:{RIFT_COMPANION_EXE:executablePath},
 };
}
