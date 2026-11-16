'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {normalizeAvatar}=require('./engine');
function convert(args){return new Promise((resolve,reject)=>{const ffmpeg=process.env.EMOJI_FFMPEG||(process.platform==='win32'?path.join(__dirname,'vendor','ffmpeg.exe'):'ffmpeg');const p=spawn(ffmpeg,['-hide_banner','-loglevel','error','-y',...args],{windowsHide:true});let error='';p.stderr.on('data',b=>error=(error+b).slice(-3000));p.on('error',reject);p.on('close',code=>code?reject(Error(error||'미디어 변환 실패')):resolve());});}
async function importMusic(source,directory){
  if(fs.statSync(source).size>1024*1024*1024)throw Error('배경음 파일은 1GB 이하여야 합니다.');
  fs.mkdirSync(directory,{recursive:true});const id=crypto.createHash('sha256').update(source).update(String(fs.statSync(source).mtimeMs)).digest('hex'),file=path.join(directory,id+'.m4a');
  if(!fs.existsSync(file)){try{await convert(['-i',source,'-map','0:a:0','-vn','-c:a','aac','-b:a','192k','-ar','48000','-ac','2',file+'.tmp.m4a']);fs.renameSync(file+'.tmp.m4a',file);}catch{fs.rmSync(file+'.tmp.m4a',{force:true});throw Error('소리를 읽지 못했습니다. AVI·MP4는 오디오 트랙이 있는 파일이어야 합니다.');}}
  return {file,name:path.basename(source)};
}
async function importPhoto(source,directory){
  if(fs.statSync(source).size>20*1024*1024)throw Error('사진은 한 장에 20MB 이하여야 합니다.');
  fs.mkdirSync(directory,{recursive:true});const id=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),file=path.join(directory,id+'.png');
  if(!fs.existsSync(file))await normalizeAvatar(source,file);
  return {id,file,name:path.basename(source)};
}
module.exports={importMusic,importPhoto,convert};
