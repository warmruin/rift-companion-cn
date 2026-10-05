import {app,BrowserWindow,ipcMain,dialog,shell,clipboard,globalShortcut,Notification} from 'electron';
import path from 'node:path';
import {appendFile,existsSync,readFileSync,writeFileSync,mkdirSync,statSync,renameSync,unlinkSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {AppSettings,BuildPlan,FlashTimer,LiveEnemy} from '../src/shared/types';
import {getBuildPlans,getChampions,getStats,initStats,refreshAllRoles} from './stats';
import {applyBuildPlan,buildTeamRatingMessage,getClientSnapshot,isLeagueGameRunning,setLeaguePath,setLockfile} from './lcu';
import {dueFlashReminders,recordFlash as createFlashTimer} from './flash-timer';
import {getLiveEnemies} from './live-client';
import {initialWindowState,nextWindowAction} from './window-lifecycle';
import {allowedSource,elevationRelaunchSpec,normalizeHotkey,validateStatsArgs} from './security';

import {normalizeRatingLabels} from '../src/core/analysis';
const execFileAsync=promisify(execFile);const safeMode=process.argv.includes('--safe-renderer');
app.disableHardwareAcceleration();
let win:BrowserWindow|null=null;let settings:AppSettings={autoMinimize:true,autoRestore:true,leaguePath:'',ratingHotkey:'F6'};let windowState=initialWindowState();let gameflowBusy=false;let liveBusy=false;let recoveryAt=0;let recoveryFailures=0;let recovering=false;let liveEnemies:LiveEnemy[]=[];let flashTimers:FlashTimer[]=[];let liveMessage='进入游戏后读取敌方英雄';let liveUpdatedAt='';

function dataFile(name:string){return path.join(app.getPath('userData'),name);}
function log(message:string,details:Record<string,unknown>={}){
 try{const dir=dataFile('logs');mkdirSync(dir,{recursive:true});const file=path.join(dir,'lifecycle.log');if(existsSync(file)&&statSync(file).size>2*1024*1024){if(existsSync(`${file}.3`))unlinkSync(`${file}.3`);for(let i=2;i>=1;i--){const from=`${file}.${i}`,to=`${file}.${i+1}`;if(existsSync(from))renameSync(from,to);}renameSync(file,`${file}.1`);}void appendFile(file,`${new Date().toISOString()} ${message} ${JSON.stringify(details)}\n`,()=>{});}catch{/* logging must not crash the app */}
}
function loadSettings(){try{const value=JSON.parse(readFileSync(dataFile('settings.json'),'utf8')) as Partial<AppSettings>;settings={autoMinimize:value.autoMinimize!==false,autoRestore:value.autoRestore!==false,leaguePath:typeof value.leaguePath==='string'?value.leaguePath:'',ratingHotkey:normalizeHotkey(value.ratingHotkey??'F6'),ratingLabels:normalizeRatingLabels(value.ratingLabels)};}catch{/* defaults */}setLeaguePath(settings.leaguePath);}
function saveSettings(next:AppSettings){if(!next||typeof next!=='object')throw new Error('无效设置');const previous=settings;settings={autoMinimize:next.autoMinimize!==false,autoRestore:next.autoRestore!==false,leaguePath:typeof next.leaguePath==='string'?next.leaguePath:'',ratingHotkey:normalizeHotkey(next.ratingHotkey),ratingLabels:normalizeRatingLabels(next.ratingLabels)};if(!registerGlobalShortcuts()){settings=previous;registerGlobalShortcuts();throw new Error(`快捷键 ${next.ratingHotkey} 已被其他程序占用`);}setLeaguePath(settings.leaguePath);writeFileSync(dataFile('settings.json'),JSON.stringify(settings,null,2),'utf8');return settings;}
function notify(title:string,body:string){if(Notification.isSupported())new Notification({title,body,silent:false}).show();}
async function copyTeamRating(){const snapshot=await getClientSnapshot();const body=buildTeamRatingMessage(snapshot.teammates,settings.ratingLabels);clipboard.writeText(body);notify('队友评价已复制','在聊天框按 Ctrl+V 后发送');return body;}
function registerGlobalShortcuts(){globalShortcut.unregisterAll();const ok=globalShortcut.register(settings.ratingHotkey,()=>{void copyTeamRating().catch(error=>notify('无法复制队友评价',error instanceof Error?error.message:String(error)));});for(let slot=1;slot<=5;slot++)globalShortcut.register(`Control+Alt+${slot}`,()=>{void addFlashTimer(slot).catch(error=>notify('无法记录闪现',error instanceof Error?error.message:String(error)));});return ok;}
async function refreshLiveEnemies(){if(liveBusy)return;liveBusy=true;try{liveEnemies=await getLiveEnemies();liveMessage=liveEnemies.length?'已读取敌方阵容':'没有读取到敌方英雄';liveUpdatedAt=new Date().toISOString();}catch(error){liveMessage=error instanceof Error?error.message:String(error);liveUpdatedAt=new Date().toISOString();}finally{liveBusy=false;}}
function flashSnapshot(){return {enemies:liveEnemies,timers:flashTimers,message:liveMessage,updatedAt:liveUpdatedAt};}
async function addFlashTimer(slot:number){if(!Number.isInteger(slot)||slot<1||slot>5)throw new Error('无效敌方位置');if(!liveEnemies.length)await refreshLiveEnemies();const enemy=liveEnemies.find(item=>item.slot===slot);if(!enemy)throw new Error(`尚未读取到敌方位置 ${slot}`);flashTimers=flashTimers.filter(item=>item.enemySlot!==slot);flashTimers.push(createFlashTimer(slot,enemy.championName));notify('已记录敌方闪现',`${enemy.championName}：按 300 秒基础冷却计时`);return flashSnapshot();}
function tickFlashTimers(){const result=dueFlashReminders(flashTimers);flashTimers=result.timers;for(const reminder of result.messages){clipboard.writeText(reminder.text);notify('闪现计时提醒',`${reminder.text}（已复制）`);}}
function loadHome(){if(win&&!win.isDestroyed())void win.loadFile(path.join(__dirname,'../dist/index.html'));}
function recoverRenderer(kind:string,details:Record<string,unknown>={}){
 log(kind,details);if(recovering||!win||win.isDestroyed())return;recovering=true;const now=Date.now();
 if(now-recoveryAt>=60_000)recoveryFailures=0;
 if(now-recoveryAt<60_000&&!safeMode){log('relaunch-safe-mode');app.relaunch({args:[...process.argv.slice(1).filter(arg=>arg!=='--safe-renderer'),'--safe-renderer']});app.exit(0);return;}
 if(safeMode&&recoveryFailures>=1){log('renderer-recovery-stopped');const html='<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#07141e;color:#e9edf0;font:16px Segoe UI;padding:48px}p{color:#91a9b7}</style><h2>助手页面恢复失败</h2><p>请关闭并重新打开程序。诊断日志位于应用数据目录的 logs 文件夹。</p>';void win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);return;}
 recoveryAt=now;recoveryFailures+=1;setTimeout(()=>{loadHome();recovering=false;},250);
}
async function watchGameflow(){
 if(gameflowBusy)return;gameflowBusy=true;
 try{const snapshot=await getClientSnapshot();const gameRunning=snapshot.connected?true:await isLeagueGameRunning();const next=nextWindowAction(windowState,{connected:snapshot.connected,phase:snapshot.phase,gameProcessRunning:gameRunning});windowState=next;
  if(snapshot.phase==='InProgress')void refreshLiveEnemies();else if(['None','EndOfGame','Lobby','ChampSelect'].includes(snapshot.phase)){liveEnemies=[];flashTimers=[];liveMessage='进入游戏后读取敌方英雄';}
  if(next.action==='minimize'&&!settings.autoMinimize){windowState=initialWindowState();}
  else if(next.action==='minimize'&&win&&!win.isDestroyed()){win.minimize();log('auto-minimize',{phase:snapshot.phase});}
  if(next.action==='restore'&&settings.autoRestore&&win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.webContents.reloadIgnoringCache();win.show();win.focus();log('auto-restore',{phase:snapshot.phase});}
 }catch(error){log('gameflow-watch-error',{message:error instanceof Error?error.message:String(error)});}finally{gameflowBusy=false;}
}

app.whenReady().then(()=>{
 initStats(path.join(app.getPath('userData'),'stats-cache'),path.join(app.getAppPath(),'assets'));loadSettings();log('app-ready',{version:app.getVersion(),safeMode,hardwareAcceleration:false});
 if(!registerGlobalShortcuts())notify('快捷键不可用',`${settings.ratingHotkey} 已被其他程序占用，请在连接设置中修改`);
 ipcMain.handle('champions',async()=>(await getChampions()).map(champion=>{const icon=path.join(app.getAppPath(),'assets','champion-icons',`${champion.key}.png`);return {...champion,image:existsSync(icon)?pathToFileURL(icon).href:champion.image};}));
 ipcMain.handle('stats',(_event,role,id,force)=>{const args=validateStatsArgs(role,id);return getStats(args.role,args.opponentId,force===true);});
 ipcMain.handle('build-plans',(_event,id,role,force)=>{const args=validateStatsArgs(role,id);if(!args.opponentId)throw new Error('无效英雄');return getBuildPlans(args.opponentId,args.role,force===true);});
  ipcMain.handle('apply-plan',(_event,plan:BuildPlan)=>applyBuildPlan(plan));
  ipcMain.handle('copy-team-rating',()=>copyTeamRating());
  ipcMain.handle('flash-tracker',()=>flashSnapshot());
  ipcMain.handle('record-flash',(_event,slot:number)=>addFlashTimer(slot));
  ipcMain.handle('clear-flash',(_event,id:string)=>{flashTimers=flashTimers.filter(timer=>timer.id!==id);return flashSnapshot();});
 ipcMain.handle('client',()=>getClientSnapshot());ipcMain.handle('settings',()=>settings);ipcMain.handle('save-settings',(_event,next:AppSettings)=>saveSettings(next));
 ipcMain.handle('window-minimize',()=>{win?.minimize();});
 ipcMain.handle('choose-league-path',async()=>{const result=await dialog.showOpenDialog({title:'选择英雄联盟 LeagueClient 文件夹',properties:['openDirectory']});if(result.canceled)return null;const selected=result.filePaths[0];const candidates=[selected,path.join(selected,'LeagueClient')];const valid=candidates.find(folder=>existsSync(path.join(folder,'LeagueClient.exe')));if(!valid)throw new Error('所选目录中没有找到 LeagueClient.exe');saveSettings({...settings,leaguePath:valid});return valid;});
 ipcMain.handle('choose-lockfile',async()=>{const result=await dialog.showOpenDialog({title:'选择 LOL 安装目录下的 lockfile',properties:['openFile']});if(result.canceled)return null;const file=result.filePaths[0];setLockfile(file);return file;});
 ipcMain.handle('restart-elevated',async()=>{const target=process.env.PORTABLE_EXECUTABLE_FILE||process.execPath;const spec=elevationRelaunchSpec(target);await execFileAsync(spec.file,spec.args,{env:{...process.env,...spec.environment},windowsHide:true,timeout:30_000});setTimeout(()=>app.quit(),300);});
 ipcMain.handle('open-source',async(_event,url)=>{if(typeof url!=='string'||!allowedSource(url))throw new Error('不允许打开此链接');await shell.openExternal(url);});
 win=new BrowserWindow({width:1400,height:940,minWidth:1080,minHeight:760,backgroundColor:'#07141e',icon:path.join(app.getAppPath(),'assets','app.ico'),title:'Rift Companion · LOL 国服助手',autoHideMenuBar:true,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(e)=>e.preventDefault());
 win.webContents.on('render-process-gone',(_event,details)=>recoverRenderer('render-process-gone',{reason:details.reason,exitCode:details.exitCode}));
  win.webContents.on('did-fail-load',(_event,code,description,url,isMainFrame)=>{if(isMainFrame&&code!==-3)recoverRenderer('did-fail-load',{code,description,url:path.basename(url)});});
 win.on('unresponsive',()=>recoverRenderer('window-unresponsive'));win.once('ready-to-show',()=>win?.show());win.webContents.on('did-finish-load',()=>{recovering=false;});
 loadHome();setInterval(()=>void watchGameflow(),2500);setInterval(tickFlashTimers,1000);void watchGameflow();void refreshAllRoles();
});
app.on('will-quit',()=>globalShortcut.unregisterAll());
app.on('window-all-closed',()=>app.quit());
