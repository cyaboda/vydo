import {createApp} from '../server.mjs';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(process.env.PLAYWRIGHT_MODULE || import.meta.url);
const {chromium}=require('playwright');
const output=process.env.UI_OUTPUT_DIR||'test-results';await mkdir(output,{recursive:true});
const password='local-ui-test-token-at-least-24-characters';
const app=await createApp({password,engine:{health:()=>({ytDlp:true,ffmpeg:true}),inspect:async()=>({title:'Tu biblioteca comienza con una idea',duration:125,thumbnail:null,formats:['mp4','mp3','wav','m4a','flac'],qualities:['1080','720','480','360']}),process:async(j,dir,progress)=>{progress({phase:'downloading',percent:46,bytes:460000,totalBytes:1000000});await new Promise(r=>setTimeout(r,1500));progress({phase:'converting',percent:25});await new Promise(r=>setTimeout(r,1000));const file=path.join(dir,'vydo.'+j.format);await writeFile(file,'media');return file;}}});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_BIN?{executablePath:process.env.BROWSER_BIN}:{})});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+app.server.address().port);await page.locator('#password').fill(password);await page.locator('#login-button').click();await page.locator('#gate').waitFor({state:'hidden'});
 await page.setViewportSize({width:1440,height:1150});await page.screenshot({path:path.join(output,'vydo-desktop.png'),fullPage:true});
 await page.locator('#url').fill('https://youtu.be/LY43o01dkU4');await page.locator('#permission').check();await page.locator('#analyze').click();await page.locator('#preview').waitFor();
 await page.locator('#start').click();await page.locator('#progress-panel').waitFor();await page.screenshot({path:path.join(output,'vydo-progress.png'),fullPage:true});await page.locator('#finished').waitFor();
 const downloadPromise=page.waitForEvent('download');await page.locator('#download').click();const download=await downloadPromise;console.log('download',download.suggestedFilename());
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'vydo-mobile.png'),fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('Mobile overflow');if(errors.length)throw Error(errors.join('\n'));
 console.log('UI PASS: login, preview, job progress, file download, mobile layout; no browser errors.');
}finally{await browser?.close();await app.close();}


