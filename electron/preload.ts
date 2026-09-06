import {contextBridge,ipcRenderer} from 'electron';
import type {AppApi} from '../src/shared/types';
const api:AppApi={champions:()=>ipcRenderer.invoke('champions'),stats:(role,id,force)=>ipcRenderer.invoke('stats',role,id,force),client:()=>ipcRenderer.invoke('client'),chooseLockfile:()=>ipcRenderer.invoke('choose-lockfile'),restartElevated:()=>ipcRenderer.invoke('restart-elevated'),openSource:(url)=>ipcRenderer.invoke('open-source',url)};
contextBridge.exposeInMainWorld('assistant',api);
