import fs from 'fs';
const N=["Rashaun Agee","Zack Austin","Lydell Elmore","Tristan Enaruna","Curtis Jones","Ian Martinez","Sean McNeil","Riley Minix","Marlon Moore","Norchad Omier","Kadary Richmond","Jaxson Robinson","Tre'Von Spillers","Markhi Strickland","Ernest Udeh Jr.","C.J. White","Noam Yaacov"];
const UA={headers:{'user-agent':'Mozilla/5.0 (compatible; cavsdatabase.com research)'}};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=async u=>{for(let i=0;i<3;i++){try{const r=await fetch(u,{...UA,redirect:'follow'});const t=await r.text();return {url:r.url,status:r.status,t}}catch(e){await sleep(5000)}}return {url:u,status:0,t:''}};
const out={};
for(const n of N){const o=out[n]={};
  for(const [site,base] of [['bbr','https://www.basketball-reference.com/search/search.fcgi?search='],['cbb','https://www.sports-reference.com/cbb/search/search.fcgi?search=']]){
    await sleep(4500);const r=await get(base+encodeURIComponent(n.replace(/['’]/g,'')));o[site+'_url']=r.url;o[site+'_status']=r.status;
    let t=r.t;
    if(/search\.fcgi/.test(r.url)){const hits=[...t.matchAll(/<div class="search-item-name">\s*<strong>\s*<a href="([^"]+)">([^<]+)<\/a>/g)].map(m=>[m[1],m[2]]);o[site+'_hits']=hits.slice(0,6);
      const pick=hits.find(h=>site==='bbr'?/\/(players|gleague\/players)\//.test(h[0]):/\/cbb\/players\//.test(h[0]));if(pick){await sleep(4500);const r2=await get((site==='bbr'?'https://www.basketball-reference.com':'https://www.sports-reference.com')+pick[0]);o[site+'_url']=r2.url;t=r2.t}else t=''}
    const b=t.match(/data-birth="(\d{4}-\d\d-\d\d)"/);if(b)o[site+'_birth']=b[1];
    const d=t.match(/<strong>\s*Draft:\s*<\/strong>([\s\S]{0,600}?)<\/p>/);if(d)o[site+'_draft']=d[1].replace(/<a href="([^"]+)">/g,'[$1]').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
    const dl=t.match(/href="(\/draft\/NBA_\d{4}\.html)"/);if(dl)o[site+'_draftlink']=dl[1];
    const seasons=[...t.matchAll(/<th scope="row" class="left " data-stat="(?:year_id|season)"[^>]*>(?:<a[^>]*>)?(\d{4}-\d{2})/g)].map(m=>m[1]);if(seasons.length)o[site+'_seasons']=[...new Set(seasons)];
    const meta=(t.match(/<div id="meta">([\s\S]{0,3000}?)<\/div>\s*<\/div>/)||[])[1];if(meta)o[site+'_meta']=meta.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,700);
  }
  console.log(n,JSON.stringify(o).slice(0,300));
}
fs.mkdirSync('scratch-out',{recursive:true});fs.writeFileSync('scratch-out/charge-bio.json',JSON.stringify(out,null,1));
