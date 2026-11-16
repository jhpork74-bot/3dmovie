const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('studio',{
  chooseAvatar:index=>ipcRenderer.invoke('avatar:choose',index),resetAvatar:index=>ipcRenderer.invoke('avatar:reset',index),
  addActor:()=>ipcRenderer.invoke('actor:add'),removeActor:index=>ipcRenderer.invoke('actor:remove',index),updateActor:p=>ipcRenderer.invoke('actor:update',p),
  chooseMusic:()=>ipcRenderer.invoke('music:choose'),removeMusic:()=>ipcRenderer.invoke('music:remove'),
  chooseScriptPhotos:()=>ipcRenderer.invoke('photos:choose'),generatePhotoScript:p=>ipcRenderer.invoke('photos:generate',p),
  saveCloud:p=>ipcRenderer.invoke('cloud:save',p),checkCloud:()=>ipcRenderer.invoke('cloud:check'),
  clearCloudCache:()=>ipcRenderer.invoke('cloud:clear-cache'),openColab:()=>ipcRenderer.invoke('cloud:open-colab'),
  settings:()=>ipcRenderer.invoke('settings:get'),saveSettings:p=>ipcRenderer.invoke('settings:save',p),
  exportSettings:()=>ipcRenderer.invoke('settings:export'),importSettings:()=>ipcRenderer.invoke('settings:import'),
  chooseFolder:()=>ipcRenderer.invoke('folder:choose'),chooseVideo:()=>ipcRenderer.invoke('video:choose'),
  preview:p=>ipcRenderer.invoke('render:preview',p),export:p=>ipcRenderer.invoke('render:export',p),
  cancel:()=>ipcRenderer.invoke('render:cancel'),showFile:p=>ipcRenderer.invoke('file:show',p),
  upload:p=>ipcRenderer.invoke('upload:open',p),
  onProgress:fn=>{const listener=(_,m)=>fn(m);ipcRenderer.on('progress',listener);return()=>ipcRenderer.removeListener('progress',listener);},
});
