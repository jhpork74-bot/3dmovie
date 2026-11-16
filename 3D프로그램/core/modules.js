'use strict';
/** First-party module registry. Providers, serialization and capability checks stay explicit. */
class ModuleRegistry{
  constructor(){this.modules=new Map();}
  register(definition){if(!/^[a-z][a-z0-9-]+$/.test(definition.id)||this.modules.has(definition.id))throw Error('Invalid or duplicate module id');this.modules.set(definition.id,Object.freeze({...definition,requires:[...(definition.requires||[])]}));return this;}
  ordered(){const done=new Set(),visiting=new Set(),result=[];const visit=id=>{if(done.has(id))return;if(visiting.has(id))throw Error('Module dependency cycle');const module=this.modules.get(id);if(!module)throw Error('Missing module: '+id);visiting.add(id);module.requires.forEach(visit);visiting.delete(id);done.add(id);result.push(module);};this.modules.forEach((_,id)=>visit(id));return result;}
  capabilities(){return this.ordered().map(({id,title,version,status,requires})=>({id,title,version,status,requires}));}
}
function studioModules(){return new ModuleRegistry()
  .register({id:'project',title:'프로젝트 · INI · 미디어',version:1,status:'implemented'})
  .register({id:'timeline',title:'레이어 · 대사 타임라인',version:1,status:'implemented',requires:['project']})
  .register({id:'tts',title:'한국어 음성',version:1,status:'locally-verified',requires:['project']})
  .register({id:'cloud-jobs',title:'무료 GPU 작업 · 5구간 · 복구',version:1,status:'integration-testing',requires:['project']})
  .register({id:'lip-sync',title:'정밀 립싱크',version:1,status:'gpu-validation-required',requires:['tts','cloud-jobs']})
  .register({id:'dialogue',title:'여러 이모지 · 순차/직접 대화',version:1,status:'local-render-verified',requires:['timeline','lip-sync']})
  .register({id:'emotion',title:'대본 감정 분석 · 표정 렌더링',version:1,status:'analysis-only-renderer-not-implemented',requires:['dialogue']})
  .register({id:'photo-script',title:'순서별 사진 대본',version:1,status:'model-integration-pending',requires:['cloud-jobs']})
  .register({id:'subtitles',title:'AI 자막 · 편집 · 영상 삽입',version:1,status:'ui-and-burn-in-implemented-asr-pending',requires:['timeline','cloud-jobs']})
  .register({id:'effects',title:'배경음 · 효과음 · 영상 FX',version:1,status:'local-render-partially-verified',requires:['timeline']})
  .register({id:'export',title:'유튜브 · 쇼츠 · 틱톡 · 투명',version:1,status:'local-encoding-verified',requires:['timeline','effects']});}
module.exports={ModuleRegistry,studioModules};
