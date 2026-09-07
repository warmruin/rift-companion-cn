import {_electron as electron} from 'playwright';
const app=await electron.launch({args:['.'],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
try{
 const page=await app.firstWindow();
 await page.getByRole('button',{name:'选择敌方英雄 1',exact:true}).click();
 await page.locator('.pick-menu').waitFor();
 await page.getByRole('heading',{name:'让每一次选人，都有依据。'}).click();
 if(await page.locator('.pick-menu').count())throw Error('Outside click did not dismiss');
 await page.getByRole('button',{name:'选择敌方英雄 1',exact:true}).click();
 await page.keyboard.press('Escape');
 if(await page.locator('.pick-menu').count())throw Error('Escape did not dismiss');
 await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('save-settings');ipcMain.handle('save-settings',(_e,s)=>s);});
 await page.getByRole('button',{name:'队友状态',exact:true}).click();
 await page.getByLabel('评级称号1').fill('强势队友');
 await page.getByRole('button',{name:'保存称号',exact:true}).click();
 await page.getByText('评级称号已保存',{exact:true}).waitFor();
 if(await page.getByLabel('评级称号1').inputValue()!=='强势队友')throw Error('Label lost');
 await page.screenshot({path:'artifacts/team-0.4.1.png',fullPage:true});
 console.log('PASS outside click, Escape, custom rating editor and save response');
}finally{await app.close();}
