const fs=require('node:fs'),path=require('node:path');
const {render}=require('../engine');
const dir=path.resolve(__dirname,'..','output');fs.mkdirSync(dir,{recursive:true});
const preset=process.argv[2]||'transparent';
render({text:'안녕! 나는 이모지예요. 만나서 반가워요!',preset,lipsyncMode:'local-basic',
  background:process.env.EMOJI_TEST_VIDEO,output:path.join(dir,`smoke-${preset}.${preset==='transparent'?'webm':'mp4'}`),
  voiceSpeed:1.1,pitch:3,videoSpeed:.8,codec:process.env.EMOJI_CODEC||'h264',
  keyframes:[{time:0,zoom:1,x:50,y:50},{time:2,zoom:1.5,x:65,y:40}],
},{progress:(p,m)=>console.log(Math.round(p),m)}).then(console.log).catch(e=>{console.error(e);process.exitCode=1;});
