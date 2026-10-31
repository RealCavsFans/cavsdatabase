import fs from 'node:fs';
const C='UCcGbex5p0EHdYQq_8WHlVEg';const out={};
for(const u of [`https://www.youtube.com/feeds/videos.xml?channel_id=${C}`,`https://www.youtube.com/feeds/videos.xml?playlist_id=UU${C.slice(2)}`]){
 try{const r=await fetch(u,{headers:{'user-agent':'Mozilla/5.0 (compatible; cavsdatabase.com video feed)'}});const t=await r.text();out[u]={status:r.status,len:t.length,entries:[...t.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([,e])=>({id:(e.match(/<yt:videoId>(.*?)</)||[])[1],title:(e.match(/<title>([\s\S]*?)<\/title>/)||[])[1],published:(e.match(/<published>(.*?)</)||[])[1],views:(e.match(/views="(\d+)"/)||[])[1]}))}}catch(e){out[u]={err:e.message}}}
fs.mkdirSync('scratch-out',{recursive:true});fs.writeFileSync('scratch-out/rcfyt.json',JSON.stringify(out,null,1));console.log(JSON.stringify(out).slice(0,3000));
