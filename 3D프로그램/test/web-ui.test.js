const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {chromium}=require('playwright-core');
test('web adapter selects a browser folder, polls an asynchronous job and streams output to it',async()=>{
  const root=path.resolve(__dirname,'..'),requests=[],bytes=Buffer.from('integration-output-bytes');let reads=0;
  const settings={folder:'',accounts:{},platform:'youtube',cloud:{managed:true,autoStart:true},actors:[{index:0,url:'/assets/avatar-closed.png',size:200,x:null,y:null}],editor:{},appearance:{font:'Malgun Gothic',textColor:'#202020',backgroundColor:'#c4c4c4'}};
  const server=require('node:http').createServer(async(req,res)=>{
    if(req.url==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.write(': connected\n\n');return;}
    if(req.url.startsWith('/api/')){let body='';for await(const chunk of req)body+=chunk;const value=body?JSON.parse(body):{};requests.push({url:req.url,body:value});res.setHeader('Content-Type','application/json');
      if(req.url==='/api/settings/get')res.end(JSON.stringify(settings));
      else if(req.url==='/api/settings/save'){Object.assign(settings,value);res.end(JSON.stringify(settings));}
      else if(req.url==='/api/render/export')res.end(JSON.stringify({id:'job1'}));
      else if(req.url==='/api/jobs/job1')res.end(JSON.stringify(++reads===1?{status:'running'}:{status:'completed',result:{output:'video.mp4',url:'/media/output',duration:2}}));
      else if(req.url==='/api/cloud/check')res.end(JSON.stringify({gpu:'test GPU',engine:'musetalk-1.5'}));
      else {res.statusCode=404;res.end(JSON.stringify({error:'unknown route'}));}return;
    }
    if(req.url==='/media/output'){res.setHeader('Content-Type','video/mp4');res.end(bytes);return;}
    const file=path.resolve(root,'.'+req.url.split('?')[0]);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try{const page=await browser.newPage({viewport:{width:1400,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{window.savedFiles=[];const handle={name:'내 영상 폴더',queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',getFileHandle:async name=>({createWritable:async()=>new WritableStream({write(chunk){window.savedFiles.push({name,bytes:Array.from(chunk)});}})})};window.showDirectoryPicker=async()=>handle;});
    await page.goto(`http://127.0.0.1:${server.address().port}/ui/index.html`);await page.locator('#webFolderDialog').getByRole('button',{name:'저장 폴더 선택',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('webFolderDialog').open);assert.match(await page.locator('#folder').textContent(),/내 영상 폴더/);assert.equal(await page.locator('#cloudEndpoint').isVisible(),false);
    await page.fill('#script','이모지1: 웹에서 만드는 영상입니다.');await page.click('#export');await page.waitForFunction(()=>window.savedFiles.length>0);assert.equal(await page.locator('#jobState').textContent(),'저장 완료');const output=await page.evaluate(()=>window.savedFiles);assert.equal(output[0].name,'video.mp4');assert.deepEqual(output.flatMap(v=>v.bytes),Array.from(bytes));assert.equal(requests.filter(r=>r.url==='/api/render/export').length,1);assert.equal(reads,2);assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
