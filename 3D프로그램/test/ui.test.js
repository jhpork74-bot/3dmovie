const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const fs=require('node:fs');
const {chromium}=require('playwright-core');
test('editor controls, zoom timeline, export options and account/upload flow',async()=>{
  const root=path.resolve(__dirname,'..');
  const server=require('node:http').createServer((req,res)=>{const f=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!f.startsWith(root+path.sep)){res.writeHead(403).end();return;}const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png'};try{res.setHeader('Content-Type',types[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));}catch{res.writeHead(404).end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:1360,height:1200}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.calls=[];
      window.studio={settings:async()=>({folder:'C:\\Videos',platform:'youtube',accounts:{}}),
        saveSettings:async p=>{window.calls.push(['settings',p]);return {...p,folder:'C:\\Videos'};},
        chooseVideo:async()=>null,chooseFolder:async()=>({folder:'D:\\My Videos',accounts:{},platform:'youtube'}),
        preview:async p=>{window.calls.push(['preview',p]);return {duration:3.4,url:'../output/smoke-transparent.webm'};},
        export:async p=>{window.calls.push(['export',p]);return {output:'C:\\Videos\\test.mp4'};},
        showFile:async p=>window.calls.push(['showFile',p]),upload:async p=>window.calls.push(['upload',p]),cancel:async()=>{},onProgress:()=>{}};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/ui/index.html`);
    await page.fill('#script','안녕! 나는 이모지예요. 만나서 반가워요!');
    await page.locator('#zoom').fill('1.5');await page.click('#addKey');
    await page.locator('#timeline').fill('2');await page.locator('#zoom').fill('2');await page.click('#addKey');
    assert.equal(await page.locator('#keys button').count(),2);
    await page.selectOption('#preset','shorts');assert.match(await page.locator('#resolution').textContent(),/1080 × 1920/);
    await page.selectOption('#preset','transparent');assert.equal(await page.locator('#codec').isDisabled(),true);
    await page.selectOption('#preset','youtube');
    await page.click('#settingsButton');await page.fill('#accountYoutube','@sihu');await page.click('#saveSettings');
    await page.selectOption('#platform','tiktok');await page.click('#publish');await page.waitForFunction(()=>window.calls.some(x=>x[0]==='upload'));
    const calls=await page.evaluate(()=>window.calls);assert.ok(calls.some(x=>x[0]==='export'&&x[1].keyframes.length===2));assert.ok(calls.some(x=>x[0]==='upload'&&x[1]==='tiktok'));
    assert.ok(calls.findIndex(x=>x[0]==='export')<calls.findIndex(x=>x[0]==='upload'));
    assert.deepEqual(errors,[]);
    fs.mkdirSync(path.resolve(__dirname,'../output'),{recursive:true});
    await page.screenshot({path:path.resolve(__dirname,'../output/editor-screenshot.png'),fullPage:true});
  }finally{await browser.close();await new Promise(r=>server.close(r));}
});
