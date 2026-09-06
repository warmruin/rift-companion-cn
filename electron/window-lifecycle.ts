export type WindowAction='none'|'minimize'|'restore';
export interface WindowLifecycleState {autoMinimized:boolean;disconnectCount:number;action:WindowAction}
export interface WindowObservation {connected:boolean;phase:string;gameProcessRunning:boolean}

export function initialWindowState():WindowLifecycleState{return {autoMinimized:false,disconnectCount:0,action:'none'};}

export function nextWindowAction(previous:WindowLifecycleState,observation:WindowObservation):WindowLifecycleState{
 const inGame=observation.phase==='InProgress'||observation.phase==='Reconnect';
 if(observation.connected&&inGame){
  if(!previous.autoMinimized)return {autoMinimized:true,disconnectCount:0,action:'minimize'};
  return {...previous,disconnectCount:0,action:'none'};
 }
 if(observation.connected){
  return previous.autoMinimized
   ? {autoMinimized:false,disconnectCount:0,action:'restore'}
   : {...previous,disconnectCount:0,action:'none'};
 }
 const disconnectCount=previous.disconnectCount+1;
 if(previous.autoMinimized&&!observation.gameProcessRunning&&disconnectCount>=3){
  return {autoMinimized:false,disconnectCount,action:'restore'};
 }
 return {...previous,disconnectCount,action:'none'};
}
