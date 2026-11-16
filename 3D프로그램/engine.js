'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {PNG} = require('pngjs');
const crypto=require('node:crypto');
const cloud=require('./cloud-lipsync');

const PRESETS = {
  youtube: {width: 1920, height: 1080, label: '유튜브 · 1920 × 1080'},
  shorts: {width: 1080, height: 1920, label: '유튜브 쇼츠 · 1080 × 1920'},
  tiktok: {width: 1080, height: 1920, label: '틱톡 / 릴스 · 1080 × 1920'},
  transparent: {width: 720, height: 720, label: '이모지만 · 투명 WebM'},
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, Number(x)));
function finite(x, fallback) {return Number.isFinite(Number(x)) ? Number(x) : fallback;}
function keyframes(list = []) {
  const sorted = list.slice(0, 100).map(k => ({
    time: clamp(finite(k.time, 0), 0, 3600), zoom: clamp(finite(k.zoom, 1), 1, 3),
    x: clamp(finite(k.x, 50), 0, 100), y: clamp(finite(k.y, 50), 0, 100),
  })).sort((a,b) => a.time - b.time);
  return sorted.filter((k,i) => i === sorted.length-1 || sorted[i+1].time !== k.time);
}
function interpolate(list, t, field, fallback) {
  if (!list.length) return fallback;
  if (t <= list[0].time) return list[0][field];
  for(let i = 1; i < list.length; i++) {
    if(t <= list[i].time) {
      const a = list[i-1], b = list[i], p = (t-a.time)/(b.time-a.time);
      return a[field] + (b[field]-a[field])*p;
    }
  }
  return list.at(-1)[field];
}
function expression(list, field, fallback) {
  if(!list.length) return String(fallback);
  let expr = String(list.at(-1)[field]);
  for(let i=list.length-1; i>0; i--) {
    const a=list[i-1],b=list[i];
    expr=`if(lt(on/30,${b.time}),${a[field]}+(${b[field]-a[field]})*max(0,on/30-${a.time})/${b.time-a.time},${expr})`;
  }
  return expr;
}
function options(input) {
  if(!input || typeof input.text !== 'string' || !input.text.trim()) throw Error('대본을 입력해 주세요.');
  if(input.text.length > 3000) throw Error('한 번에 최대 3,000자까지 입력할 수 있습니다.');
  const preset = Object.hasOwn(PRESETS, input.preset) ? input.preset : 'youtube';
  return {...input, text:input.text.trim(), preset,
    lipsyncMode:input.lipsyncMode==='local-basic'?'local-basic':'cloud',
    voiceSpeed:clamp(finite(input.voiceSpeed,1),.5,2), pitch:clamp(finite(input.pitch,3),0,6),
    videoSpeed:clamp(finite(input.videoSpeed,1),.25,3),
    size:Math.round(clamp(finite(input.size,200),80,600)),
    margin:Math.round(clamp(finite(input.margin,24),0,200)),
    opacity:clamp(finite(input.opacity,1),.1,1),
    position:['br','bl','tr','tl'].includes(input.position)?input.position:'br',
    codec:input.codec==='av1'?'av1':'h264', keyframes:keyframes(input.keyframes),
  };
}
function segments(samples,rate,maxSeconds=55){
  const total=samples.length/rate,result=[];let start=0;
  while(start<total-.00001){
    let end=Math.min(total,start+maxSeconds);
    // Split near a quiet 100ms window, without exceeding the server's 60s limit.
    if(end<total){let quiet=Infinity,best=end;for(let t=end-2;t<end;t+=.1){if(t<=start+1)continue;let sum=0;const a=Math.floor(t*rate),b=Math.min(samples.length,a+Math.floor(.1*rate));for(let i=a;i<b;i++)sum+=samples[i]**2;if(sum<quiet){quiet=sum;best=t+.05;}}end=Math.min(end,best);}
    result.push({start,duration:end-start});start=end;
  }
  return result;
}
function avatarFile(o,root=__dirname){return o.avatarFile||path.join(root,'assets','avatar-closed.png');}
async function normalizeAvatar(source,output,root=__dirname){
  const temporary=output+'.tmp.png';let input=source;
  try{
    if(path.extname(source).toLowerCase()==='.svg'){
      const {Resvg}=require('@resvg/resvg-js'),svg=fs.readFileSync(source),original=new Resvg(svg);
      if(!(original.width>0&&original.height>0))throw Error('SVG의 이미지 크기를 확인해 주세요.');
      const raster=new Resvg(svg,{fitTo:{mode:'zoom',value:Math.min(720/original.width,720/original.height)}});
      input=output+'.svg-source.png';fs.writeFileSync(input,raster.render().asPng());
    }
    await run(['-i',input,'-vf','scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba','-frames:v','1',temporary],{root});
    const decoded=PNG.sync.read(fs.readFileSync(temporary));if(decoded.width!==720||decoded.height!==720)throw Error('이모지 이미지를 읽지 못했습니다.');
    fs.renameSync(temporary,output);
  }finally{fs.rmSync(temporary,{force:true});if(input!==source)fs.rmSync(input,{force:true});}
}
async function restoreCloudAlpha(video,output,duration,root=__dirname,signal,avatar){
  await run(['-i',video,'-loop','1','-i',avatar||path.join(root,'assets','avatar-closed.png'),
    '-filter_complex_threads','2','-filter_complex',
    '[0:v]scale=720:720,fps=30,tpad=stop_mode=clone:stop_duration=0.6,format=rgb24[v];[1:v]format=rgba,alphaextract[a];[v][a]alphamerge,format=yuva420p[out]',
    '-map','[out]','-an','-t',String(duration),'-c:v','libvpx-vp9','-pix_fmt','yuva420p','-auto-alt-ref','0',
    '-b:v','0','-crf','26','-deadline','realtime','-cpu-used','6','-row-mt','1',output],{signal,root});
}
function fiveGroups(samples,rate){
  return Array.from({length:5},(_,group)=>{const a=Math.floor(samples.length*group/5),b=Math.floor(samples.length*(group+1)/5);
    return segments(samples.subarray(a,b),rate).map(piece=>({...piece,start:piece.start+a/rate,group}));}).flat();
}
async function preciseAvatar(audio,o,dir,root,signal,progress,cache){
  const pieces=o.storyUnit?segments(audio.samples,audio.sampleRate).map(p=>({...p,group:0})):fiveGroups(audio.samples,audio.sampleRate),parts=[];
  let verified=false,previous=[];
  if(cache){try{previous=JSON.parse(fs.readFileSync(path.join(cache,'work.json'),'utf8')).completed||[];}catch{}}
  const persisted=new Map(previous.map(p=>[p.index,p]));
  const done=()=>{if(cache)fs.writeFileSync(path.join(cache,'work.json'),JSON.stringify({version:2,completed:[...persisted.values()]}));};
  const notify=(i,pct,status,message,extra={})=>{
    const piece=pieces[i],inGroup=pieces.filter(p=>p.group===piece.group),before=inGroup.filter(p=>p.start<piece.start).reduce((s,p)=>s+p.duration,0),length=inGroup.reduce((s,p)=>s+p.duration,0);
    const groupPercent=Math.min(100,(before+piece.duration*pct/100)/length*100);
    progress(28+38*(i+pct/100)/pieces.length,message,{group:piece.group,groupPercent,status,...extra});
  };
  for(let i=0;i<pieces.length;i++){
    signal?.throwIfAborted();const piece=pieces[i],source=path.join(dir,`source-${i}.mp4`),wav=path.join(dir,`speech-${i}.wav`),remote=path.join(dir,`cloud-${i}.mp4`),part=path.join(dir,`part-${i}.mp4`);
    const retained=cache?path.join(cache,`part-${i}.mp4`):null;
    if(retained&&persisted.has(i)&&fs.existsSync(retained)&&fs.statSync(retained).size>0){parts.push(retained);notify(i,100,'completed',`${piece.group+1}/5구간 · 저장된 결과를 복원했어요`,{completedAt:persisted.get(i).completedAt});continue;}
    try{
    notify(i,0,'preparing',`${piece.group+1}/5구간 · 입력 파일을 준비하고 있어요`);
    if(!verified){await cloud.health(o.cloud,{signal});verified=true;}
    const seconds=Math.max(1,piece.duration);
    await run(['-i',audio.wav,'-af',`atrim=start=${piece.start}:end=${piece.start+piece.duration},asetpts=PTS-STARTPTS,apad`,
      '-t',String(seconds),wav],{root,signal});
    // Only the avatar and speech leave the PC; the background stays local.
    await run(['-f','lavfi','-i','color=c=white:s=720x720:r=25','-loop','1','-i',avatarFile(o,root),
      '-filter_complex','[0:v][1:v]overlay=shortest=1,format=yuv420p[out]','-map','[out]','-t',String(seconds),
      '-c:v','libx264','-preset','ultrafast','-crf','18','-an',source],{root,signal});
    await cloud.generate(o.cloud,{video:source,audio:wav,output:remote,signal,
      progress:(message,state)=>notify(i,state?.percent==null?15:15+.7*state.percent,state?.status||'uploading',`${piece.group+1}/5구간 · ${message}`,{generationPercent:state?.percent??null})});
    // Decode/normalize each server result, rejecting invalid output before caching.
    await run(['-i',remote,'-vf','scale=720:720,fps=30,tpad=stop_mode=clone:stop_duration=1','-t',String(piece.duration),
      '-an','-c:v','libx264','-preset','fast','-crf','18',part],{root,signal});
    notify(i,95,'saving',`${piece.group+1}/5구간 · PC에 결과를 보관하고 있어요`);
    if(retained){fs.copyFileSync(part,retained+'.partial');fs.renameSync(retained+'.partial',retained);persisted.set(i,{index:i,group:piece.group,completedAt:Date.now()});done();parts.push(retained);}else parts.push(part);
    notify(i,100,'completed',`${piece.group+1}/5구간 · 처리 단위를 저장했어요`,{completedAt:Date.now()});
    }catch(e){notify(i,0,e.name==='AbortError'?'paused':'waiting',e.name==='AbortError'?'생성을 일시 중단했어요. 완료된 결과는 보관합니다.':'연결 대기 · 완료된 결과는 보관됩니다. 새 세션을 연결하고 재개하세요.',{pausedAt:Date.now()});throw e;}
  }
  const concat=path.join(dir,'parts.txt');fs.writeFileSync(concat,parts.map(p=>`file '${p.replaceAll('\\','/')}'`).join('\n'));
  const joined=path.join(dir,'cloud-combined.mp4');
  await run(['-f','concat','-safe','0','-i',concat,'-c','copy',joined],{root,signal});
  progress(68,'정밀 립싱크 영상의 투명 배경을 복원하고 있어요');
  const target=path.join(dir,'avatar-precise.webm'),duration=audio.samples.length/audio.sampleRate+.5;
  await restoreCloudAlpha(joined,target,duration,root,signal,avatarFile(o,root));return {target,duration};
}
function cacheId(o,root){return crypto.createHash('sha256').update(JSON.stringify({text:o.text,speed:o.voiceSpeed,pitch:o.pitch,unit:!!o.storyUnit,version:'free-musetalk15-five-groups-v2'})).update(fs.readFileSync(avatarFile(o,root))).digest('hex');}
async function assetsForRender(o,dir,root,signal,progress){
  if(o.lipsyncMode==='local-basic'){const audio=await synthesize(o,dir,root,signal,progress);return {audio,avatar:await animate(audio,o,dir,root,signal,progress)};}
  const cache=o.cloudCacheDir?path.join(o.cloudCacheDir,cacheId(o,root)):null;
  if(cache){try{const meta=JSON.parse(fs.readFileSync(path.join(cache,'metadata.json'),'utf8'));if(Number.isFinite(meta.duration)&&meta.duration>0&&fs.statSync(path.join(cache,'voice.wav')).size>0&&fs.statSync(path.join(cache,'avatar.webm')).size>0){for(let group=0;group<5;group++)progress(65,'이전에 생성한 정밀 립싱크를 재사용하고 있어요',{group,groupPercent:100,status:'completed'});return {audio:{wav:path.join(cache,'voice.wav')},avatar:{target:path.join(cache,'avatar.webm'),duration:meta.duration}};}}catch{}}
  cloud.connection(o.cloud);
  let audio;
  if(cache){fs.mkdirSync(cache,{recursive:true});try{const bytes=fs.readFileSync(path.join(cache,'samples.raw'));if(fs.existsSync(path.join(cache,'voice.wav'))&&bytes.length>0&&bytes.length%4===0)audio={wav:path.join(cache,'voice.wav'),samples:new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),sampleRate:24000};}catch{}}
  if(!audio){audio=await synthesize(o,dir,root,signal,progress);if(cache){fs.copyFileSync(audio.wav,path.join(cache,'voice.wav'));fs.writeFileSync(path.join(cache,'samples.raw'),Buffer.from(audio.samples.buffer,audio.samples.byteOffset,audio.samples.byteLength));audio.wav=path.join(cache,'voice.wav');}}
  const avatar=await preciseAvatar(audio,o,dir,root,signal,progress,cache);
  if(cache){fs.mkdirSync(cache,{recursive:true});fs.copyFileSync(avatar.target,path.join(cache,'avatar.webm'));fs.writeFileSync(path.join(cache,'metadata.json'),JSON.stringify({duration:avatar.duration,engine:'musetalk-1.5'}));}
  return {audio,avatar};
}
function ffmpegPath(root = __dirname) {
  return process.env.EMOJI_FFMPEG || (process.platform==='win32' ? path.join(root,'vendor','ffmpeg.exe') : 'ffmpeg');
}
function run(args, {signal, root, onProgress}={}) {
  return new Promise((resolve,reject) => {
    const p=spawn(ffmpegPath(root), ['-hide_banner','-loglevel','error','-y',...args],
      {windowsHide:true,signal,stdio:['ignore','ignore','pipe']});
    let error='';p.stderr.on('data',b=>{error=(error+b).slice(-6000);});
    p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error(error||'영상 인코딩에 실패했습니다.')));
  });
}
function koreanNumbers(text) {
  const digits='영일이삼사오육칠팔구';
  return text.replace(/\d[\d -]{2,}\d/g, s=>s.replace(/\d/g,c=>digits[Number(c)]).replace(/-/g,', '));
}
async function synthesize(o, dir, root, signal, progress) {
  progress(3,'한국어 목소리를 준비하고 있어요');
  const sherpa=require('sherpa-onnx-node');
  const model=path.join(root,'vendor','korean');
  const tts=new sherpa.OfflineTts({model:{vits:{
    model:path.join(model,'ko_KO-kss_low.onnx'),tokens:path.join(model,'tokens.txt'),
    dataDir:path.join(model,'espeak-ng-data'),noiseScale:.5,noiseScaleW:.6,lengthScale:1,
  },numThreads:2,debug:0,provider:'cpu'},maxNumSentences:1});
  // Synthesize sentences separately so cancellation can be handled between chunks.
  const parts=koreanNumbers(o.text).match(/[^.!?\n]+[.!?]?/g)||[o.text];
  const samples=[];let sampleRate=0,total=0;
  for(let i=0;i<parts.length;i++) {
    signal?.throwIfAborted();
    const a=tts.generate({text:parts[i],sid:0,speed:o.voiceSpeed});
    samples.push(a.samples);sampleRate=a.sampleRate;total+=a.samples.length;
    progress(5+20*(i+1)/parts.length,'대본을 읽고 있어요');
    await new Promise(r=>setImmediate(r));
  }
  if(!total) throw Error('음성을 만들지 못했습니다. 한글 대본을 확인해 주세요.');
  const all=new Float32Array(total);let offset=0;
  for(const s of samples){all.set(s,offset);offset+=s.length;}
  const raw=path.join(dir,'voice.raw');fs.writeFileSync(raw,Buffer.from(all.buffer));
  const wav=path.join(dir,'voice.wav'), ratio=2**(o.pitch/12);
  await run(['-f','f32le','-ar',String(sampleRate),'-ac','1','-i',raw,
    '-af',`asetrate=${sampleRate}*${ratio},aresample=48000,atempo=${1/ratio},loudnorm=I=-16:TP=-1.5:LRA=11`,
    '-ar','48000','-ac','1',wav],{signal,root});
  const pcm=path.join(dir,'voice-final.raw');
  await run(['-i',wav,'-f','f32le','-ac','1','-ar','24000',pcm],{signal,root});
  const bytes=fs.readFileSync(pcm);
  return {wav, samples:new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),sampleRate:24000};
}
function envelope(samples,rate,fps=30) {
  const count=Math.ceil(samples.length/rate*fps), levels=[];
  for(let n=0;n<count;n++){
    const start=Math.floor(n*rate/fps),end=Math.min(samples.length,Math.floor((n+1)*rate/fps));
    let sum=0;for(let i=start;i<end;i++)sum+=samples[i]*samples[i];
    levels.push(Math.sqrt(sum/Math.max(1,end-start)));
  }
  const nonzero=levels.filter(x=>x>.005).sort((a,b)=>a-b);
  const peak=nonzero[Math.floor(nonzero.length*.85)]||.1;
  return levels.map((v,i)=>clamp((v/peak-.06)*1.15,0,1));
}
async function animate(audio,o,dir,root,signal,progress) {
  const closed=PNG.sync.read(fs.readFileSync(path.join(root,'assets','avatar-closed.png')));
  const open=PNG.sync.read(fs.readFileSync(path.join(root,'assets','avatar-open.png')));
  const levels=envelope(audio.samples,audio.sampleRate), frames=levels.length+15;
  const target=path.join(dir,'avatar.webm');
  const p=spawn(ffmpegPath(root),['-hide_banner','-loglevel','error','-y',
    '-f','rawvideo','-pixel_format','rgba','-video_size','720x720','-framerate','30','-i','pipe:0',
    '-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-auto-alt-ref','0','-b:v','0','-crf','26',
    '-deadline','realtime','-cpu-used','6','-row-mt','1',target],
    {windowsHide:true,signal,stdio:['pipe','ignore','pipe']});
  let err='';p.stderr.on('data',b=>err=(err+b).slice(-4000));
  const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',c=>c===0?resolve():reject(Error(err||'이모지 렌더링 실패')));});
  // Attach handler immediately: a failed encoder must not become an unhandled rejection.
  done.catch(()=>{});
  p.stdin.on('error',()=>{});
  const base=Buffer.from(closed.data), w=720, h=720;
  const region=[];
  for(let y=389;y<491;y++)for(let x=285;x<460;x++){
    const d=((x-374)/88)**2+((y-440)/52)**2;
    if(d<1)region.push({i:(y*w+x)*4,mask:clamp((1-d)*5,0,1)});
  }
  try {
    let smooth=0;
    for(let n=0;n<frames;n++){
      signal?.throwIfAborted();
      const v=levels[n]||0;smooth=v>.01?.35*smooth+.65*v:.15*smooth;
      const frame=Buffer.from(base);
      for(const {i,mask} of region){const a=smooth*mask;for(let c=0;c<3;c++)frame[i+c]=base[i+c]*(1-a)+open.data[i+c]*a;}
      if(!p.stdin.write(frame))await once(p.stdin,'drain');
      if(n%15===0){progress(28+42*n/frames,'입 움직임을 만들고 있어요');await new Promise(r=>setImmediate(r));}
    }
    p.stdin.end();await done;
  }catch(e){p.kill();await done.catch(()=>{});throw e;}
  return {target,duration:frames/30};
}
async function render(input,{root=__dirname,signal,progress=()=>{}}={}){
  const o=options(input);
  if(!o.output || !path.isAbsolute(o.output))throw Error('저장 위치를 선택해 주세요.');
  if(Array.isArray(o.actors)&&o.actors.length)return require('./scene').renderScene(o,{root,signal,progress,assetsForRender,run,expression,PRESETS});
  if(o.preset!=='transparent' && (!o.background || !fs.existsSync(o.background)))throw Error('배경 영상을 불러와 주세요.');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sihu-emoji-'));
  // Encode to a sibling temporary file, leaving an existing destination intact on failure.
  const pending=o.output+`.${Date.now()}.partial`+(o.preset==='transparent'?'.webm':'.mp4');
  try{
    const {audio,avatar}=await assetsForRender(o,dir,root,signal,progress);
    progress(74,'최종 영상을 저장하고 있어요');
    if(o.preset==='transparent'){
      const video=o.mirror||o.opacity!==1?['-vf',`${o.mirror?'hflip,':''}format=rgba,colorchannelmixer=aa=${o.opacity}`,'-c:v','libvpx-vp9','-pix_fmt','yuva420p','-auto-alt-ref','0','-crf','26','-b:v','0','-deadline','realtime','-cpu-used','6']:['-c:v','copy'];
      await run(['-c:v','libvpx-vp9','-i',avatar.target,'-i',audio.wav,'-map','0:v','-map','1:a',
        ...video,'-c:a','libopus','-b:a','128k','-af','apad','-t',String(avatar.duration),pending],{signal,root});
    }else{
      const {width:W,height:H}=PRESETS[o.preset];
      const zoom=expression(o.keyframes,'zoom',1),x=expression(o.keyframes,'x',50),y=expression(o.keyframes,'y',50);
      const ox=o.position.endsWith('r')?`W-w-${o.margin}`:String(o.margin);
      const oy=o.position.startsWith('b')?`H-h-${o.margin}`:String(o.margin);
      const filter=`[0:v]setpts=(PTS-STARTPTS)/${o.videoSpeed},fps=30,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,zoompan=z='${zoom}':x='(iw-iw/zoom)*(${x})/100':y='(ih-ih/zoom)*(${y})/100':d=1:s=${W}x${H}:fps=30[bg];[1:v]scale=${o.size}:${o.size},format=rgba${o.mirror?',hflip':''},colorchannelmixer=aa=${o.opacity}[av];[bg][av]overlay=x=${ox}:y=${oy}:shortest=1,format=yuv420p[out]`;
      const codec=o.codec==='av1'?['-c:v','libsvtav1','-preset','10','-crf','30']:['-c:v','libx264','-preset','fast','-crf','19','-profile:v','high','-level:v','4.1'];
      await run(['-stream_loop','-1','-i',o.background,'-c:v','libvpx-vp9','-i',avatar.target,'-i',audio.wav,
        '-filter_complex_threads','2','-filter_complex',filter,'-map','[out]','-map','2:a',...codec,
        '-threads','2','-c:a','aac','-b:a','192k','-ar','48000','-af','apad','-t',String(avatar.duration),
        '-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-movflags','+faststart',pending],{signal,root});
    }
    signal?.throwIfAborted();
    fs.renameSync(pending,o.output);progress(100,'저장 완료');
    return {output:o.output,duration:avatar.duration,preset:o.preset};
  }finally{fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(pending,{force:true});}
}
module.exports={render,options,keyframes,interpolate,expression,envelope,PRESETS,koreanNumbers,segments,fiveGroups,restoreCloudAlpha,normalizeAvatar};
