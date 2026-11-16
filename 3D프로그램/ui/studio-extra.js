/* Reusable, dependency-free editor widgets. No network or Electron access here. */
(function(root){
  'use strict';
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
  function detectEmotion(text){
    if(/눈물|슬퍼|슬프|울고|울어|미안|외로|속상|보고 싶/.test(text))return 'sad';
    if(/화나|화가|짜증|싫어|그만해|분노/.test(text))return 'angry';
    if(/놀라|깜짝|정말\?|뭐라고|우와/.test(text))return 'surprised';
    if(/웃|행복|기뻐|기쁘|좋아|반가|고마|축하|사랑|하하|ㅎㅎ/.test(text))return 'happy';
    return 'neutral';
  }
  function dialogue(text,starts=[],emotions=[],speed=1,actual=[]){
    const source=String(text).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const labelled=source.some(s=>/이모지\s*[1-5]\s*[:：]/.test(s));
    const lines=labelled?source:[String(text).trim()];let cursor=0;
    return lines.filter(Boolean).map((line,i)=>{
      const match=/^(?:\[(\d+(?:\.\d+)?)\]\s*)?이모지\s*([1-5])\s*[:：]\s*(.+)$/.exec(line);
      const content=match?match[3]:line,actor=match?Number(match[2])-1:0;
      const manual=starts[i]!==undefined&&starts[i]!==null&&starts[i]!==''?Number(starts[i]):match?.[1]===undefined?null:Number(match[1]);
      const verified=actual.find(v=>v.index===i),length=verified?.duration||Math.max(.5,content.length/(4.6*speed));
      const start=verified?.start??(manual===null?cursor:clamp(manual,0,3600));
      const chosen=emotions[i]||'auto';cursor=Math.max(cursor,start+length+.15);
      return {index:i,actor,text:content,start,end:start+length,duration:length,manual,emotion:chosen==='auto'?detectEmotion(content):chosen,chosen,actual:!!verified,invalid:labelled&&!match};
    });
  }
  function applyTheme(theme={}){
    const style=document.documentElement.style;
    const font=/^[\p{L}\p{N} _-]{1,80}$/u.test(theme.font||'')?theme.font:'Malgun Gothic';
    style.setProperty('--font',`"${font}", "Segoe UI", sans-serif`);
    if(/^#[a-f0-9]{6}$/i.test(theme.textColor||''))style.setProperty('--text',theme.textColor);
    if(/^#[a-f0-9]{6}$/i.test(theme.backgroundColor||'')){
      style.setProperty('--bg',theme.backgroundColor);
      style.setProperty('--panel',`color-mix(in srgb, ${theme.backgroundColor} 75%, white)`);
    }
  }
  class ProgressModel{
    constructor(){this.reset();}
    reset(){this.groups=Array.from({length:5},()=>({percent:0,status:'대기'}));this.started=null;this.resumed=null;this.paused=null;this.completed=null;this.activeMs=0;this.activeAt=null;this.baseline=0;this.state='대기';}
    start(resume=false){const now=Date.now();if(!resume)this.reset();this.started??=now;if(resume)this.resumed=now;this.activeAt=now;this.baseline=this.fraction();this.state=resume?'재개 중':'생성 중';}
    fraction(){return this.groups.reduce((s,g)=>s+g.percent,0)/500;}
    update(detail={}){
      if(!this.activeAt&&this.state==='연결 대기'&&['running','preparing','uploading','saving'].includes(detail.status))this.start(true);
      if(Number.isInteger(detail.group)&&detail.group>=0&&detail.group<5){
        const group=this.groups[detail.group];group.percent=clamp(detail.groupPercent,0,100);
        group.status=group.percent>=100?'완료':({preparing:'준비',queued:'GPU 대기',running:'생성 중',uploading:'전송 중',saving:'PC 보관 중',waiting:'연결 대기',paused:'일시 중단'}[detail.status]||'생성 중');
      }
      if(['waiting','paused'].includes(detail.status))this.pause(detail.status==='waiting'?'연결 대기':'일시 중단',detail.pausedAt);
    }
    pause(state='연결 대기',at=Date.now()){if(this.activeAt)this.activeMs+=Date.now()-this.activeAt;this.activeAt=null;this.paused=at||Date.now();this.state=state;}
    finish(){if(this.activeAt)this.activeMs+=Date.now()-this.activeAt;this.activeAt=null;this.groups.forEach(g=>Object.assign(g,{percent:100,status:'완료'}));this.completed=Date.now();this.state='저장 완료';}
    remaining(){const fraction=this.fraction()-this.baseline,elapsed=this.activeAt?Date.now()-this.activeAt:0;if(!this.activeAt||fraction<.05||elapsed<3000)return null;return elapsed/fraction*(1-this.fraction());}
  }
  const widgets={clamp,detectEmotion,dialogue,applyTheme,ProgressModel};
  if(typeof module!=='undefined')module.exports=widgets;else root.StudioWidgets=widgets;
})(typeof globalThis!=='undefined'?globalThis:this);
