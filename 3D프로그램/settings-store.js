'use strict';
const fs=require('node:fs'),path=require('node:path');
const DEFAULTS={folder:'',platform:'youtube',accounts:{youtube:'',instagram:'',tiktok:''},
  appearance:{font:'Malgun Gothic',textColor:'#202020',backgroundColor:'#c4c4c4'},
  cloud:{endpoint:'',autoStart:true},avatar:{file:''},actors:[{file:'',size:200,x:null,y:null}],background:{file:''},music:{file:'',name:'',volume:.18,duck:true},editor:{}};
const color=(value,fallback)=>/^#[0-9a-f]{6}$/i.test(value||'')?value:fallback;
function normalize(input={}){
  const appearance=input.appearance||{},cloud=input.cloud||{},accounts=input.accounts||{},editor=input.editor||{};
  const clean={...DEFAULTS,folder:String(input.folder||'').slice(0,4096),platform:['youtube','instagram','tiktok'].includes(input.platform)?input.platform:'youtube',
    accounts:Object.fromEntries(['youtube','instagram','tiktok'].map(k=>[k,String(accounts[k]||'').slice(0,100)])),
    appearance:{font:typeof appearance.font==='string'&&/^[\p{L}\p{N} _-]{1,80}$/u.test(appearance.font)?appearance.font:DEFAULTS.appearance.font,
      textColor:color(appearance.textColor,DEFAULTS.appearance.textColor),backgroundColor:color(appearance.backgroundColor,DEFAULTS.appearance.backgroundColor)},
    cloud:{endpoint:String(cloud.endpoint||'').slice(0,512),autoStart:cloud.autoStart!==false},avatar:{file:String(input.avatar?.file||'').slice(0,4096)},
    actors:(Array.isArray(input.actors)&&input.actors.length?input.actors:[{file:input.avatar?.file||''}]).slice(0,5).map(a=>({file:String(a?.file||'').slice(0,4096),size:Number.isFinite(Number(a?.size))?Math.max(80,Math.min(600,Number(a.size))):200,x:a?.x==null?null:Math.max(0,Math.min(1,Number(a.x)||0)),y:a?.y==null?null:Math.max(0,Math.min(1,Number(a.y)||0))})),
    background:{file:String(input.background?.file||'').slice(0,4096)},music:{file:String(input.music?.file||'').slice(0,4096),name:String(input.music?.name||'').slice(0,200),volume:Number.isFinite(Number(input.music?.volume))?Math.max(0,Math.min(1,Number(input.music.volume))):.18,duck:input.music?.duck!==false},editor:{}};
  // Whitelist editable fields: imported INI data cannot become commands or credentials.
  for(const k of ['text','preset','codec','voiceSpeed','pitch','videoSpeed','size','margin','opacity','position','mirror','zoom','panX','panY','keyframes','activeActor','lineStarts','lineEmotions','audioEffects','videoEffect','effectStrength','subtitles','subtitleStyle','subtitleLanguage','subtitleGlossary']){
    const v=editor[k];if(typeof v==='string')clean.editor[k]=v.slice(0,k==='text'?3000:100);
    else if(typeof v==='number'&&Number.isFinite(v)||typeof v==='boolean')clean.editor[k]=v;
    else if(k==='keyframes'&&Array.isArray(v))clean.editor[k]=v.slice(0,100).map(p=>Object.fromEntries(['time','zoom','x','y'].map(f=>[f,Number.isFinite(Number(p?.[f]))?Number(p[f]):0])));
    else if(k==='lineStarts'&&Array.isArray(v))clean.editor[k]=v.slice(0,60).map(x=>x===null||x===''?null:Math.max(0,Math.min(3600,Number(x)||0)));
    else if(k==='lineEmotions'&&Array.isArray(v))clean.editor[k]=v.slice(0,60).map(x=>String(x).slice(0,20));
    else if(k==='audioEffects'&&Array.isArray(v))clean.editor[k]=v.slice(0,20).map(e=>({type:['chime','pop','whoosh'].includes(e.type)?e.type:'chime',start:Math.max(0,Math.min(3600,Number(e.start)||0)),volume:Math.max(0,Math.min(1,Number(e.volume)||.3))}));
    else if(k==='subtitles'&&Array.isArray(v))clean.editor[k]=v.slice(0,2000).map(c=>({id:String(c.id||'').slice(0,60),start:Math.max(0,Number(c.start)||0),end:Math.max(0,Number(c.end)||0),text:String(c.text||'').slice(0,1000),needsReview:!!c.needsReview}));
    else if(k==='subtitleStyle'&&v&&typeof v==='object')clean.editor[k]={fontSize:Math.max(16,Math.min(100,Number(v.fontSize)||40)),color:color(v.color,'#ffffff'),outlineColor:color(v.outlineColor,'#000000'),position:['top','center','bottom'].includes(v.position)?v.position:'bottom'};
  }
  return clean;
}
function stringify(input){
  const p=normalize(input);const sections={program:{version:1,platform:p.platform},output:{folder:p.folder},appearance:p.appearance,accounts:p.accounts,cloud:p.cloud,avatar:p.avatar,actors:{items:p.actors},background:p.background,music:p.music,editor:p.editor};
  return '; Emoji Studio settings. Connection codes are stored separately using Windows encryption.\n'+Object.entries(sections).map(([section,values])=>`[${section}]\n`+Object.entries(values).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')).join('\n\n')+'\n';
}
function parse(text){
  if(Buffer.byteLength(text,'utf8')>1024*1024)throw Error('INI 파일은 1MB 이하여야 합니다.');
  const all=Object.create(null);let section;
  for(const raw of text.replace(/^\uFEFF/,'').split(/\r?\n/)){
    const line=raw.trim();if(!line||/^[;#]/.test(line))continue;
    if(/^\[[a-z]+\]$/i.test(line)){section=line.slice(1,-1);all[section]??=Object.create(null);continue;}
    const match=/^([a-zA-Z][a-zA-Z0-9]*)\s*=(.*)$/.exec(line);if(!match||!section)throw Error('올바른 INI 설정 파일이 아닙니다.');
    try{all[section][match[1]]=JSON.parse(match[2]);}catch{all[section][match[1]]=match[2].trim();}
  }
  if(!all.program&&!all.output&&!all.appearance)throw Error('이모지스튜디오 설정 파일인지 확인하세요.');
  return normalize({folder:all.output?.folder,platform:all.program?.platform,appearance:all.appearance,accounts:all.accounts,cloud:all.cloud,avatar:all.avatar,actors:all.actors?.items,background:all.background,music:all.music,editor:all.editor});
}
function createStore(directory){
  const file=path.join(directory,'settings.ini');
  return {file,read(){try{return parse(fs.readFileSync(file,'utf8'));}catch{
    // Migrate previous JSON settings, excluding any secret or runtime-only fields.
    try{return normalize(JSON.parse(fs.readFileSync(path.join(directory,'settings.json'),'utf8')));}catch{return normalize();}
  }},write(input){const p=normalize(input);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(file+'.tmp',stringify(p),'utf8');fs.renameSync(file+'.tmp',file);return p;}};
}
module.exports={DEFAULTS,normalize,stringify,parse,createStore};
