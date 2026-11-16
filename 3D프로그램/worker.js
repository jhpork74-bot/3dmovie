const {parentPort,workerData}=require('node:worker_threads');
const {render}=require('./engine');
const abort=new AbortController();
parentPort.on('message',m=>{if(m==='cancel')abort.abort();});
render(workerData,{signal:abort.signal,progress:(percent,message,detail)=>parentPort.postMessage({type:'progress',percent,message,detail})})
  .then(result=>parentPort.postMessage({type:'done',result}))
  .catch(e=>parentPort.postMessage({type:'error',message:e.name==='AbortError'?'작업을 취소했습니다.':e.message}))
  .finally(()=>parentPort.close());
