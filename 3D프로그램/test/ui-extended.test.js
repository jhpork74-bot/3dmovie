const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const widgets=require('../ui/studio-extra');

test('dialogue estimates preserve automatic order, manual points, and actual timings',()=>{
  const text='이모지1: 안녕\n이모지2: 만나서 반가워\n이모지1: 좋아';
  const automatic=widgets.dialogue(text);assert.equal(automatic.length,3);assert.equal(automatic[1].actor,1);assert.ok(automatic[1].start>automatic[0].end);assert.equal(automatic[1].emotion,'happy');
  const manual=widgets.dialogue(text,[null,5]);assert.equal(manual[1].start,5);
  const actual=widgets.dialogue(text,[],[],1,[{index:0,start:0,duration:2.2},{index:1,start:2.35,duration:3}]);assert.equal(actual[1].start,2.35);assert.equal(actual[1].duration,3);assert.equal(actual[1].actual,true);
});
test('progress never completes a group from a partial processing-unit event',()=>{
  const model=new widgets.ProgressModel();model.start();model.update({group:0,groupPercent:40,status:'completed'});assert.equal(model.groups[0].percent,40);assert.notEqual(model.groups[0].status,'완료');model.update({group:0,groupPercent:100,status:'completed'});assert.equal(model.groups[0].status,'완료');model.pause('연결 대기');assert.equal(model.remaining(),null);assert.equal(model.activeAt,null);
});

async function harness(fn){
  const root=path.resolve(__dirname,'..');
  const server=require('node:http').createServer((req,res)=>{const f=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!f.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.mp4':'video/mp4'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));}catch{res.writeHead(404).end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:1450,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.calls=[];window.handlers=[];window.renderMode='success';window.exportCount=0;
      let settings={folder:'C:\\Videos',platform:'youtube',accounts:{youtube:'@sihu'},appearance:{font:'Malgun Gothic',textColor:'#202020',backgroundColor:'#c4c4c4'},cloud:{endpoint:'https://example.trycloudflare.com',configured:true,autoStart:true},actors:[{index:0,url:'/assets/avatar-closed.png',size:200,x:null,y:null}],editor:{},music:{volume:.15,duck:true},defaultVideo:{name:'기본 영상',url:'/assets/background.mp4'}};
      window.studio={settings:async()=>structuredClone(settings),saveSettings:async p=>{window.calls.push(['saveSettings',p]);settings={...settings,...p};return structuredClone(settings);},
        chooseVideo:async()=>({name:'새 영상.mp4',url:'/assets/background.mp4'}),chooseFolder:async()=>{settings.folder='D:\\선택한 폴더';return structuredClone(settings);},
        chooseAvatar:async index=>{settings.actors[index].url='/assets/avatar-open.png';window.calls.push(['avatar',index]);return structuredClone(settings.actors);},resetAvatar:async index=>{settings.actors[index].url='/assets/avatar-closed.png';return structuredClone(settings.actors);},
        addActor:async()=>{settings.actors.push({index:settings.actors.length,url:'/assets/avatar-closed.png',size:200,x:null,y:null});return structuredClone(settings.actors);},removeActor:async index=>{window.calls.push(['removeActor',index]);settings.actors.splice(index,1);return structuredClone(settings.actors);},updateActor:async actor=>{window.calls.push(['updateActor',actor]);settings.actors[actor.index]={...settings.actors[actor.index],...actor};return structuredClone(settings.actors);},
        chooseMusic:async()=>({name:'배경음.avi',file:'C:\\music.m4a',volume:.15,duck:true}),removeMusic:async()=>{},
        exportSettings:async()=>{window.calls.push(['exportIni']);return 'C:\\Settings.ini';},importSettings:async()=>({...structuredClone(settings),appearance:{font:'Arial',textColor:'#123456',backgroundColor:'#dedede'},editor:{...settings.editor,text:'이모지1: 설정 복원',videoEffect:'warm',effectStrength:.7}}),
        saveCloud:async p=>{window.calls.push(['saveCloud',{endpoint:p.endpoint,hasToken:!!p.token}]);return {endpoint:p.endpoint,configured:true};},checkCloud:async()=>{window.calls.push(['health']);return {gpu:'Test GPU',engine:'musetalk-1.5'};},openColab:async()=>{},clearCloudCache:async()=>{},
        chooseScriptPhotos:async()=>[{id:'photo1',name:'활동1.png',url:'/assets/avatar-closed.png'},{id:'photo2',name:'활동2.png',url:'/assets/avatar-open.png'}],generatePhotoScript:async p=>{window.calls.push(['photoDraft',p]);return {text:'이모지1: 첫 사진의 활동입니다.\n이모지2: 함께 나누니 기뻐요!',photoCount:p.photoIds.length};},
        transcribeVideo:async p=>{window.calls.push(['transcribeVideo',p]);return {language:'ko',segments:[{id:'c1',start:0,end:1.2,text:'함께 나누는 시간',needsReview:true},{id:'c2',start:1.3,end:3,text:'모두 감사합니다.',needsReview:false}]};},preview:async p=>({url:'/output/smoke-transparent.webm',duration:3.5}),
        export:async p=>{window.calls.push(['export',p]);window.exportCount++;if(window.renderMode==='failOnce'){window.renderMode='success';window.handlers.forEach(fn=>fn({percent:42,message:'무료 클라우드 연결 대기',detail:{group:0,groupPercent:45,status:'waiting'}}));throw Error('무료 클라우드 연결 종료');}if(window.renderMode==='hold')return new Promise((resolve,reject)=>{window.cancelRender=()=>reject(Error('일시 중단'));});return {output:'C:\\Videos\\test.mp4'};},cancel:async()=>window.cancelRender?.(),showFile:async p=>window.calls.push(['showFile',p]),upload:async p=>window.calls.push(['upload',p]),onProgress:fn=>window.handlers.push(fn)};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/ui/index.html`);await page.waitForSelector('.actor-stage');
    await fn(page);assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}

test('full editor: actor mouse resize, dialogue timing, INI, FX, music and ordered photo drafts',async()=>harness(async page=>{
  assert.equal(await page.locator('#autoStart').isChecked(),true);assert.equal(await page.locator('.segment-card').count(),5);
  await page.click('#addActor');await page.click('#addActor');assert.equal(await page.locator('.actor-stage').count(),3);
  await page.selectOption('#activeActor','1');await page.click('#chooseAvatar');assert.equal(await page.locator('.actor-stage[data-actor="1"] img').getAttribute('src'),'/assets/avatar-open.png');
  const handle=page.locator('.actor-stage[data-actor="1"] .actor-resize'),box=await handle.boundingBox();await page.mouse.move(box.x+4,box.y+4);await page.mouse.down();await page.mouse.move(box.x+35,box.y+25,{steps:4});await page.mouse.up();await page.waitForFunction(()=>window.calls.some(c=>c[0]==='updateActor'&&c[1].size>200));
  await page.fill('#script','이모지1: 안녕\n이모지2: 만나서 반가워\n이모지3: 오늘은 어때?');assert.equal(await page.locator('.dialogue-row').count(),3);await page.fill('[aria-label="대사2 시작 초"]','5');await page.locator('[aria-label="대사2 시작 초"]').dispatchEvent('change');
  const block=page.locator('.dialogue-block').nth(2),rect=await block.boundingBox();await page.mouse.move(rect.x+5,rect.y+6);await page.mouse.down();await page.mouse.move(rect.x+55,rect.y+6,{steps:3});await page.mouse.up();assert.ok(Number(await page.locator('[aria-label="대사3 시작 초"]').inputValue())>0);
  await page.click('#chooseMusic');assert.match(await page.locator('#musicName').textContent(),/avi/);await page.locator('#musicVolume').fill('0.3');
  await page.click('#videoFx');await page.click('[data-effect="warm"]');await page.locator('#effectStrength').fill('0.7');await page.click('#applyVideoFx');assert.match(await page.locator('#fxSummary').textContent(),/따뜻/);
  await page.click('#addSound');assert.equal(await page.locator('.sound-cue').count(),1);
  await page.click('#settingsButton');await page.fill('#fontFamily','Arial');await page.locator('#textColor').fill('#123456');await page.click('#settingsFolder');await page.click('#exportIni');await page.click('#saveSettings');assert.match(await page.locator('#folder').textContent(),/선택한 폴더/);
  await page.click('#photoScript');await page.click('#choosePhoto');assert.equal(await page.locator('.photo-thumb').count(),2);await page.locator('.photo-thumb').nth(1).getByRole('button',{name:'←',exact:true}).click();await page.fill('#photoPrompt','사회복지사의 사회공헌 활동을 짧은 대화로');await page.click('#generatePhotoScript');await page.waitForFunction(()=>window.calls.some(c=>c[0]==='photoDraft'));const request=await page.evaluate(()=>window.calls.find(c=>c[0]==='photoDraft')[1]);assert.deepEqual(request.photoIds,['photo2','photo1']);await page.click('#usePhotoDraft');assert.match(await page.locator('#script').inputValue(),/첫 사진/);
  await page.click('#export');await page.waitForFunction(()=>window.calls.some(c=>c[0]==='export'));const exported=await page.evaluate(()=>window.calls.find(c=>c[0]==='export')[1]);assert.equal(exported.videoEffect,'warm');assert.equal(exported.audioEffects.length,1);assert.equal(exported.musicVolume,.3);assert.equal(await page.locator('#jobState').textContent(),'저장 완료');assert.equal(await page.locator('.segment-card.done').count(),5);
  fs.mkdirSync(path.resolve(__dirname,'../output'),{recursive:true});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.resolve(__dirname,'../output/editor-flash-workspace.png'),fullPage:true});
  await page.click('#settingsButton');await page.click('#importIni');assert.equal(await page.locator('#fontFamily').inputValue(),'Arial');assert.match(await page.locator('#script').inputValue(),/설정 복원/);await page.locator('#settingsDialog button[value="cancel"]').click();
}));

test('auto-start waits for a connection check, resumes, then saves; manual pause stays paused',async()=>harness(async page=>{
  await page.clock.install();await page.fill('#script','이모지1: 자동 재개 테스트입니다.');await page.evaluate(()=>window.renderMode='failOnce');await page.click('#export');await page.waitForFunction(()=>window.exportCount===1);await page.waitForFunction(()=>document.getElementById('jobState').textContent==='연결 대기');assert.match(await page.locator('#jobRetry').textContent(),/초 후/);await page.clock.fastForward(31000);await page.waitForFunction(()=>window.exportCount===2);assert.equal(await page.locator('#jobState').textContent(),'저장 완료');assert.ok((await page.evaluate(()=>window.calls)).some(c=>c[0]==='health'));
  await page.evaluate(()=>window.renderMode='hold');await page.click('#export');await page.waitForFunction(()=>window.exportCount===3);await page.click('#cancel');await page.waitForFunction(()=>document.getElementById('jobState').textContent==='일시 중단');await page.clock.fastForward(61000);assert.equal(await page.evaluate(()=>window.exportCount),3);await page.evaluate(()=>window.renderMode='success');await page.click('#resume');await page.waitForFunction(()=>window.exportCount===4);assert.equal(await page.locator('#jobState').textContent(),'저장 완료');
}));

const subtitles=require('../ui/subtitles');
test('subtitle validation and SRT preserve words and timing without invented substitutions',()=>{
  const cues=subtitles.normalize([{start:1.25,end:2.5,text:'기관명 확인',needsReview:true},{start:0,end:1,text:'안녕하세요'}]);assert.equal(cues[0].text,'안녕하세요');assert.equal(cues[1].needsReview,true);assert.match(subtitles.srt(cues),/00:00:01,250 --> 00:00:02,500/);assert.equal(subtitles.timestamp(59.9996),'00:01:00,000');assert.throws(()=>subtitles.normalize([{start:4,end:3,text:'잘못된 시간'}]));assert.throws(()=>subtitles.normalize([{start:0,end:1,text:' '} ]));
});
test('AI subtitles use existing video, expose uncertain text for editing, apply to export and SRT',async()=>harness(async page=>{
  await page.fill('#script','이모지1: 자막이 있는 사회공헌 영상입니다.');await page.click('#aiSubtitles');await page.fill('#subtitleGlossary','우리복지관, 김시후');await page.click('#transcribeSubtitles');await page.waitForSelector('.subtitle-row');assert.equal(await page.locator('.subtitle-row').count(),2);assert.equal(await page.locator('.subtitle-row.needs-review').count(),1);const request=await page.evaluate(()=>window.calls.find(c=>c[0]==='transcribeVideo')[1]);assert.deepEqual(request,{language:'ko',glossary:'우리복지관, 김시후'});assert.equal(await page.evaluate(()=>window.calls.some(c=>c[0]==='chooseVideo')),false);
  await page.fill('[aria-label="자막1 내용"]','함께 나누는 따뜻한 시간');await page.check('[aria-label="자막1 검토 완료"]');await page.fill('[aria-label="자막2 시작 초"]','1.4');await page.fill('#subtitleFontSize','48');await page.selectOption('#subtitlePosition','top');const download=page.waitForEvent('download');await page.click('#exportSrt');const saved=await download;assert.match(saved.suggestedFilename(),/\.srt$/);await page.click('#applySubtitles');assert.equal(await page.locator('#subtitleTrack .subtitle-block').count(),2);assert.match(await page.locator('#subtitleCount').textContent(),/확인 필요 0개/);await page.locator('#timeline').fill('0.5');await page.locator('#timeline').dispatchEvent('input');assert.equal(await page.locator('#subtitlePreview').textContent(),'함께 나누는 따뜻한 시간');await page.click('#export');await page.waitForFunction(()=>window.calls.some(c=>c[0]==='export'));const output=await page.evaluate(()=>window.calls.find(c=>c[0]==='export')[1]);assert.equal(output.subtitles[0].text,'함께 나누는 따뜻한 시간');assert.equal(output.subtitles[1].start,1.4);assert.equal(output.subtitleStyle.fontSize,48);assert.equal(output.subtitleStyle.position,'top');
}));
