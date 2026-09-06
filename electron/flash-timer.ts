import type {FlashReminder,FlashTimer} from '../src/shared/types';

const FLASH_COOLDOWN_MS=300_000;

export function recordFlash(enemySlot:number,championName:string,usedAt=Date.now()):FlashTimer{
 return {id:`${enemySlot}:${usedAt}`,enemySlot,championName,usedAt,readyAt:usedAt+FLASH_COOLDOWN_MS,reminded30:false,reminded10:false};
}

export function dueFlashReminders(timers:FlashTimer[],now=Date.now()):{timers:FlashTimer[];messages:FlashReminder[]}{
 const messages:FlashReminder[]=[];const active:FlashTimer[]=[];
 for(const original of timers){
  if(now>original.readyAt)continue;
  const timer={...original};
  if(!timer.reminded30&&now>=timer.readyAt-30_000){timer.reminded30=true;messages.push({timerId:timer.id,seconds:30,text:`${timer.championName} 闪现还有30秒CD`});}
  if(!timer.reminded10&&now>=timer.readyAt-10_000){timer.reminded10=true;messages.push({timerId:timer.id,seconds:10,text:`${timer.championName} 闪现还有10秒CD`});}
  active.push(timer);
 }
 return {timers:active,messages};
}
