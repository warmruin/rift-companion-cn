import {_electron as electron} from 'playwright';

const app=await electron.launch({args:['.'],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
try{
 const page=await app.firstWindow();
 await page.getByRole('button',{name:'连接设置',exact:true}).click();
 await page.getByRole('button',{name:'以管理员身份重启',exact:true}).waitFor({timeout:15_000});
 await page.getByText(/已检测到 LOL 客户端.*管理员权限/).waitFor({timeout:15_000});
 console.log('PASS: running League client detected; privilege guidance and elevated restart action are visible');
}finally{await app.close();}
