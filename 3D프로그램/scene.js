'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {parseDialogue,schedule}=require('./story');
const {videoFilter,soundFiles}=require('./effects');
const {makeAss,normalizeCues}=require('./subtitles');
function placement(actor,index,W,H,options){const size=Math.round(Math.max(80,Math.min(Math.min(W,H),Number(actor.size)||options.size||200)));
  const p=options.position||'br';const x=actor.x==null?(p.endsWith('r')?W-size-24:24):Math.round(Number(actor.x)*W);
  const y=actor.y==null?(p.startsWith('b')?H-size-24:24):Math.round(Number(actor.y)*H);
  return {size,x:Math.max(0,Math.min(W-size,x)),y:Math.max(0,Math.min(H-size,y))};}
async function renderScene(o,{root,signal,progress,assetsForRender,run,expression,PRESETS}){
  const actors=o.actors.slice(0,5),overrides=Array.from({length:60},(_,i)=>({start:o.lineStarts?.[i],emotion:o.lineEmotions?.[i]}));
  const lines=parseDialogue(o.text,overrides);
  if(lines.some(l=>!actors[l.actor]))throw Error('대사에서 사용하는 이모지를 먼저 추가해 주세요.');
  const targetPreset=o.previewPreset||o.preset;const dimensions=targetPreset==='transparent'?(actors.length===1?{width:720,height:720}:{width:1920,height:1080}):PRESETS[targetPreset];
  const {width:W,height:H}=dimensions||PRESETS.youtube,transparent=o.preset==='transparent';
  if(!transparent&&(!o.background||!fs.existsSync(o.background)))throw Error('배경 영상을 가져와 주세요.');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sihu-scene-')),pending=o.output+`.${Date.now()}.partial.${transparent?'webm':'mp4'}`;
  const clips=[],durations=[];
  function totalProgress(fraction,message,detail={}){const f=Math.max(0,Math.min(1,fraction));for(let group=0;group<5;group++){const percent=Math.max(0,Math.min(100,(f*5-group)*100));if(percent>0||group===Math.min(4,Math.floor(f*5)))progress(5+65*f,message,{...detail,group,groupPercent:percent,status:percent===100?'completed':detail.status==='waiting'||detail.status==='paused'?detail.status:'running'});}}
  try{
    for(let i=0;i<lines.length;i++){
      signal?.throwIfAborted();const sub=path.join(dir,'speech-'+i);fs.mkdirSync(sub);
      const clip=await assetsForRender({...o,text:lines[i].text,avatarFile:actors[lines[i].actor].file,storyUnit:true},sub,root,signal,(p,message,detail)=>totalProgress((i+Math.min(1,p/70))/lines.length,`대사 ${i+1}/${lines.length} · ${message}`,detail));
      clips.push(clip);durations.push(Math.max(.1,clip.avatar.duration-.5));totalProgress((i+1)/lines.length,`대사 ${i+1}/${lines.length} · 저장 완료`);
    }
    const captions=normalizeCues(o.subtitles).map(c=>({...c,start:c.start/o.videoSpeed,end:c.end/o.videoSpeed}));
    const cues=schedule(lines,durations),duration=Math.max(...cues.map(c=>c.end),...captions.map(c=>c.end))+.5;
    progress(74,'모든 구간 완료 · 대사와 이모지를 합치고 있어요',{schedule:cues});
    const args=[];let input=0;
    if(transparent)args.push('-f','lavfi','-i',`color=c=black@0.0:s=${W}x${H}:r=30,format=rgba`);
    else args.push('-stream_loop','-1','-i',o.background);input++;
    const staticIds=actors.map(a=>{const id=input++;args.push('-loop','1','-i',a.file);return id;});
    const clipIds=clips.map(c=>{const video=input++,audio=input++;args.push('-c:v','libvpx-vp9','-i',c.avatar.target,'-i',c.audio.wav);return {video,audio};});
    const music=o.musicFile&&fs.existsSync(o.musicFile)?input++:null;if(music!==null)args.push('-stream_loop','-1','-i',o.musicFile);
    const effects=await soundFiles(o.audioEffects,dir),effectIds=effects.map(e=>{const id=input++;args.push('-i',e.file);return {id,start:e.start};});
    const filters=[];
    if(transparent)filters.push('[0:v]format=rgba[v0]');
    else {const zoom=expression(o.keyframes,'zoom',1),x=expression(o.keyframes,'x',50),y=expression(o.keyframes,'y',50);
      filters.push(`[0:v]setpts=(PTS-STARTPTS)/${o.videoSpeed},fps=30,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,zoompan=z='${zoom}':x='(iw-iw/zoom)*(${x})/100':y='(ih-ih/zoom)*(${y})/100':d=1:s=${W}x${H}:fps=30,${videoFilter(o.videoEffect,o.effectStrength??1,duration)},format=rgba[v0]`);}
    let layer=0;
    for(let i=0;i<actors.length;i++){const place=placement(actors[i],i,W,H,o);filters.push(`[${staticIds[i]}:v]scale=${place.size}:${place.size},format=rgba${o.mirror?',hflip':''},colorchannelmixer=aa=${o.opacity}[still${i}]`);filters.push(`[v${layer}][still${i}]overlay=x=${place.x}:y=${place.y}:format=auto[v${++layer}]`);}
    for(let i=0;i<cues.length;i++){const cue=cues[i],place=placement(actors[cue.actor],cue.actor,W,H,o);filters.push(`[${clipIds[i].video}:v]trim=duration=${cue.duration},setpts=PTS-STARTPTS+${cue.start}/TB,scale=${place.size}:${place.size},format=rgba${o.mirror?',hflip':''},colorchannelmixer=aa=${o.opacity}[speak${i}]`);filters.push(`[v${layer}][speak${i}]overlay=x=${place.x}:y=${place.y}:format=auto:eof_action=pass:repeatlast=0:enable='between(t,${cue.start},${cue.end})'[v${++layer}]`);}
    let videoLabel=`v${layer}`;
    if(captions.length){const ass=path.join(dir,'subtitles.ass');fs.writeFileSync(ass,makeAss(captions,o.subtitleStyle,W,H));filters.push(`[${videoLabel}]subtitles=filename='${ass.replaceAll('\\','/').replaceAll(':','\\:')}'[captioned]`);videoLabel='captioned';}
    filters.push(`[${videoLabel}]format=${transparent?'yuva420p':'yuv420p'}[video]`);
    const audioLabels=[];
    for(let i=0;i<cues.length;i++){filters.push(`[${clipIds[i].audio}:a]asetpts=PTS-STARTPTS,adelay=${Math.round(cues[i].start*1000)}:all=1[a${i}]`);audioLabels.push(`[a${i}]`);}
    filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:duration=longest,apad[voices]`);
    let mix='voices';
    if(music!==null){const volume=Math.max(0,Math.min(1,Number(o.musicVolume)||0));filters.push(`[${music}:a]volume=${volume}[music]`);if(o.musicDuck!==false){filters.push('[voices]asplit=2[voiceMain][voiceSide]');filters.push('[music][voiceSide]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=600[ducked]');filters.push('[voiceMain][ducked]amix=inputs=2:duration=first:normalize=0[mixed]');}else filters.push('[voices][music]amix=inputs=2:duration=first:normalize=0[mixed]');mix='mixed';}
    const sfxLabels=[];for(let i=0;i<effectIds.length;i++){const e=effectIds[i];filters.push(`[${e.id}:a]adelay=${Math.round(e.start*1000)}:all=1[fx${i}]`);sfxLabels.push(`[fx${i}]`);}
    if(sfxLabels.length){filters.push(`[${mix}]${sfxLabels.join('')}amix=inputs=${sfxLabels.length+1}:duration=first:normalize=0[withFx]`);mix='withFx';}
    filters.push(`[${mix}]alimiter=limit=0.95[audio]`);
    const codec=transparent?['-c:v','libvpx-vp9','-pix_fmt','yuva420p','-auto-alt-ref','0','-crf','26','-b:v','0','-deadline','realtime','-cpu-used','6','-c:a','libopus','-b:a','128k']:o.codec==='av1'?['-c:v','libsvtav1','-preset','10','-crf','30','-c:a','aac','-b:a','192k','-movflags','+faststart']:['-c:v','libx264','-preset','fast','-crf','19','-profile:v','high','-c:a','aac','-b:a','192k','-movflags','+faststart'];
    await run([...args,'-filter_complex_threads','2','-filter_complex',filters.join(';'),'-map','[video]','-map','[audio]',...codec,'-threads','2','-ar','48000','-t',String(duration),pending],{root,signal});
    signal?.throwIfAborted();fs.renameSync(pending,o.output);progress(100,'최종 영상 저장 완료');
    return {output:o.output,duration,preset:o.preset,scene:true,width:W,height:H,schedule:cues,emotionRendering:'not-implemented'};
  }finally{fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(pending,{force:true});}
}
module.exports={renderScene,placement};
