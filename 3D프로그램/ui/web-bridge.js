/* Browser adapter for the same editor contract used by Electron. */
(function(){
  'use strict';
  if(window.studio||!/^https?:$/.test(location.protocol))return;
  let folderHandle=null,lastSavedFile=null,lastResultUrl=null,uploadWindow=null;
  const listeners=new Set();
  async function request(route,body){const response=await fetch('/api/'+route,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});if(!response.ok){let error;try{error=(await response.json()).error;}catch{}throw Error(error||`요청 실패 (HTTP ${response.status})`);}try{return await response.json();}catch{throw Error('클라우드 세션 응답을 확인하지 못했습니다. 세션이 실행 중인지 확인해 주세요.');}}
  function chooseFiles(accept,multiple=false){return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept=accept;input.multiple=multiple;input.hidden=true;document.body.append(input);input.onchange=()=>{const files=Array.from(input.files||[]);input.remove();resolve(files);};input.oncancel=()=>{input.remove();resolve([]);};input.click();});}
  async function upload(type,files,index){if(!files.length)return null;const form=new FormData();for(const file of files)form.append('files',file,file.name);const response=await fetch(`/api/upload/${type}${index===undefined?'':`?index=${index}`}`,{method:'POST',credentials:'same-origin',body:form});if(!response.ok){let text;try{text=(await response.json()).error;}catch{}throw Error(text||`가져오기 실패 (HTTP ${response.status})`);}return response.json();}
  async function rememberFolder(handle){if(!window.indexedDB)return;try{const database=await new Promise((resolve,reject)=>{const open=indexedDB.open('sihu-editor',1);open.onupgradeneeded=()=>open.result.createObjectStore('settings');open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});await new Promise((resolve,reject)=>{const transaction=database.transaction('settings','readwrite');transaction.objectStore('settings').put(handle,'folder');transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);});database.close();}catch{/* Folder persistence is optional; generation still works. */}}
  async function restoreFolder(){if(!window.indexedDB)return;try{const database=await new Promise((resolve,reject)=>{const open=indexedDB.open('sihu-editor',1);open.onupgradeneeded=()=>open.result.createObjectStore('settings');open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});folderHandle=await new Promise((resolve,reject)=>{const get=database.transaction('settings').objectStore('settings').get('folder');get.onsuccess=()=>resolve(get.result||null);get.onerror=()=>reject(get.error);});database.close();}catch{folderHandle=null;}}
  const folderReady=restoreFolder();
  async function permission(){await folderReady;if(folderHandle){let state=await folderHandle.queryPermission({mode:'readwrite'});if(state!=='granted')state=await folderHandle.requestPermission({mode:'readwrite'});if(state!=='granted')throw Error('저장 폴더 쓰기 권한을 허용하거나 폴더를 다시 선택해 주세요.');}}
  async function chooseFolder(){if(!window.showDirectoryPicker)throw Error('폴더 직접 저장은 PC용 Chrome 또는 Edge의 HTTPS 화면에서 지원합니다. 현재 브라우저에서는 기본 다운로드 폴더에 저장됩니다.');try{folderHandle=await window.showDirectoryPicker({mode:'readwrite',id:'sihu-video-output',startIn:folderHandle||'videos'});}catch(e){if(e.name==='AbortError')return null;throw e;}await rememberFolder(folderHandle);const settings=await request('settings/save',{folder:folderHandle.name});return {...settings,folder:folderHandle.name};}
  function download(url,name){const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.hidden=true;document.body.append(anchor);anchor.click();anchor.remove();}
  async function saveResult(result){lastResultUrl=result.url;if(!result.url)throw Error('저장할 영상의 다운로드 주소가 없습니다.');const name=(result.output||'EmojiStudio-video.mp4').split(/[\\/]/).at(-1);if(folderHandle){const file=await folderHandle.getFileHandle(name,{create:true}),writable=await file.createWritable();const response=await fetch(result.url,{credentials:'same-origin'});if(!response.ok){await writable.abort();throw Error('완성 영상 다운로드에 실패했습니다.');}if(response.body)await response.body.pipeTo(writable);else{await writable.write(await response.blob());await writable.close();}lastSavedFile=file;}else download(result.url,name);return {...result,output:folderHandle?`${folderHandle.name}/${name}`:name};}
  function emit(data){for(const listener of listeners)listener(data);}
  async function jobRequest(route,body){
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(route+JSON.stringify(body)));
    const key='sihu-job-'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    let id;try{id=sessionStorage.getItem(key);}catch{}
    const forget=()=>{try{sessionStorage.removeItem(key);}catch{}};
    if(!id){const submitted=await request(route,body);if(submitted.result)return submitted.result;if(!submitted.id)throw Error('클라우드 작업 번호를 확인하지 못했습니다.');id=submitted.id;try{sessionStorage.setItem(key,id);}catch{}}
    const deadline=Date.now()+45*60*1000;let disconnectedAt=null;
    while(Date.now()<deadline){
      try{
        const response=await fetch('/api/jobs/'+encodeURIComponent(id),{credentials:'same-origin'});
        if(response.status===404){forget();throw Object.assign(Error('무료 세션에서 이전 작업을 찾지 못했습니다. 저장된 구간을 확인하고 재개해 주세요.'),{fatal:true});}
        if(!response.ok)throw Error('클라우드 연결을 확인하고 있어요');
        const job=await response.json();if(disconnectedAt)emit({message:'무료 클라우드 연결 복구 · 기존 작업을 확인하고 있어요.',detail:{status:'running',resumedAt:Date.now()}});disconnectedAt=null;
        if(job.status==='completed'){forget();return job.result;}
        if(job.status==='failed'||job.status==='cancelled'){forget();throw Object.assign(Error(job.error||'클라우드 작업이 중단됐습니다.'),{fatal:true});}
      }catch(error){
        if(error.fatal)throw error;
        disconnectedAt??=Date.now();
        emit({message:'무료 클라우드 연결 대기 · 기존 작업 번호를 보존합니다.',detail:{status:'waiting',pausedAt:disconnectedAt,nextCheckAt:Date.now()+5000}});
        if(Date.now()-disconnectedAt>60000)throw Error('무료 클라우드 연결이 끊어졌습니다. 연결 복구 뒤 같은 작업 번호로 확인합니다.');
      }
      await new Promise(resolve=>setTimeout(resolve,disconnectedAt?5000:2000));
    }
    throw Error('무료 클라우드 작업 확인 시간이 길어지고 있습니다. 기존 작업 번호를 보존했으니 다시 재개할 수 있습니다.');
  }
  const bridge={isWeb:true,
    settings:async()=>{await folderReady;const data=await request('settings/get');return {...data,folder:folderHandle?.name||data.folder||''};},
    saveSettings:p=>request('settings/save',p),chooseFolder,
    chooseVideo:async()=>upload('video',await chooseFiles('.mp4,.mov,.webm,.mkv,.avi')),
    chooseAvatar:async index=>upload('avatar',await chooseFiles('.png,.jpg,.jpeg,.webp,.svg,.gif'),index),resetAvatar:index=>request('avatar/reset',{index}),
    addActor:()=>request('actor/add'),removeActor:index=>request('actor/remove',{index}),updateActor:p=>request('actor/update',p),
    chooseMusic:async()=>upload('music',await chooseFiles('.mp3,.wav,.m4a,.aac,.ogg,.flac,.avi,.mp4,.mov,.webm')),removeMusic:()=>request('music/remove'),
    chooseScriptPhotos:async()=>upload('photos',await chooseFiles('.png,.jpg,.jpeg,.webp,.svg,.gif',true)),generatePhotoScript:p=>jobRequest('photos/generate',p),
    saveCloud:p=>request('cloud/save',p),checkCloud:()=>request('cloud/check'),clearCloudCache:()=>request('cloud/clear-cache'),openColab:async()=>{window.open('https://colab.research.google.com/','_blank','noopener,noreferrer');},
    transcribeVideo:p=>jobRequest('subtitles/transcribe',p),preview:p=>jobRequest('render/preview',p),export:async p=>{await permission();return saveResult(await jobRequest('render/export',p));},cancel:()=>request('render/cancel'),
    exportSettings:async()=>{const settings=await request('settings/export');const blob=new Blob([settings.ini||settings.text||''],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob);download(url,settings.name||'EmojiStudio.ini');setTimeout(()=>URL.revokeObjectURL(url),10000);return 'EmojiStudio.ini';},
    importSettings:async()=>{const files=await chooseFiles('.ini');if(!files.length)return null;if(files[0].size>1024*1024)throw Error('INI 파일은 1MB 이하여야 합니다.');return request('settings/import',{text:await files[0].text()});},
    showFile:async()=>{if(lastSavedFile&&window.showOpenFilePicker){const file=await lastSavedFile.getFile(),url=URL.createObjectURL(file);window.open(url,'_blank','noopener,noreferrer');setTimeout(()=>URL.revokeObjectURL(url),60000);}else if(lastResultUrl)window.open(lastResultUrl,'_blank','noopener,noreferrer');else return {notice:'브라우저 다운로드 목록 또는 선택한 저장 폴더에서 완성 영상을 확인하세요.'};},
    prepareUpload:()=>{uploadWindow=window.open('about:blank','SihuUpload');if(uploadWindow)uploadWindow.document.title='영상 생성 후 업로드 페이지를 엽니다';},
    upload:async platform=>{const urls={youtube:'https://www.youtube.com/upload',instagram:'https://www.instagram.com/',tiktok:'https://www.tiktok.com/tiktokstudio/upload'};if(!urls[platform])throw Error('지원하지 않는 플랫폼입니다.');if(uploadWindow&&!uploadWindow.closed){uploadWindow.location=urls[platform];uploadWindow=null;}else if(!window.open(urls[platform],'_blank','noopener,noreferrer'))throw Error('팝업을 허용한 뒤 플랫폼 페이지를 다시 열어 주세요.');},
    onProgress:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
  };
  const events=new EventSource('/api/events');events.onmessage=event=>{try{const data=JSON.parse(event.data);emit(data);}catch{}};
  window.studio=bridge;
  document.addEventListener('DOMContentLoaded',async()=>{
    await folderReady;
    const dialog=document.createElement('dialog');dialog.id='webFolderDialog';
    const title=document.createElement('h2');title.textContent='완성 영상을 저장할 폴더';
    const note=document.createElement('p');note.className='note';note.textContent=folderHandle?`이전에 선택한 폴더: ${folderHandle.name}. 폴더를 바꾸거나 기존 위치를 사용하세요.`:'Chrome·Edge에서는 폴더를 직접 선택할 수 있습니다. 다른 브라우저는 기본 다운로드 폴더를 사용합니다.';
    const choose=document.createElement('button');choose.className='primary';choose.textContent='저장 폴더 선택';
    const keep=document.createElement('button');keep.className='quiet';keep.textContent=folderHandle?'기존 폴더 사용':'기본 다운로드 폴더 사용';
    choose.onclick=async()=>{try{const settings=await chooseFolder();if(settings){window.dispatchEvent(new CustomEvent('studio-folder-changed',{detail:settings}));dialog.close();}}catch(error){note.textContent=error.message;}};
    keep.onclick=async()=>{try{if(folderHandle)await permission();const settings=await request('settings/save',{folder:folderHandle?.name||'브라우저 기본 다운로드'});window.dispatchEvent(new CustomEvent('studio-folder-changed',{detail:{...settings,folder:folderHandle?.name||'브라우저 기본 다운로드'}}));dialog.close();}catch(error){note.textContent=error.message;}};
    dialog.append(title,note,choose,document.createTextNode(' '),keep);document.body.append(dialog);dialog.showModal();
  });
})();
