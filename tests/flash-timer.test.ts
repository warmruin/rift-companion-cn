import {describe,expect,it} from 'vitest';
import {dueFlashReminders,recordFlash} from '../electron/flash-timer';
import {parseLiveEnemies} from '../electron/live-client';

describe('flash timers',()=>{
 it('schedules 30-second and 10-second reminders for base Flash cooldown',()=>{
  const timer=recordFlash(2,'熔岩巨兽',1_000);
  expect(timer.readyAt).toBe(301_000);
  expect(dueFlashReminders([timer],271_000).messages).toEqual([{timerId:timer.id,seconds:30,text:'熔岩巨兽 闪现还有30秒CD'}]);
 });
 it('emits each reminder once and expires after Flash is ready',()=>{
  const timer=recordFlash(1,'敌方英雄 1',0);
  const first=dueFlashReminders([timer],291_000);
  expect(first.messages.map(x=>x.seconds)).toEqual([30,10]);
  expect(dueFlashReminders(first.timers,295_000).messages).toEqual([]);
  expect(dueFlashReminders(first.timers,301_000).timers).toEqual([]);
 });
});

it('maps the opposing Live Client Data team to stable one-based slots',()=>{
 const enemies=parseLiveEnemies('自己',[{summonerName:'自己',team:'ORDER',championName:'Ahri'},{riotIdGameName:'对手',team:'CHAOS',championName:'Malphite'}]);
 expect(enemies).toEqual([{slot:1,championName:'Malphite',summonerName:'对手'}]);
});
