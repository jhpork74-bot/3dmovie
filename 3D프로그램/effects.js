'use strict';
const path=require('node:path');
const {convert}=require('./media');
const EFFECTS=['none','fade','warm','mono','soft','sharp','vignette'];
function videoFilter(name,strength=1,duration=1){const a=Math.max(0,Math.min(1,Number(strength)||0));
  if(name==='warm')return `colorbalance=rs=${.06*a}:bs=${-.04*a},eq=saturation=${1+.12*a}`;
  if(name==='mono')return `hue=s=${1-a}`;
  if(name==='soft')return `gblur=sigma=${.1+2*a}`;
  if(name==='sharp')return `unsharp=5:5:${a}:5:5:0`;
  if(name==='vignette')return `vignette=angle=${.15+.5*a}`;
  if(name==='fade')return `fade=t=in:st=0:d=0.4,fade=t=out:st=${Math.max(0,duration-.4)}:d=0.4`;
  return 'null';
}
async function soundFiles(effects,dir){const result=[];for(const [index,e] of (Array.isArray(effects)?effects:[]).slice(0,20).entries()){
  if(!['chime','pop','whoosh'].includes(e.type))continue;
  const file=path.join(dir,`sfx-${index}.wav`),duration=e.type==='whoosh'?.5:.3;
  const source=e.type==='whoosh'?'anoisesrc=color=pink:amplitude=0.12:duration=0.5':`sine=frequency=${e.type==='chime'?1046:440}:sample_rate=48000:duration=${duration}`;
  await convert(['-f','lavfi','-i',source,'-af',`afade=t=out:st=0.05:d=${duration-.05},volume=${Math.max(0,Math.min(1,Number(e.volume)||.3))}`,'-ar','48000',file]);
  result.push({file,start:Math.max(0,Math.min(3600,Number(e.start)||0))});
}return result;}
module.exports={EFFECTS,videoFilter,soundFiles};
