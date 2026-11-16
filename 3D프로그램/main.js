'use strict';
const {app,BrowserWindow,ipcMain,dialog,shell,safeStorage}=require('electron');
const {Worker}=require('node:worker_threads');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {options,normalizeAvatar}=require('./engine');
const {registerMedia}=require('./desktop-media');
const cloud=require('./cloud-lipsync');
const settingsStore=require('./settings-store');
let win,active,background=null,sessionToken='',mediaManager;
const UPLOAD={youtube:'https://www.youtube.com/upload',instagram:'https://www.instagram.com/',tiktok:'https://www.tiktok.com/tiktokstudio/upload'};
function store(){return settingsStore.createStore(app.getPath('userData'));}
function prefs(){return store().read();}
function savePrefs(p){return store().write(p);}
function tokenFile(){return path.join(app.getPath('userData'),'cloud-connection.bin');}
function secureStorage(){return safeStorage.isEncryptionAvailable()&&(process.platform==='win32'||safeStorage.getSelectedStorageBackend?.()!=='basic_text');}
function cloudConnection(){let token=sessionToken;if(!token&&secureStorage()){try{token=safeStorage.decryptString(fs.readFileSync(tokenFile()));}catch{}}return {endpoint:prefs().cloud?.endpoint||'',token};}
function cloudStatus(){const c=cloudConnection();return {endpoint:c.endpoint,autoStart:prefs().cloud.autoStart,configured:!!(c.endpoint&&c.token),persistent:secureStorage()};}
function publicSettings(){return {...prefs(),cloud:cloudStatus(),actors:mediaManager.actorStatus(),avatar:mediaManager.actorStatus()[0],defaultVideo:background&&fs.existsSync(background)?{name:path.basename(background),url:pathToFileURL(background).href}:null};}
function workerInput(o){return {...o,lipsyncMode:'cloud',avatarFile:mediaManager.actorFiles()[0].file,actors:mediaManager.actorFiles(),musicFile:prefs().music.file,musicVolume:o.musicVolume??prefs().music.volume,musicDuck:o.musicDuck??prefs().music.duck,cloud:cloudConnection(),cloudCacheDir:path.join(app.getPath('userData'),'cloud-cache')};}
function job(input){
  if(active)return Promise.reject(Error('진행 중인 작업이 끝나면 다시 시도해 주세요.'));
  return new Promise((resolve,reject)=>{
    const w=new Worker(path.join(__dirname,'worker.js'),{workerData:input});active=w;let result,failure;
    w.on('message',m=>{
      if(m.type==='progress' && !win.isDestroyed())win.webContents.send('progress',m);
      if(m.type==='done')result=m.result;
      if(m.type==='error')failure=Error(m.message);
    });
    w.on('error',reject);
    w.on('exit',code=>{if(active===w)active=null;if(result&&!failure&&code===0)resolve(result);else reject(failure||Error('영상 처리 엔진이 종료됐습니다.'));});
  });
}
app.whenReady().then(async()=>{
  const selected=await dialog.showOpenDialog({title:'생성한 영상을 저장할 폴더를 선택하세요',
    defaultPath:prefs().folder||app.getPath('videos'),properties:['openDirectory','createDirectory']});
  if(!selected.canceled)savePrefs({...prefs(),folder:selected.filePaths[0]});
  background=prefs().background.file&&fs.existsSync(prefs().background.file)?prefs().background.file:path.join(__dirname,'assets','background.mp4');
  if(process.platform==='win32')process.env.PATH=path.join(__dirname,'node_modules','sherpa-onnx-win-x64')+path.delimiter+process.env.PATH;
  win=new BrowserWindow({width:1360,height:1000,minWidth:1000,minHeight:800,backgroundColor:'#10131b',
    title:'이모지스튜디오',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.setMenuBarVisibility(false);win.loadFile('ui/index.html');
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(e,url)=>{if(url!==win.webContents.getURL())e.preventDefault();});
  mediaManager=registerMedia({ipcMain,dialog,app,getWindow:()=>win,isBusy:()=>!!active,prefs,savePrefs});
  ipcMain.handle('settings:get',()=>publicSettings());
  ipcMain.handle('cloud:save',(_,input)=>{
    const old=cloudConnection(),c=cloud.connection({endpoint:input.endpoint,token:input.token||old.token});
    sessionToken=c.token;savePrefs({...prefs(),cloud:{...prefs().cloud,endpoint:c.endpoint}});
    if(secureStorage())fs.writeFileSync(tokenFile(),safeStorage.encryptString(c.token));
    return cloudStatus();
  });
  ipcMain.handle('cloud:check',()=>cloud.health(cloudConnection()));
  ipcMain.handle('cloud:clear-cache',()=>{if(active)throw Error('생성이 끝나거나 중단된 뒤 삭제하세요.');fs.rmSync(path.join(app.getPath('userData'),'cloud-cache'),{recursive:true,force:true});});
  ipcMain.handle('cloud:open-colab',()=>shell.openExternal('https://colab.research.google.com/'));
  ipcMain.handle('settings:save',(_,p)=>{
    const old=prefs();return savePrefs({...old,platform:p.platform??old.platform,accounts:p.accounts??old.accounts,
      appearance:p.appearance??old.appearance,editor:p.editor??old.editor,music:{...old.music,volume:p.music?.volume??old.music.volume,duck:p.music?.duck??old.music.duck},cloud:{...old.cloud,autoStart:p.cloud?.autoStart??old.cloud.autoStart}});
  });
  ipcMain.handle('settings:export',async()=>{const r=await dialog.showSaveDialog(win,{title:'INI 설정 저장',defaultPath:'EmojiStudio.ini',filters:[{name:'INI 설정',extensions:['ini']}]});if(r.canceled)return null;fs.writeFileSync(r.filePath,settingsStore.stringify(prefs()),'utf8');return r.filePath;});
  ipcMain.handle('settings:import',async()=>{if(active)throw Error('생성을 중단한 뒤 설정을 불러오세요.');const r=await dialog.showOpenDialog(win,{title:'INI 설정 불러오기',properties:['openFile'],filters:[{name:'INI 설정',extensions:['ini']}]});if(r.canceled)return null;if(fs.statSync(r.filePaths[0]).size>1024*1024)throw Error('INI 파일은 1MB 이하여야 합니다.');savePrefs(settingsStore.parse(fs.readFileSync(r.filePaths[0],'utf8')));background=prefs().background.file&&fs.existsSync(prefs().background.file)?prefs().background.file:background;return publicSettings();});
  ipcMain.handle('folder:choose',async()=>{const r=await dialog.showOpenDialog(win,{defaultPath:prefs().folder||app.getPath('videos'),properties:['openDirectory','createDirectory']});if(r.canceled)return null;return savePrefs({...prefs(),folder:r.filePaths[0]});});
  ipcMain.handle('video:choose',async()=>{
    const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'동영상',extensions:['mp4','mov','webm','mkv','avi']}]});
    if(r.canceled)return null;background=r.filePaths[0];savePrefs({...prefs(),background:{file:background}});return {name:path.basename(background),url:pathToFileURL(background).href};
  });
  ipcMain.handle('render:preview',async(_,input)=>{
    const o=options(input),output=path.join(app.getPath('temp'),`sihu-preview-${Date.now()}.webm`);
    const result=await job(workerInput({...o,previewPreset:o.preset,preset:'transparent',output}));return {...result,url:pathToFileURL(output).href};
  });
  ipcMain.handle('render:export',async(_,input)=>{
    const o=options(input),folder=prefs().folder;
    if(!fs.existsSync(folder))throw Error('설정에서 저장 폴더를 다시 선택해 주세요.');
    const name=`EmojiStudio-${new Date().toISOString().replace(/[:.]/g,'-')}-${Math.floor(Math.random()*1000)}.${o.preset==='transparent'?'webm':'mp4'}`;
    return job(workerInput({...o,background,output:path.join(folder,name)}));
  });
  ipcMain.handle('render:cancel',()=>{active?.postMessage('cancel');});
  ipcMain.handle('file:show',(_,file)=>{const folder=path.resolve(prefs().folder);if(path.dirname(path.resolve(file))!==folder)throw Error('저장된 영상만 열 수 있습니다.');shell.showItemInFolder(file);});
  ipcMain.handle('upload:open',async(_,platform)=>{if(!Object.hasOwn(UPLOAD,platform))throw Error('지원하지 않는 플랫폼입니다.');await shell.openExternal(UPLOAD[platform]);});
  win.on('close',e=>{if(active){e.preventDefault();dialog.showMessageBox(win,{type:'info',message:'작업을 취소하거나 저장이 끝난 뒤 종료해 주세요.'});}});
});
app.on('window-all-closed',()=>app.quit());
