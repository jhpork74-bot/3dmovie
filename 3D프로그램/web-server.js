'use strict';
const express=require('express'),busboy=require('busboy');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {Worker}=require('node:worker_threads');
const {pipeline}=require('node:stream/promises');
const {createStore,stringify,parse}=require('./settings-store');
const {importMusic,importPhoto,convert}=require('./media');
const {options}=require('./engine');
const cloud=require('./cloud-lipsync');

function createWebApp({dataDir=path.join(os.tmpdir(),'sihu-web'),sessionToken,cloudEndpoint='http://127.0.0.1:7860',cloudToken=sessionToken,
  renderMode='cloud',workerFactory=(input)=>new Worker(path.join(__dirname,'worker.js'),{workerData:input})}={}){
  if(typeof sessionToken!=='string'||sessionToken.length<24)throw Error('SIHU_SESSION_TOKEN must be a random session code of at least 24 characters');
  fs.mkdirSync(dataDir,{recursive:true});const store=createStore(dataDir),app=express(),sessions=new Set(),media=new Map(),jobs=new Map(),clients=new Set();let active=null;
  const outputDir=path.join(dataDir,'exports'),cacheDir=path.join(dataDir,'cloud-cache');fs.mkdirSync(outputDir,{recursive:true});
  app.disable('x-powered-by');app.use(express.json({limit:'2mb'}));
  const emit=value=>{for(const response of clients)response.write(`data: ${JSON.stringify(value)}\n\n`);};
  function expose(file){let id=[...media.entries()].find(([,f])=>f===file)?.[0];if(!id){id=crypto.randomBytes(16).toString('hex');media.set(id,file);}return '/media/'+id;}
  function current(){return store.read();}
  function write(value){return store.write(value);}
  function actorFile(a){return a?.file&&path.extname(a.file).toLowerCase()==='.png'&&fs.existsSync(a.file)?a.file:path.join(__dirname,'assets','avatar-closed.png');}
  function actors(){return current().actors.map((a,index)=>({...a,index,url:expose(actorFile(a))}));}
  function publicSettings(){const p=current(),background=p.background.file&&fs.existsSync(p.background.file)?p.background.file:path.join(__dirname,'assets','background.mp4');return {...p,actors:actors(),avatar:actors()[0],cloud:{managed:true,configured:true,autoStart:p.cloud.autoStart,endpoint:''},defaultVideo:fs.existsSync(background)?{name:path.basename(background),url:expose(background)}:null};}
  const sameCode=value=>{const a=Buffer.from(String(value||'')),b=Buffer.from(sessionToken);return a.length===b.length&&crypto.timingSafeEqual(a,b);};
  const authorized=req=>{const raw=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('sihu_session='));return raw&&sessions.has(raw.slice('sihu_session='.length));};
  app.use((req,res,next)=>{res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');res.set('X-Content-Type-Options','nosniff');if(req.method==='POST'&&req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return res.status(403).json({error:'다른 사이트에서의 요청은 허용하지 않습니다.'});}catch{return res.status(403).end();}}next();});
  app.post('/api/session',(req,res)=>{if(!sameCode(req.body.code))return res.status(401).json({error:'노트북에 표시된 연결 코드를 확인하세요.'});const id=crypto.randomBytes(32).toString('hex');sessions.add(id);res.set('Set-Cookie',`sihu_session=${id}; HttpOnly; SameSite=Strict; Path=/${req.headers['x-forwarded-proto']==='https'?'; Secure':''}`);res.json({ok:true});});
  app.use((req,res,next)=>{if(authorized(req))return next();if(req.path==='/')return res.type('html').send(loginPage());return res.status(401).json({error:'무료 세션 연결이 필요합니다.'});});
  app.get('/api/events',(req,res)=>{res.set({'Content-Type':'text/event-stream','Connection':'keep-alive'});res.flushHeaders();clients.add(res);const timer=setInterval(()=>res.write(': heartbeat\n\n'),20000);req.on('close',()=>{clients.delete(res);clearInterval(timer);});});
  app.get('/media/:id',(req,res)=>{const file=media.get(req.params.id);if(!file||!fs.existsSync(file))return res.status(404).end();res.sendFile(path.resolve(file));});
  const route=(name,fn)=>app.post('/api/'+name,async(req,res,next)=>{try{res.json(await fn(req.body||{},req));}catch(e){next(e);}});
  route('settings/get',()=>publicSettings());
  route('settings/save',p=>{const old=current();write({...old,folder:p.folder===undefined?old.folder:String(p.folder).slice(0,200),platform:p.platform??old.platform,accounts:p.accounts??old.accounts,appearance:p.appearance??old.appearance,editor:p.editor??old.editor,music:{...old.music,volume:p.music?.volume??old.music.volume,duck:p.music?.duck??old.music.duck},cloud:{...old.cloud,autoStart:p.cloud?.autoStart??old.cloud.autoStart}});return publicSettings();});
  route('settings/export',()=>({ini:stringify(current())}));
  route('settings/import',p=>{if(active)throw Error('작업을 중단한 뒤 설정을 불러오세요.');const incoming=parse(String(p.ini??p.text??'')),old=current();
    // Browser INI cannot grant arbitrary server filesystem access.
    const safeFiles=new Set([old.background.file,old.music.file,...old.actors.map(a=>a.file)]);
    incoming.background.file=safeFiles.has(incoming.background.file)?incoming.background.file:'';incoming.music.file=safeFiles.has(incoming.music.file)?incoming.music.file:'';
    incoming.actors=incoming.actors.map(a=>({...a,file:safeFiles.has(a.file)?a.file:''}));write(incoming);return publicSettings();});
  route('cloud/check',()=>cloud.health({endpoint:cloudEndpoint,token:cloudToken,internal:true}));
  route('cloud/save',()=>({managed:true,configured:true,autoStart:current().cloud.autoStart}));
  route('cloud/clear-cache',()=>{if(active)throw Error('작업을 중단한 뒤 캐시를 삭제하세요.');fs.rmSync(cacheDir,{recursive:true,force:true});return {ok:true};});
  function mutable(){if(active)throw Error('작업을 중단한 뒤 미디어를 변경하세요.');}
  function indexOf(input){const index=Number(input.index);if(!Number.isInteger(index)||index<0||index>=current().actors.length)throw Error('이모지를 선택하세요.');return index;}
  route('actor/add',()=>{mutable();const p=current();if(p.actors.length>=5)throw Error('최대 5개 이모지를 지원합니다.');p.actors.push({file:'',size:200,x:.08+(p.actors.length-1)*.16,y:.78});write(p);return actors();});
  route('actor/remove',input=>{mutable();const p=current(),index=indexOf(input);if(p.actors.length===1||index!==p.actors.length-1)throw Error('마지막 이모지부터 삭제하세요. 기본 이모지 한 개는 유지됩니다.');p.actors.pop();write(p);return actors();});
  route('actor/update',input=>{mutable();const p=current(),index=indexOf(input);for(const key of ['size','x','y'])if(Object.hasOwn(input,key))p.actors[index][key]=input[key];write(p);return actors();});
  route('avatar/reset',input=>{mutable();const p=current();p.actors[indexOf(input)].file='';write(p);return actors();});
  route('music/remove',()=>{mutable();const p=current();p.music.file='';p.music.name='';write(p);return p.music;});
  app.post('/api/upload/:type',async(req,res,next)=>{const files=[];try{mutable();if(!['video','music','avatar','photos'].includes(req.params.type))return res.status(404).end();const images=['avatar','photos'].includes(req.params.type),dir=path.join(dataDir,'uploads');fs.mkdirSync(dir,{recursive:true});
    const uploads=[];await new Promise((resolve,reject)=>{const parser=busboy({headers:req.headers,limits:{files:req.params.type==='photos'?10:1,fileSize:images?20*1024*1024:1024*1024*1024}});parser.on('file',(_name,stream,info)=>{const extension=path.extname(info.filename).toLowerCase();if(!/^[.][a-z0-9]{1,8}$/.test(extension)){stream.resume();reject(Error('지원하는 파일 확장자를 선택해 주세요.'));return;}const file=path.join(dir,crypto.randomUUID()+extension);files.push(file);stream.on('limit',()=>reject(Error('파일 용량 제한을 초과했습니다.')));uploads.push(pipeline(stream,fs.createWriteStream(file)).then(()=>({file,name:path.basename(info.filename)})));});parser.on('filesLimit',()=>reject(Error('한 번에 선택할 수 있는 파일 수를 초과했습니다.')));parser.on('error',reject);parser.on('finish',resolve);req.pipe(parser);});
    const imported=await Promise.all(uploads);if(!imported.length)throw Error('가져올 파일을 선택하세요.');let result;
    if(req.params.type==='avatar'){const photo=await importPhoto(imported[0].file,path.join(dataDir,'avatars')),p=current();const index=indexOf({index:req.query.index??0});p.actors[index].file=photo.file;write(p);result=actors();}
    if(req.params.type==='photos'){result=[];for(const f of imported){const photo=await importPhoto(f.file,path.join(dataDir,'photos'));result.push({id:photo.id,name:f.name,url:expose(photo.file)});}}
    if(req.params.type==='music'){const music=await importMusic(imported[0].file,path.join(dataDir,'music')),p=current();p.music={...p.music,...music,name:imported[0].name};write(p);result=p.music;}
    if(req.params.type==='video'){const file=path.join(dataDir,'background-'+Date.now()+'.mp4');await convert(['-i',imported[0].file,'-map','0:v:0','-an','-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart',file]);const p=current();p.background.file=file;write(p);result={name:imported[0].name,url:expose(file)};}
    res.json(result);
  }catch(e){next(e);}finally{for(const file of files)fs.rmSync(file,{force:true});}});
  function startRender(input,preview){if(active)throw Error('현재 작업이 진행 중입니다.');const o=options(input),id=crypto.randomUUID().replaceAll('-',''),file=path.join(outputDir,`EmojiStudio-${Date.now()}-${id.slice(0,6)}.${preview||o.preset==='transparent'?'webm':'mp4'}`),p=current();
    const job={id,status:'running',progress:0};jobs.set(id,job);active=id;
    const worker=workerFactory({...o,preset:preview?'transparent':o.preset,previewPreset:preview?o.preset:undefined,output:file,
      background:p.background.file||path.join(__dirname,'assets','background.mp4'),actors:p.actors.map((a,index)=>({...a,index,file:actorFile(a)})),
      avatarFile:actorFile(p.actors[0]),musicFile:p.music.file,musicVolume:o.musicVolume??p.music.volume,musicDuck:o.musicDuck??p.music.duck,
      lipsyncMode:renderMode,cloud:{endpoint:cloudEndpoint,token:cloudToken,internal:true},cloudCacheDir:cacheDir});job.worker=worker;
    worker.on('message',m=>{if(m.type==='progress'){job.progress=m.percent;job.message=m.message;job.detail=m.detail;emit(m);}if(m.type==='done'){job.status='completed';job.result={...m.result,output:path.basename(file),url:expose(file)};}if(m.type==='error'){job.status='failed';job.error=m.message;}});
    worker.on('error',e=>{job.status='failed';job.error=e.message;});worker.on('exit',()=>{if(active===id)active=null;delete job.worker;if(job.status==='running'){job.status='failed';job.error='작업 엔진이 종료되었습니다. 완료된 구간부터 재개하세요.';}fs.writeFileSync(path.join(outputDir,id+'.json'),JSON.stringify({id,status:job.status,result:job.result,error:job.error}));});return {id};}
  route('render/preview',p=>startRender(p,true));route('render/export',p=>startRender(p,false));route('render/cancel',()=>{if(active)jobs.get(active)?.worker?.postMessage('cancel');return {ok:true};});
  app.get('/api/jobs/:id',(req,res)=>{const job=jobs.get(req.params.id);if(!job)return res.status(404).json({error:'이 세션의 작업이 아닙니다. 완료된 캐시부터 다시 재개하세요.'});const {worker,...publicJob}=job;res.json(publicJob);});
  route('photos/generate',async p=>{throw Error('사진 대본용 무료 모델 연결은 아직 검증 중입니다. 현재는 초안을 직접 입력할 수 있습니다.');});
  app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'ui','index.html')));
  app.use('/ui',express.static(path.join(__dirname,'ui'),{index:false}));
  app.use('/assets',express.static(path.join(__dirname,'assets'),{index:false}));
  app.get('/story.js',(req,res)=>res.sendFile(path.join(__dirname,'story.js')));
  // Relative UI scripts resolve from /; serve only whitelisted frontend files.
  for(const file of ['style.css','classic.css','renderer.js','studio-extra.js','web-bridge.js','subtitles.js'])app.get('/'+file,(req,res)=>res.sendFile(path.join(__dirname,'ui',file)));
  app.use((error,req,res,_next)=>{if(!res.headersSent)res.status(400).json({error:error.message||'요청을 처리하지 못했습니다.'});});
  return {app,close(){for(const client of clients)client.end();for(const job of jobs.values())job.worker?.postMessage('cancel');},jobs,store};
}
function loginPage(){return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>3D 프로그램 연결</title><body style="font:16px sans-serif;max-width:420px;margin:10vh auto;padding:20px"><h1>3D 프로그램</h1><p>본인의 무료 Colab 노트북에 표시된 연결 코드를 입력하세요.</p><form id="login"><input id="code" type="password" autocomplete="off" required style="width:90%;padding:10px"><button style="padding:10px;margin-top:12px">연결</button></form><p id="error"></p><script>const c=document.getElementById('code'),f=document.getElementById('login');c.value=new URLSearchParams(location.hash.slice(1)).get('code')||'';history.replaceState(null,'',location.pathname);f.onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:c.value})});if(r.ok)location.reload();else document.getElementById('error').textContent='연결 코드를 확인하세요.'};</script></body></html>`;}
if(require.main===module){const token=process.env.SIHU_SESSION_TOKEN;if(!token)throw Error('Set SIHU_SESSION_TOKEN before starting the private web editor');const server=createWebApp({dataDir:process.env.SIHU_DATA_DIR||path.join(__dirname,'output','web-data'),sessionToken:token,cloudEndpoint:process.env.SIHU_CLOUD_ENDPOINT||'http://127.0.0.1:7860',cloudToken:process.env.SIHU_CLOUD_TOKEN||token});server.app.listen(Number(process.env.PORT)||3000,'127.0.0.1',()=>console.log('Private web editor listening on port '+(process.env.PORT||3000)));}
module.exports={createWebApp};
