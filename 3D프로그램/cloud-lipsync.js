'use strict';
const fs=require('node:fs');
const {pipeline}=require('node:stream/promises');
const {Readable,Transform}=require('node:stream');
const {setTimeout:delay}=require('node:timers/promises');

function endpointUrl(value,{allowLocal=false}={}){
  let u;try{u=new URL(value);}catch{throw Error('무료 클라우드 연결 주소를 확인해 주세요.');}
  const local=allowLocal&&u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname);
  if((!local&&(u.protocol!=='https:'||!u.hostname.endsWith('.trycloudflare.com')))||u.username||u.password||u.search||u.hash||!['','/'].includes(u.pathname))throw Error('노트북에 표시된 https://…trycloudflare.com 주소를 입력해 주세요.');
  return u.origin;
}
function connection(input,opts){
  const endpoint=endpointUrl(input?.endpoint,{...opts,allowLocal:opts?.allowLocal||input?.internal===true}),token=String(input?.token||'').trim();
  if(token.length<16||token.length>256||/[\r\n]/.test(token))throw Error('무료 클라우드 노트북의 연결 코드를 입력해 주세요.');
  return {endpoint,token};
}
function abortSignal(signal,timeout=30000){return signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);}
function responseError(status){
  if(status===401||status===403)return Error('무료 클라우드 연결 코드가 맞지 않거나 접속이 거부됐습니다. 노트북의 주소와 코드를 확인하세요.');
  if(status===409)return Error('무료 GPU가 다른 작업을 처리 중입니다. 작업이 끝난 뒤 다시 시도해 주세요.');
  if(status===413)return Error('클라우드 처리 구간이 너무 큽니다. 대본 길이를 줄여 주세요.');
  if(status===429)return Error('무료 서버의 처리 한도에 도달했습니다. 잠시 후 다시 시도하세요.');
  return Error(`무료 클라우드 요청에 실패했습니다 (HTTP ${status}). 노트북의 실행 상태를 확인하세요.`);
}
async function request(c,route,{fetchImpl=fetch,signal,method='GET',body,timeout=30000}={}){
  const response=await fetchImpl(c.endpoint+route,{method,body,headers:{Authorization:`Bearer ${c.token}`},
    redirect:'error',signal:abortSignal(signal,timeout)});
  if(!response.ok)throw responseError(response.status);
  return response;
}
async function health(input,dependencies={}){
  const c=connection(input,dependencies);
  const response=await request(c,'/v1/health',dependencies);const data=await response.json();
  if(data.engine!=='musetalk-1.5'||data.protocol!==1||!data.gpu)throw Error('정밀 립싱크 GPU 서버를 확인하지 못했습니다. 노트북을 다시 실행하세요.');
  return {engine:data.engine,gpu:String(data.gpu).slice(0,100),maxSegmentSeconds:60};
}
async function download(response,target,signal){
  if(!response.body)throw Error('클라우드 결과 영상이 비어 있습니다.');
  let size=0;
  await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,encoding,cb){size+=chunk.length;cb(size>500*1024*1024?Error('클라우드 결과 파일이 너무 큽니다.'):null,chunk);}}),fs.createWriteStream(target),{signal});
  if(size===0)throw Error('클라우드 결과 영상이 비어 있습니다.');
}
async function generate(input,{video,audio,output,signal,progress=()=>{}},dependencies={}){
  const c=connection(input,dependencies);let job;
  const args={...dependencies,signal};
  signal?.throwIfAborted();
  const form=new FormData();
  form.append('source_video',new File([fs.readFileSync(video)],'avatar.mp4',{type:'video/mp4'}));
  form.append('audio',new File([fs.readFileSync(audio)],'speech.wav',{type:'audio/wav'}));
  try{
    progress('이모지와 음성을 무료 GPU로 보내고 있어요');
    const submitted=await request(c,'/v1/jobs',{...args,method:'POST',body:form,timeout:120000});
    const data=await submitted.json();
    if(typeof data.id!=='string'||!/^[a-f0-9]{32}$/.test(data.id))throw Error('클라우드 작업 응답을 확인하지 못했습니다.');
    job=data.id;
    // No automatic resubmission: reconnecting must not start duplicate generation.
    const deadline=Date.now()+30*60*1000;
    while(true){
      signal?.throwIfAborted();
      if(Date.now()>deadline)throw Error('무료 GPU 처리 대기 시간이 30분을 넘었습니다. 노트북 상태를 확인하세요.');
      const r=await request(c,`/v1/jobs/${job}`,args),state=await r.json();
      if(state.status==='completed')break;
      if(state.status==='failed')throw Error('정밀 립싱크 생성에 실패했습니다. 노트북의 작업 로그에서 얼굴 인식·GPU 메모리를 확인하세요.');
      if(state.status==='cancelled')throw new DOMException('Cancelled','AbortError');
      if(!['queued','running'].includes(state.status))throw Error('클라우드 작업 상태를 확인하지 못했습니다.');
      progress(state.status==='queued'?'무료 GPU 순서를 기다리고 있어요':'무료 GPU가 발음에 맞는 입 모양을 만들고 있어요',{
        status:state.status,percent:Number.isFinite(state.progress)?Math.max(0,Math.min(100,state.progress)):null});
      await (dependencies.wait||((ms,s)=>delay(ms,undefined,{signal:s})))(2000,signal);
    }
    progress('정밀 립싱크 결과를 받아오고 있어요');
    const result=await request(c,`/v1/jobs/${job}/video`,{...args,timeout:120000});
    await (dependencies.download||download)(result,output,signal);
    signal?.throwIfAborted();
    await request(c,`/v1/jobs/${job}`,{...dependencies,method:'DELETE',timeout:10000}).catch(()=>{});
    job=null;return output;
  }catch(e){
    fs.rmSync(output,{force:true});
    if(job)await request(c,`/v1/jobs/${job}`,{...dependencies,method:'DELETE',timeout:10000}).catch(()=>{});
    if(e.name==='AbortError')throw e;
    if(e instanceof TypeError)throw Error('무료 클라우드에 연결하지 못했습니다. Colab 세션이 실행 중인지 확인하세요.');
    throw e;
  }
}
module.exports={endpointUrl,connection,health,generate};
