// Public source contains a neutral sample. Personal user images stay in private media storage.
const fs=require('node:fs'),path=require('node:path');const {Resvg}=require('@resvg/resvg-js');
const dir=path.resolve(__dirname,'../assets');const source=fs.readFileSync(path.join(dir,'default-emoji.svg'));
const png=new Resvg(source).render().asPng();
for(const file of ['avatar-closed.png','avatar-open.png'])if(!fs.existsSync(path.join(dir,file)))fs.writeFileSync(path.join(dir,file),png);
