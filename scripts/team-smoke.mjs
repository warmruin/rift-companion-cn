// Isolated UI fixture test: this data exists only in the test process, never in production.
import {_electron as electron} from 'playwright';
const app=await electron.launch({args:['.'],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
try {
 await app.evaluate(({ipcMain})=>{
  ipcMain.removeHandler('client');
  ipcMain.handle('client',()=>({connected:true,phase:'ChampSelect',message:'TEST FIXTURE',selfName:'测试用户',enemies:[],banned:[],picked:[],updatedAt:new Date().toISOString(),teammates:[
   {id:'test-visible',name:'测试队友',championId:103,role:'mid',matches:Array.from({length:5},(_,i)=>({id:`fixture-${i}`,championId:103,queueId:420,date:Date.now()-i*86400000,win:true,kills:6,deaths:2,assists:4,duration:1800}))},
   {id:'anonymous:2',name:'匿名玩家',championId:0,role:'',anonymous:true,matches:[],error:'匿名玩家不查询战绩'}
  ]}));
 });
 const page=await app.firstWindow();
 await page.reload();
 await page.getByRole('button',{name:'队友状态',exact:true}).click();
 await page.getByText('测试队友',{exact:true}).waitFor();
 await page.getByText('上等马',{exact:true}).waitFor();
 if(await page.locator('.match.win').count()!==5)throw new Error('Expected five wins');
 if(!await page.getByText('100%',{exact:true}).isVisible())throw new Error('Wrong win rate');
 if(!await page.getByText('匿名玩家不查询战绩',{exact:true}).isVisible())throw new Error('Anonymous error missing');
 console.log('PASS: isolated fixture team UI shows five wins, 100% win rate, grade, and anonymous unavailable state');
}finally{await app.close();}
