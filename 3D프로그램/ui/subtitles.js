/* Subtitle cue validation and interchange, shared by UI and tests. */
(function(root){
  'use strict';
  function normalize(cues){
    if(!Array.isArray(cues)||cues.length>1000)throw Error('자막은 최대 1,000개까지 지원합니다.');
    return cues.map((cue,index)=>{const start=Number(cue.start),end=Number(cue.end),text=String(cue.text||'').trim();
      if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>86400)throw Error(`${index+1}번 자막의 시작·종료 시간을 확인하세요. 종료는 시작보다 뒤여야 합니다.`);
      if(!text)throw Error(`${index+1}번 자막 내용을 입력하세요.`);
      return {id:String(cue.id??index),start,end,text:text.slice(0,2000),needsReview:cue.needsReview===true};
    }).sort((a,b)=>a.start-b.start||a.end-b.end);
  }
  function timestamp(seconds){let value=Math.max(0,Math.round(Number(seconds)*1000));const hours=Math.floor(value/3600000);value%=3600000;const minutes=Math.floor(value/60000);value%=60000;const secs=Math.floor(value/1000),millis=value%1000;return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')},${String(millis).padStart(3,'0')}`;}
  function srt(cues){return normalize(cues).map((cue,index)=>`${index+1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}\n`).join('\n');}
  function style(input={}){const color=(value,fallback)=>/^#[0-9a-f]{6}$/i.test(value||'')?value:fallback;return {fontSize:Math.max(12,Math.min(120,Number(input.fontSize)||40)),color:color(input.color,'#ffffff'),outlineColor:color(input.outlineColor,'#000000'),position:['top','center','bottom'].includes(input.position)?input.position:'bottom'};}
  const helper={normalize,timestamp,srt,style};if(typeof module!=='undefined')module.exports=helper;else root.StudioSubtitles=helper;
})(typeof globalThis!=='undefined'?globalThis:this);
