import {app,BrowserWindow,ipcMain,dialog,shell} from 'electron';
import path from 'node:path';
import {appendFile,existsSync,readFileSync,writeFileSync,mkdirSync,statSync,renameSync,unlinkSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {AppSettings,BuildPlan} from '../src/shared/types';
import {getBuildPlans,getChampions,getStats,initStats,refreshAllRoles} from './stats';
import {applyBuildPlan,getClientSnapshot,isLeagueGameRunning,sendTeamRating,setLeaguePath,setLockfile} from './lcu';
import {initialWindowState,nextWindowAction} from './window-lifecycle';
import {allowedSource,elevationRelaunchSpec,validateStatsArgs} from './security';

const execFileAsync=promisify(execFile);const safeMode=process.argv.includes('--safe-renderer');
app.disableHardwareAcceleration();
let win:BrowserWindow|null=null;let settings:AppSettings={autoMinimize:true,autoRestore:true,leaguePath:''};let windowState=initialWindowState();let gameflowBusy=false;let recoveryAt=0;let recoveryFailures=0;let recovering=false;

function dataFile(name:string){return path.join(app.getPath('userData'),name);}
function log(message:string,details:Record<string,unknown>={}){
 try{const dir=dataFile('logs');mkdirSync(dir,{recursive:true});const file=path.join(dir,'lifecycle.log');if(existsSync(file)&&statSync(file).size>2*1024*1024){if(existsSync(`${file}.3`))unlinkSync(`${file}.3`);for(let i=2;i>=1;i--){const from=`${file}.${i}`,to=`${file}.${i+1}`;if(existsSync(from))renameSync(from,to);}renameSync(file,`${file}.1`);}void appendFile(file,`${new Date().toISOString()} ${message} ${JSON.stringify(details)}\n`,()=>{});}catch{/* logging must not crash the app */}
}
function loadSettings(){try{const value=JSON.parse(readFileSync(dataFile('settings.json'),'utf8')) as Partial<AppSettings>;settings={autoMinimize:value.autoMinimize!==false,autoRestore:value.autoRestore!==false,leaguePath:typeof value.leaguePath==='string'?value.leaguePath:''};}catch{/* defaults */}setLeaguePath(settings.leaguePath);}
function saveSettings(next:AppSettings){if(!next||typeof next!=='object')throw new Error('无效设置');settings={autoMinimize:next.autoMinimize!==false,autoRestore:next.autoRestore!==false,leaguePath:typeof next.leaguePath==='string'?next.leaguePath:''};setLeaguePath(settings.leaguePath);writeFileSync(dataFile('settings.json'),JSON.stringify(settings,null,2),'utf8');return settings;}
function loadHome(){if(win&&!win.isDestroyed())void win.loadFile(path.join(__dirname,'../dist/index.html'));}
function recoverRenderer(kind:string,details:Record<string,unknown>={}){
 log(kind,details);if(recovering||!win||win.isDestroyed())return;recovering=true;const now=Date.now();
 if(now-recoveryAt>=60_000)recoveryFailures=0;
 if(now-recoveryAt<60_000&&!safeMode){log('relaunch-safe-mode');app.relaunch({args:[...process.argv.slice(1).filter(arg=>arg!=='--safe-renderer'),'--safe-renderer']});app.exit(0);return;}
 if(safeMode&&recoveryFailures>=1){log('renderer-recovery-stopped');const html='<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0b1015;color:#dbe8e6;font:16px Segoe UI;padding:48px}p{color:#93a8ad}</style><h2>助手页面恢复失败</h2><p>请关闭并重新打开程序。诊断日志位于应用数据目录的 logs 文件夹。</p>';void win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);return;}
 recoveryAt=now;recoveryFailures+=1;setTimeout(()=>{loadHome();recovering=false;},250);
}
async function watchGameflow(){
 if(gameflowBusy)return;gameflowBusy=true;
 try{const snapshot=await getClientSnapshot();const gameRunning=snapshot.connected?true:await isLeagueGameRunning();const next=nextWindowAction(windowState,{connected:snapshot.connected,phase:snapshot.phase,gameProcessRunning:gameRunning});windowState=next;
  if(next.action==='minimize'&&!settings.autoMinimize){windowState=initialWindowState();}
  else if(next.action==='minimize'&&win&&!win.isDestroyed()){win.minimize();log('auto-minimize',{phase:snapshot.phase});}
  if(next.action==='restore'&&settings.autoRestore&&win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.webContents.reloadIgnoringCache();win.show();win.focus();log('auto-restore',{phase:snapshot.phase});}
 }catch(error){log('gameflow-watch-error',{message:error instanceof Error?error.message:String(error)});}finally{gameflowBusy=false;}
}

app.whenReady().then(()=>{
 initStats(path.join(app.getPath('userData'),'stats-cache'),path.join(app.getAppPath(),'assets'));loadSettings();log('app-ready',{version:app.getVersion(),safeMode,hardwareAcceleration:false});
 ipcMain.handle('champions',async()=>(await getChampions()).map(champion=>{const icon=path.join(app.getAppPath(),'assets','champion-icons',`${champion.key}.png`);return {...champion,image:existsSync(icon)?pathToFileURL(icon).href:champion.image};}));
 ipcMain.handle('stats',(_event,role,id,force)=>{const args=validateStatsArgs(role,id);return getStats(args.role,args.opponentId,force===true);});
 ipcMain.handle('build-plans',(_event,id,role,force)=>{const args=validateStatsArgs(role,id);if(!args.opponentId)throw new Error('无效英雄');return getBuildPlans(args.opponentId,args.role,force===true);});
  ipcMain.handle('apply-plan',(_event,plan:BuildPlan)=>applyBuildPlan(plan));
  ipcMain.handle('send-team-rating',()=>sendTeamRating());
 ipcMain.handle('client',()=>getClientSnapshot());ipcMain.handle('settings',()=>settings);ipcMain.handle('save-settings',(_event,next:AppSettings)=>saveSettings(next));
 ipcMain.handle('window-minimize',()=>{win?.minimize();});
 ipcMain.handle('choose-league-path',async()=>{const result=await dialog.showOpenDialog({title:'选择英雄联盟 LeagueClient 文件夹',properties:['openDirectory']});if(result.canceled)return null;const selected=result.filePaths[0];const candidates=[selected,path.join(selected,'LeagueClient')];const valid=candidates.find(folder=>existsSync(path.join(folder,'LeagueClient.exe')));if(!valid)throw new Error('所选目录中没有找到 LeagueClient.exe');saveSettings({...settings,leaguePath:valid});return valid;});
 ipcMain.handle('choose-lockfile',async()=>{const result=await dialog.showOpenDialog({title:'选择 LOL 安装目录下的 lockfile',properties:['openFile']});if(result.canceled)return null;const file=result.filePaths[0];setLockfile(file);return file;});
 ipcMain.handle('restart-elevated',async()=>{const target=process.env.PORTABLE_EXECUTABLE_FILE||process.execPath;const spec=elevationRelaunchSpec(target);await execFileAsync(spec.file,spec.args,{env:{...process.env,...spec.environment},windowsHide:true,timeout:30_000});setTimeout(()=>app.quit(),300);});
 ipcMain.handle('open-source',async(_event,url)=>{if(typeof url!=='string'||!allowedSource(url))throw new Error('不允许打开此链接');await shell.openExternal(url);});
 win=new BrowserWindow({width:1400,height:940,minWidth:1080,minHeight:760,backgroundColor:'#0b1015',icon:path.join(app.getAppPath(),'assets','app.ico'),title:'Rift Companion · LOL 国服助手',autoHideMenuBar:true,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(e)=>e.preventDefault());
 win.webContents.on('render-process-gone',(_event,details)=>recoverRenderer('render-process-gone',{reason:details.reason,exitCode:details.exitCode}));
  win.webContents.on('did-fail-load',(_event,code,description,url,isMainFrame)=>{if(isMainFrame&&code!==-3)recoverRenderer('did-fail-load',{code,description,url:path.basename(url)});});
 win.on('unresponsive',()=>recoverRenderer('window-unresponsive'));win.once('ready-to-show',()=>win?.show());win.webContents.on('did-finish-load',()=>{recovering=false;});
 loadHome();setInterval(()=>void watchGameflow(),2500);void watchGameflow();void refreshAllRoles();
});
app.on('window-all-closed',()=>app.quit());
