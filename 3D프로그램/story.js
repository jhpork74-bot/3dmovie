'use strict';
const EMOTIONS=['auto','neutral','happy','sad','angry','surprised'];
function emotion(text){
  if(/눈물|슬퍼|슬프|울고|울어|미안|외로|속상|보고 싶/.test(text))return 'sad';
  if(/화나|화가|짜증|싫어|그만해|분노/.test(text))return 'angry';
  if(/놀라|깜짝|정말\?|뭐라고|우와/.test(text))return 'surprised';
  if(/웃|행복|기뻐|기쁘|좋아|반가|고마|축하|사랑|하하|ㅎㅎ/.test(text))return 'happy';
  return 'neutral';
}
function parseDialogue(text,overrides=[]){
  const lines=String(text).split(/\r?\n/).map(s=>s.trim()).filter(Boolean),result=[];
  for(const line of lines){
    const match=/^(?:\[(\d+(?:\.\d+)?)\]\s*)?이모지\s*([1-5])\s*[:：]\s*(.+)$/.exec(line);
    if(!match){if(lines.some(s=>/이모지\s*[1-5]\s*[:：]/.test(s)))throw Error('대사는 “이모지1: 안녕” 형식으로 입력해 주세요.');return [{actor:0,text:String(text),start:null,emotion:emotion(String(text))}];}
    const i=result.length,override=overrides[i]||{},explicit=override.start!==null&&override.start!==undefined&&override.start!==''?Number(override.start):(match[1]===undefined?null:Number(match[1]));
    if(explicit!==null&&(!Number.isFinite(explicit)||explicit<0||explicit>3600))throw Error('대사 시작점은 0~3,600초 사이여야 합니다.');
    const selected=EMOTIONS.includes(override.emotion)?override.emotion:'auto';
    result.push({actor:Number(match[2])-1,text:match[3],start:explicit,emotion:selected==='auto'?emotion(match[3]):selected});
  }
  if(result.length>60)throw Error('한 프로젝트는 최대 60개 대사까지 지원합니다.');
  return result;
}
function schedule(lines,durations){let cursor=0;const scheduled=lines.map((line,i)=>{const duration=Number(durations[i]);if(!Number.isFinite(duration)||duration<=0)throw Error('대사 음성의 실제 길이를 확인하지 못했습니다.');const start=line.start===null?cursor:line.start,end=start+duration;cursor=Math.max(cursor,end+.15);return {...line,start,end,duration,index:i};});
  for(let i=0;i<scheduled.length;i++)for(let j=i+1;j<scheduled.length;j++){const a=scheduled[i],b=scheduled[j];if(a.actor===b.actor&&a.start<b.end&&b.start<a.end)throw Error(`이모지${a.actor+1}의 대사가 겹칩니다. 시작점을 조정해 주세요.`);}
  return scheduled;
}
if(typeof module!=='undefined')module.exports={emotion,parseDialogue,schedule,EMOTIONS};
else globalThis.Story={emotion,parseDialogue,schedule,EMOTIONS};
