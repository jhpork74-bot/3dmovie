'use strict';
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {importPhoto,importMusic}=require('./media');
function registerMedia({ipcMain,dialog,app,getWindow,isBusy,prefs,savePrefs}){
  const root=path.join(app.getPath('userData'),'media');
  function resolvedActor(actor){const f=actor.file;return f&&path.extname(f).toLowerCase()==='.png'&&fs.existsSync(f)?f:path.join(__dirname,'assets','avatar-closed.png');}
  function actorStatus(){return prefs().actors.map((a,index)=>({...a,index,url:pathToFileURL(resolvedActor(a)).href}));}
  function guard(){if(isBusy())throw Error('작업을 중단한 뒤 미디어를 변경해 주세요.');}
  function actorIndex(index){if(!Number.isInteger(index)||index<0||index>=prefs().actors.length)throw Error('이모지를 선택해 주세요.');return index;}
  const imageFilters=[{name:'ChatGPT 이모지 · 이미지',extensions:['png','webp','jpg','jpeg','svg','gif']}];
  ipcMain.handle('avatar:choose',async(_,index=0)=>{guard();actorIndex(index);const r=await dialog.showOpenDialog(getWindow(),{title:'이모지 이미지 가져오기',properties:['openFile'],filters:imageFilters});if(r.canceled)return null;const photo=await importPhoto(r.filePaths[0],path.join(root,'avatars')),p=prefs();p.actors[index].file=photo.file;if(index===0)p.avatar={file:photo.file};savePrefs(p);return actorStatus();});
  ipcMain.handle('avatar:reset',(_,index=0)=>{guard();actorIndex(index);const p=prefs();p.actors[index].file='';if(index===0)p.avatar={file:''};savePrefs(p);return actorStatus();});
  ipcMain.handle('actor:add',()=>{guard();const p=prefs();if(p.actors.length>=5)throw Error('한 장면에는 최대 5개 이모지를 배치할 수 있습니다.');p.actors.push({file:'',size:200,x:.08+(p.actors.length-1)*.16,y:.78});savePrefs(p);return actorStatus();});
  ipcMain.handle('actor:remove',(_,index)=>{guard();actorIndex(index);const p=prefs();if(p.actors.length===1)throw Error('기본 이모지 한 개는 남겨 두어야 합니다.');if(index!==p.actors.length-1)throw Error('대사의 이모지 번호를 유지하려면 마지막 이모지부터 삭제해 주세요.');p.actors.pop();savePrefs(p);return actorStatus();});
  ipcMain.handle('actor:update',(_,input)=>{guard();const index=actorIndex(input.index),p=prefs();for(const key of ['size','x','y'])if(Object.hasOwn(input,key))p.actors[index][key]=input[key];savePrefs(p);return actorStatus();});
  ipcMain.handle('music:choose',async()=>{guard();const r=await dialog.showOpenDialog(getWindow(),{title:'배경음 가져오기 · AVI의 오디오도 지원',properties:['openFile'],filters:[{name:'음성 또는 소리가 있는 영상',extensions:['mp3','wav','m4a','aac','ogg','flac','avi','mp4','mov','webm']}]});if(r.canceled)return null;const music=await importMusic(r.filePaths[0],path.join(root,'music'));savePrefs({...prefs(),music:{...prefs().music,...music}});return prefs().music;});
  ipcMain.handle('music:remove',()=>{guard();savePrefs({...prefs(),music:{...prefs().music,file:'',name:''}});return prefs().music;});
  ipcMain.handle('photos:choose',async()=>{const r=await dialog.showOpenDialog(getWindow(),{title:'대본을 만들 사진 가져오기 · 최대 10장',properties:['openFile','multiSelections'],filters:imageFilters});if(r.canceled)return null;if(r.filePaths.length>10)throw Error('사진은 한 번에 최대 10장까지 선택해 주세요.');const result=[];for(const source of r.filePaths){const photo=await importPhoto(source,path.join(root,'photos'));result.push({id:photo.id,name:photo.name,url:pathToFileURL(photo.file).href});}return result;});
  function photoFiles(ids){if(!Array.isArray(ids)||!ids.length||ids.length>10)throw Error('사진 1~10장을 선택해 주세요.');return ids.map(id=>{if(typeof id!=='string'||!(/^[a-f0-9]{64}$/).test(id))throw Error('사진 파일을 다시 가져와 주세요.');const file=path.join(root,'photos',id+'.png');if(!fs.existsSync(file))throw Error('사진 파일이 없습니다. 다시 가져와 주세요.');return file;});}
  return {actorStatus,actorFiles:()=>prefs().actors.map((a,index)=>({...a,index,file:resolvedActor(a)})),photoFiles};
}
module.exports={registerMedia};
