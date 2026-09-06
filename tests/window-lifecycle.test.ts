import {describe,expect,it} from 'vitest';
import {initialWindowState,nextWindowAction} from '../electron/window-lifecycle';

describe('window lifecycle state machine',()=>{
 it('minimizes once when a game starts and restores after the game ends',()=>{
  const started=nextWindowAction(initialWindowState(),{connected:true,phase:'InProgress',gameProcessRunning:true});
  expect(started).toMatchObject({action:'minimize',autoMinimized:true});
  const duplicate=nextWindowAction(started,{connected:true,phase:'InProgress',gameProcessRunning:true});
  expect(duplicate.action).toBe('none');
  const ended=nextWindowAction(duplicate,{connected:true,phase:'EndOfGame',gameProcessRunning:false});
  expect(ended).toMatchObject({action:'restore',autoMinimized:false});
 });

 it('does not restore a window that the assistant did not minimize',()=>{
  expect(nextWindowAction(initialWindowState(),{connected:true,phase:'EndOfGame',gameProcessRunning:false}).action).toBe('none');
 });

 it('keeps the window minimized through reconnect and transient LCU failures',()=>{
  let state=nextWindowAction(initialWindowState(),{connected:true,phase:'InProgress',gameProcessRunning:true});
  state=nextWindowAction(state,{connected:true,phase:'Reconnect',gameProcessRunning:true});
  expect(state.action).toBe('none');
  state=nextWindowAction(state,{connected:false,phase:'Unavailable',gameProcessRunning:true});
  state=nextWindowAction(state,{connected:false,phase:'Unavailable',gameProcessRunning:true});
  state=nextWindowAction(state,{connected:false,phase:'Unavailable',gameProcessRunning:true});
  expect(state.action).toBe('none');
 });

 it('restores after three failed polls once the game process has exited',()=>{
  let state=nextWindowAction(initialWindowState(),{connected:true,phase:'InProgress',gameProcessRunning:true});
  state=nextWindowAction(state,{connected:false,phase:'Unavailable',gameProcessRunning:false});
  state=nextWindowAction(state,{connected:false,phase:'Unavailable',gameProcessRunning:false});
  expect(state.action).toBe('none');
  state=nextWindowAction(state,{connected:false,phase:'Unavailable',gameProcessRunning:false});
  expect(state.action).toBe('restore');
 });
});
