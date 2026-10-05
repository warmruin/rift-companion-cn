import {_electron as electron} from 'playwright';

const app=await electron.launch({... (process.argv[2]?{executablePath:process.argv[2],args:[]}:{args:['.']}),env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
try{
 await app.evaluate(({ipcMain})=>{
  ipcMain.removeHandler('client');
  ipcMain.handle('client',()=>({connected:true,phase:'InProgress',message:'TEST FIXTURE',selfName:'自己',enemies:[],allies:[],banned:[],picked:[],teammates:[],opponents:[{id:'enemy',name:'敌方玩家#CN1',championId:54,role:'TOP',matches:Array.from({length:5},(_,i)=>({id:`enemy-match-${i}`,championId:54,queueId:420,date:Date.now()-i*86400000,win:i<3,kills:5,deaths:3,assists:7,duration:1800}))}],updatedAt:new Date().toISOString()}));
 });
 const page=await app.firstWindow();
 await page.reload();
 await page.getByRole('button',{name:'敌方状态',exact:true}).click();
 await page.getByText('敌方玩家#CN1',{exact:true}).waitFor();
 if(!await page.getByText('60%',{exact:true}).isVisible())throw new Error('Enemy win rate missing');
 if(await page.locator('.match').count()!==5)throw new Error('Expected five enemy matches');
 console.log('PASS: enemy page shows player, recent win rate and five matches');
}finally{await app.close();}
