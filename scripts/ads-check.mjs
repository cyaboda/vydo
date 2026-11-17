import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {createApp} from '../server.mjs';
const {chromium}=createRequire(process.env.PLAYWRIGHT_MODULE||import.meta.url)('playwright');
const output=process.env.UI_OUTPUT_DIR||'test-results';await mkdir(output,{recursive:true});
const css=await readFile(new URL('../public/style.css',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_BIN?{executablePath:process.env.BROWSER_BIN}:{})});
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZK0sAAAAASUVORK5CYII=','base64');
async function scenario({configured=true,cosmetic=false,network=false,control=true,storage=true},test){
 const app=await createApp({key:randomBytes(32),storeOptions:{filename:':memory:'},
  adConfig:configured?{provider:'isolated-test-fixture',image:'https://ads.example.test/banner.png',target:'https://ads.example.test/info'}:{},
  engine:{health:()=>({ytDlp:true,ffmpeg:true}),inspect:async()=>({title:'Authorized fixture',duration:1,thumbnail:null,formats:['mp4','mp3','wav','m4a','flac'],qualities:['360']}),
   process:async(job,dir)=>{const file=path.join(dir,'file.mp4');await writeFile(file,Buffer.alloc(1024));return file;}}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const context=await browser.newContext({viewport:{width:1366,height:768},deviceScaleFactor:1,colorScheme:'light'}),counts={probe:0,control:0};
 try{
  if(!storage)await context.addInitScript(()=>{Storage.prototype.setItem=()=>{throw Error('Storage disabled');};});
  if(cosmetic)await context.route('**/style.css',route=>route.fulfill({contentType:'text/css',body:css+'\n.adsbox { display:none!important; }'}));
  await context.route('https://ads.example.test/**',route=>route.fulfill({contentType:'image/png',body:pixel}));
  await context.route('**/ads/advertisement.js',route=>{counts.probe++;return network?route.abort('blockedbyclient'):route.continue();});
  await context.route('**/api/ad-check',route=>{counts.control++;return control?route.continue():route.fulfill({status:503,contentType:'application/json',body:'{}'});});
  const page=await context.newPage();await page.goto('http://127.0.0.1:'+app.server.address().port);
  await page.locator('#quota-info').filter({hasText:'5 de 5'}).waitFor();
  assert.equal(await page.locator('#sign-in').isDisabled(),true,'Unconfigured account must be clearly disabled');
  for(const [width,height] of [[1366,768],[1920,1080],[390,844]]){
   await page.setViewportSize({width,height});
   for(const audio of [false,true]){
    await page.locator(`[name=mode][value=${audio?'audio':'mp4'}]`).check();
    if(width>=1366)assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight),false,'Ad must not add initial desktop scroll');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   }
  }
  await page.setViewportSize({width:1366,height:768});await page.locator('[name=mode][value=mp4]').check();
  assert.equal(await page.locator('#advertisement').isVisible(),configured);
  async function prepare(){
   await page.locator('#url').fill('https://youtu.be/LY43o01dkU4');await page.locator('#analyze').click();await page.locator('#permission').check();await page.locator('#consent-form .primary').click();await page.locator('#preview').waitFor();await page.locator('#start').click();await page.locator('#finished').waitFor();
  }
  async function download(){const waiting=page.waitForEvent('download');await page.locator('#download').click();const file=await waiting;assert.equal(await file.failure(),null);}
  await test({page,counts,prepare,download});
 }catch(error){console.log(JSON.stringify({scenario:{configured,cosmetic,network,control,storage},alert:await context.pages()[0]?.locator('#alert').textContent()}));throw error;}
 finally{await context.close();await app.close();}
}
try{
 await scenario({configured:false,cosmetic:true,network:true},async({page,counts,prepare,download})=>{await prepare();await download();await page.waitForTimeout(1300);assert.equal(counts.probe,0);assert.equal(await page.locator('#support-message').isVisible(),false);});
 for(const options of [{cosmetic:true,network:false},{cosmetic:false,network:true},{cosmetic:true,network:true,control:false},{cosmetic:true,network:true,storage:false}]){
  await scenario(options,async({page,prepare,download})=>{await prepare();await download();await page.waitForTimeout(1500);assert.equal(await page.locator('#support-message').isVisible(),false,'Uncertain detection/storage failure must not prompt');});
 }
 await scenario({cosmetic:true,network:true},async({page,counts,prepare,download})=>{
  await prepare();assert.equal(await page.locator('#support-message').isVisible(),false,'Ready file is not a completed transfer');
  await download();await page.locator('#support-message').waitFor();assert.equal(counts.control,2);
  assert.match(await page.locator('#support-message').textContent(),/VYDO seguirá siendo tuyo para usarlo, sin condiciones/);
  assert.equal(await page.locator('#url').isEnabled(),true,'Support message cannot block converter');
  await page.screenshot({path:path.join(output,'vydo-3.3-adblock-light.png'),fullPage:true});
  await page.locator('#theme-toggle').click();await page.screenshot({path:path.join(output,'vydo-3.3-adblock-dark.png'),fullPage:true});
  await page.locator('#support-allow').click();await page.locator('#support-help').waitFor();assert.match(await page.locator('#support-help').textContent(),/no puede cambiar esa configuración/);
  await page.locator('#support-continue').click();assert.equal(await page.locator('#support-message').isVisible(),false);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('vydo_ad_notice_v1')).choice),'continue');
  await page.reload();await prepare();await download();await page.waitForTimeout(1200);assert.equal(await page.locator('#support-message').isVisible(),false);assert.equal(counts.control,2);
  await page.evaluate(()=>{const record=JSON.parse(localStorage.getItem('vydo_ad_notice_v1'));record.shownAt=Date.now()-31*86400000;record.dismissedAt=record.shownAt;localStorage.setItem('vydo_ad_notice_v1',JSON.stringify(record));});
  await prepare();await download();await page.locator('#support-message').waitFor();await page.locator('#support-close').click();assert.equal(await page.locator('#support-message').isVisible(),false);
  await page.evaluate(()=>{const record=JSON.parse(localStorage.getItem('vydo_ad_notice_v1'));record.shownAt=Date.now()-31*86400000;record.dismissedAt=record.shownAt;localStorage.setItem('vydo_ad_notice_v1',JSON.stringify(record));});
  await prepare();await download();await page.locator('#support-message').waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('#support-message').isVisible(),false);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('vydo_ad_notice_v1')).choice),'escape');
 });
 console.log('ADS PASS: no provider=no probe or notice; uncertain signals stay silent; completed HTTP transfer required; ad fits desktop; 30-day persistence; instructions only; Continue/X/Escape; both themes; downloads never blocked.');
}finally{await browser.close();}
