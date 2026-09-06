import {app,BrowserWindow,ipcMain,dialog,shell} from 'electron';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {getChampions,getStats,initStats} from './stats';
import {getClientSnapshot,setLockfile} from './lcu';
import {allowedSource,validateStatsArgs} from './security';

let win:BrowserWindow|null=null;
app.whenReady().then(()=>{
 initStats(path.join(app.getPath('userData'),'stats-cache'),path.join(app.getAppPath(),'assets'));
 ipcMain.handle('champions',async()=>(await getChampions()).map(champion=>{
  const icon=path.join(app.getAppPath(),'assets','champion-icons',`${champion.key}.png`);
  return {...champion,image:existsSync(icon)?pathToFileURL(icon).href:champion.image};
 }));
 ipcMain.handle('stats',(_event,role,id,force)=>{const args=validateStatsArgs(role,id);return getStats(args.role,args.opponentId,force===true);});
 ipcMain.handle('client',()=>getClientSnapshot());
 ipcMain.handle('choose-lockfile',async()=>{const result=await dialog.showOpenDialog({title:'选择 LOL 安装目录下的 lockfile',properties:['openFile']});if(result.canceled)return null;const file=result.filePaths[0];setLockfile(file);return file;});
 ipcMain.handle('open-source',async(_event,url)=>{if(typeof url!=='string'||!allowedSource(url))throw new Error('不允许打开此链接');await shell.openExternal(url);});
 win=new BrowserWindow({width:1400,height:940,minWidth:1080,minHeight:760,backgroundColor:'#0b1015',title:'Rift Companion · LOL 国服助手',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(e)=>e.preventDefault());
 win.loadFile(path.join(__dirname,'../dist/index.html'));
});
app.on('window-all-closed',()=>app.quit());
