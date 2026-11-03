/* cavsdatabase.com live game core: turns an ESPN game summary into team, player, lineup, shot and possession stats.
   Shared by /live.html, /embed/live.html and the nightly archive job (scripts/live-archive.mjs). */
'use strict';
/* league FG% and shot share by zone, 2025–26 (pbpstats team totals) */
const LG={AtRim:[.6726,.2805],ShortMidRange:[.444,.2267],LongMidRange:[.4118,.0747],Corner3:[.3868,.107],Arc3:[.3445,.311]};
const normName=n=>n.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g,'').replace(/[^a-z]/g,'');
const PT=[['putback','Putbacks and tip-ins'],['trans','Transition'],['cut','Cuts and lobs'],['drive','Drives'],['post','Post-ups and turnarounds'],['pull','Pull-ups and step-backs'],['spot','Spot-up jumpers'],['fin','Other layups and dunks']];
const ZN=[['AtRim','At the rim','0–4 ft'],['ShortMidRange','Short midrange','4–14 ft'],['LongMidRange','Long midrange','14+ ft'],['Corner3','Corner 3',''],['Arc3','Above-the-break 3','']];
/* ---------- time helpers ---------- */
const plen=p=>p<=4?720:300;
const pstart=p=>p<=4?(p-1)*720:2880+(p-5)*300;
const csec=c=>{const s=String(c||0);if(s.includes(':')){const[m,x]=s.split(':');return +m*60+ +x}return +s};
const gt=(p,c)=>pstart(p)+plen(p)-csec(c);
const pname=p=>p<=4?'Q'+p:(p===5?'OT':'OT'+(p-4));
const perAt=t=>t<2880?1+Math.floor(t/720):5+Math.floor((t-2880)/300);
const fmtMin=s=>{s=Math.round(s);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
const pct=(m,a,d=0)=>a?(m/a*100).toFixed(d)+'%':'–';
const sgn=v=>(v>0?'+':v<0?'−':'')+Math.abs(v);
const PERS=[['all','Game'],['h1','1st half'],['h2','2nd half'],null,['1','Q1'],['2','Q2'],['3','Q3'],['4','Q4'],['ot','OT'],null,['clutch','Clutch']];
const eqSet=(a,b)=>a.length===b.length&&a.every(x=>b.includes(x));
const inPer=(f,p)=>Array.isArray(f)?f.includes(Math.min(p,5)):f==='all'||f==='nogt'||(f==='h1'&&p<=2)||(f==='h2'&&p>=3)||(f==='ot'&&p>4)||String(p)===f;
const perLabel=f=>Array.isArray(f)?(eqSet(f,[1,2])?'1st half':eqSet(f,[3,4,5])||eqSet(f,[3,4])?'2nd half':f.length===1?(f[0]===5?'Overtime':'Quarter '+f[0]):f.slice().sort().map(p=>p===5?'OT':'Q'+p).join(' + ')):({all:'Full game',h1:'1st half',h2:'2nd half (incl. OT)',ot:'Overtime',clutch:'Clutch: last 5 minutes, score within 5',nogt:'Without garbage time'})[f]||'Quarter '+f;

/* ---------- prepare ---------- */
function lastName(n){const p=n.replace(/ (Jr\.|Sr\.|II|III|IV)$/,'').split(' ');return p.length>1?p.slice(1).join(' '):n}
/* archived games store plays and win probability as compact rows (pv:2, from slimSummary); turn them back into ESPN's shape */
function unpackSlim(d){if(!d||d.pv!==2)return d;const o=Object.assign({},d);delete o.pv;
  o.plays=(d.plays||[]).map(r=>({id:r[0],type:{text:r[1]},text:r[2],period:{number:r[3]},clock:{displayValue:r[4]},team:r[5]?{id:r[5]}:undefined,participants:r[6]?r[6].split(',').map(i=>({athlete:{id:i}})):undefined,homeScore:r[7],awayScore:r[8],scoringPlay:!!(r[9]&1),shootingPlay:!!(r[9]&2),scoreValue:r[10],pointsAttempted:r[11]==null?undefined:r[11],coordinate:r[12]==null?undefined:{x:r[12],y:r[13]},zh:r[14]==null?undefined:r[14]}));
  o.winprobability=(d.winprobability||[]).map(r=>({playId:r[0],homeWinPercentage:r[1]}));return o}
function prep(d){d=unpackSlim(d);
  const comp=d.header.competitions[0];
  const teams=comp.competitors.map(c=>({id:c.id,ha:c.homeAway,abbr:c.team.abbreviation,name:c.team.shortDisplayName||c.team.name,loc:c.team.location,logo:'/img/tl/'+String(c.team.abbreviation||'').toLowerCase()+'.png',logo2:(c.team.logos&&c.team.logos[0]&&c.team.logos[0].href)||'',score:+(c.score||0),rec:(c.record&&c.record[0]&&c.record[0].summary)||''}));
  const home=teams.find(t=>t.ha==='home'),away=teams.find(t=>t.ha==='away');
  const focus=teams.find(t=>t.id===CLE)||home,other=teams.find(t=>t!==focus);
  focus.c='#860038';other.c='#5b6470';focus.c2='color-mix(in srgb,#860038 22%,#fff)';other.c2='color-mix(in srgb,#5b6470 22%,#fff)';
  const P={},roster={};teams.forEach(t=>roster[t.id]=[]);
  (d.boxscore&&d.boxscore.players||[]).forEach(tb=>{const st=tb.statistics[0]||{};const names=st.names||[];(st.athletes||[]).forEach(a=>{
    const s={};names.forEach((n,i)=>s[n]=a.stats?a.stats[i]:null);
    P[a.athlete.id]={id:a.athlete.id,name:a.athlete.displayName,short:a.athlete.shortName,last:lastName(a.athlete.displayName),pos:a.athlete.position&&a.athlete.position.abbreviation,team:tb.team.id,nba:!!a.athlete.nba,starter:!!a.starter,dnp:!!a.didNotPlay,reason:a.reason,espn:s};
    roster[tb.team.id].push(a.athlete.id)})});
  const plays=(d.plays||[]).map(q=>({id:q.id,type:q.type.text.replace(/\n/g,' '),text:q.text,per:q.period.number,clock:q.clock.displayValue,t:gt(q.period.number,q.clock.displayValue),team:q.team&&q.team.id,ids:(q.participants||[]).map(x=>x.athlete.id),hs:q.homeScore,as:q.awayScore,sc:q.scoringPlay,val:q.scoreValue,shot:q.shootingPlay,pa:q.pointsAttempted,x:q.coordinate&&q.coordinate.x>-100?q.coordinate.x:null,y:q.coordinate&&q.coordinate.y>-100?q.coordinate.y:null,zh:q.zh}));
  /* ESPN's running score on each play sometimes drifts (Oct 26 vs MIN: it ended 125-124 MIN, the real final was 127-125 CLE).
     Keep our own running tally from the scoring plays, and use it whenever it lands on the scoreboard's score. */
  {let h=0,a=0;const run=plays.map(p=>{if(p.sc&&p.val>0){const t=p.team||(P[p.ids[0]]||{}).team;if(t===home.id)h+=p.val;else if(t===away.id)a+=p.val}return [h,a]});
    const lp=plays[plays.length-1];if(lp&&h===home.score&&a===away.score&&(lp.hs!==h||lp.as!==a))plays.forEach((p,i)=>{p.hs=run[i][0];p.as=run[i][1]})}
  const wp={};(d.winprobability||[]).forEach(w=>wp[w.playId]=w.homeWinPercentage);
  const esp={};((d.boxscore&&d.boxscore.teams)||[]).forEach(tb=>{const g=n=>{const x=(tb.statistics||[]).find(y=>y.name===n);return x&&x.displayValue!==''&&!isNaN(+x.displayValue)?+x.displayValue:null};esp[tb.team.id]={pot:g('turnoverPoints'),fb:g('fastBreakPoints'),pip:g('pointsInPaint')}});
  return {esp,teams,home,away,focus,other,P,roster,plays,wp,status:comp.status||{},date:comp.date,venue:d.gameInfo&&d.gameInfo.venue&&d.gameInfo.venue.fullName,bc:(comp.broadcasts||[]).map(b=>b.media&&b.media.shortName).filter(Boolean)};
}

/* ---------- derive: one pass over the revealed plays ---------- */
const zT=()=>({pts:0,fgm:0,fga:0,tpm:0,tpa:0,ftm:0,fta:0,oreb:0,dreb:0,toreb:0,tdreb:0,ast:0,stl:0,blk:0,to:0,pf:0,paint:0,second:0,offto:0,sec:0,stPts:0,bnPts:0,stSec:0,bnSec:0,and1:0,ftTrips:0,z:ZN.map(()=>[0,0])});
const zP=()=>({min:0,pts:0,fgm:0,fga:0,tpm:0,tpa:0,ftm:0,fta:0,oreb:0,dreb:0,ast:0,stl:0,blk:0,to:0,pf:0,pm:0,played:false,on:false});
/* np = counted possessions (each ends when the other team gets the ball or the period ends); poss() uses it when present, the estimate formula otherwise */
const zS=()=>({fga:0,oreb:0,to:0,fta:0,fgm:0,tpa:0,tpm:0,ftm:0,ast:0,dreb:0,np:0});const zL=ids=>({ids,sec:0,pf:0,pa:0,o:zS(),d:zS()});
/* box estimate uses player offensive rebounds only (team rebounds include dead balls after missed free throws), the same way the league box scores count, so our ratings and the NBA ranks line up (Oct 28) */
const poss=o=>o.np!=null&&o.np>0?o.np:o.fga-o.oreb+o.to+0.44*o.fta;
function zoneOf(x,y,three){const d=Math.hypot(x-25,y);if(three)return y<=C3?3:4;if(d<4)return 0;if(d<14)return 1;return 2}
function combos(a,k){const r=[];const f=(s,c)=>{if(c.length===k){r.push(c.slice());return}for(let i=s;i<a.length;i++){c.push(a[i]);f(i+1,c);c.pop()}};f(0,[]);return r}
function deriveCore(D,plays,F){
  const tid=[D.home.id,D.away.id],opp=t=>t===tid[0]?tid[1]:tid[0];
  const teamOf=id=>D.P[id]&&D.P[id].team;
  const B={};Object.keys(D.P).forEach(id=>B[id]=zP());
  const T={},TQ={};tid.forEach(t=>T[t]=zT());
  const tq=(per,t)=>{TQ[per]=TQ[per]||{};return TQ[per][t]=TQ[per][t]||zT()};
  /* lineup inference: who starts each period */
  const byPer={};plays.forEach(p=>(byPer[p.per]=byPer[p.per]||[]).push(p));
  const startFive={};let prevEnd={};tid.forEach(t=>prevEnd[t]=D.roster[t].filter(id=>D.P[id].starter));
  Object.keys(byPer).map(Number).sort((a,b)=>a-b).forEach(per=>{startFive[per]={};tid.forEach(t=>{
    const first={},order=[];byPer[per].forEach(p=>p.ids.forEach((id,i)=>{if(teamOf(id)!==t||first[id])return;const sin=p.type==='Substitution'&&i===0;first[id]=sin?'in':'on';if(!sin)order.push(id)}));
    let five=order.slice(0,5);
    if(per===1){const st=D.roster[t].filter(id=>D.P[id].starter);five=st.length===5?st:five.concat(st.filter(x=>!five.includes(x))).slice(0,5)}
    else if(five.length<5)prevEnd[t].forEach(id=>{if(five.length<5&&!five.includes(id)&&first[id]!=='in')five.push(id)});
    startFive[per][t]=five;
    /* end-of-period five for the next fill */
    const on=new Set(five);byPer[per].forEach(p=>{if(p.type==='Substitution'&&p.ids[0]&&p.ids[1]&&teamOf(p.ids[0])===t){on.delete(p.ids[1]);on.add(p.ids[0])}});prevEnd[t]=[...on]})});
  /* walk */
  const on={};tid.forEach(t=>on[t]=new Set());
  const L={};tid.forEach(t=>L[t]={2:{},3:{},4:{},5:{}});
  const lkCache={};
  const lineKeys=(t,set)=>{const ids=[...set].sort();const k=t+'|'+ids.join(',');if(lkCache[k])return lkCache[k];const out=[];[2,3,4,5].forEach(n=>{if(ids.length>=n)combos(ids,n).forEach(c=>out.push([n,c.join(','),c]))});return lkCache[k]=out};
  const lu=(t,set,fn)=>lineKeys(t,set).forEach(([n,k,c])=>{const o=L[t][n][k]=L[t][n][k]||zL(c);fn(o)});
  const stints={},enter={},pmAll={};Object.keys(D.P).forEach(id=>pmAll[id]=0);
  let last=0,curPer=0,snap=null;const src={},ps={},pc={},tf={},to={},ch={},pfAll={};let clutchNow=false,mgNow=0;const wpS=[],lineAt={};
  const HOW=['stl','to','dreb','made','oreb','start'];tid.forEach(t=>{src[t]='';ps[t]={t:0,how:'start'};pc[t]={};HOW.forEach(h=>pc[t][h]={n:0,pts:0});to[t]=0;ch[t]={used:0,won:0}});
  /* garbage time (published rule): 4th quarter, a lead of 25+ with 9–12 minutes left, 20+ with 6–9 left, or 15+ with under 6 left; overtime never counts */
  let gtNow=false;const isGT=(per,t,m)=>{if(per!==4)return false;const left=2880-t,a=Math.abs(m);return left>540?a>=25:left>360?a>=20:a>=15};
  const inFx=per=>F==='clutch'?clutchNow:F==='nogt'?!gtNow:inPer(F,per);
  /* a possession that ends on free throws belongs to the ten players on the floor at the foul, like the points (Oct 31) */let hold=null,curON=null;const endPoss=(t,inF)=>{if(!inF||!t)return;const W=curON||on;if(seg)seg.o[t].np++;lu(t,W[t],o=>o.o.np++);lu(opp(t),W[opp(t)],o=>o.d.np++)};
  const PL=[];const newPoss=(t,tt,how,inF)=>{if(ps[t]&&ps[t].t===tt&&ps[t].how===how&&how!=='oreb')return;if(how!=='start'){if(how!=='oreb'&&hold===opp(t))endPoss(opp(t),inF);hold=t}ps[t]={t:tt,how,pts:0,first:null,inF,on:on[t]?[...on[t]].sort().join(','):'',od:on[opp(t)]?[...on[opp(t)]].sort().join(','):''};if(inF){pc[t][how].n++;PL.push(Object.assign(ps[t],{team:t}))}};
  const margin=[[0,0]];let lc=0,ties=0,prevSign=0;const lead={};tid.forEach(t=>lead[t]=0);
  const shots=[],asts=[];const lastFG={},lastPt={},dr=[];let lastMade=null;
  /* segments: every stretch with the same ten players on the floor (for player-vs-opponent on/off) */
  const segs=[];let seg=null;const newSeg=()=>{seg={a:{},sec:0,pts:{},pp:{},o:{}};tid.forEach(t=>{seg.a[t]=[...on[t]];seg.pts[t]=0;seg.o[t]={fga:0,oreb:0,to:0,fta:0,np:0}});segs.push(seg)};
  const addTime=t1=>{const dt=t1-last;if(dt>0){const inF=inFx(curPer);if(inF&&seg)seg.sec+=dt;tid.forEach(t=>{const q=tq(curPer,t);q.sec+=dt;on[t].forEach(id=>{if(D.P[id].starter)q.stSec+=dt;else q.bnSec+=dt});if(inF){T[t].sec+=dt;on[t].forEach(id=>{B[id].min+=dt;if(D.P[id].starter)T[t].stSec+=dt;else T[t].bnSec+=dt});lu(t,on[t],o=>o.sec+=dt)}})}last=Math.max(last,t1)};
  const leave=(id,t1)=>{if(enter[id]!=null){(stints[id]=stints[id]||[]).push([enter[id][0],t1,pmAll[id]-enter[id][1]]);delete enter[id]}};
  const join=(id,t1)=>{enter[id]=[t1,pmAll[id]]};
  plays.forEach(p=>{curON=null;
    if(p.per!==curPer){if(curPer){addTime(pstart(curPer)+plen(curPer));endPoss(hold,inFx(curPer));hold=null;tid.forEach(t=>on[t].forEach(id=>leave(id,pstart(curPer)+plen(curPer))))}
      curPer=p.per;last=pstart(p.per);tid.forEach(t=>{on[t]=new Set(startFive[p.per][t]||[]);on[t].forEach(id=>{B[id].played=true;join(id,last)});src[t]='';ps[t]={t:last,how:'init',pts:0,first:null,inF:false,on:'',od:''}});newSeg()}
    clutchNow=p.per>=4&&(p.per>4||p.t>=2580)&&Math.abs(mgNow)<=5;gtNow=isGT(p.per,p.t,mgNow);
    addTime(p.t);
    const inF=inFx(p.per);/* each player's own box score inside his 2-man and 5-man units (pb) */const pbA=(id,k,v,ONx)=>{if(!inF||!id||!D.P[id])return;const t=teamOf(id);if(!T[t])return;lu(t,(ONx||on)[t],o=>{if(o.ids.length!==2&&o.ids.length!==5)return;const q=(o.pb=o.pb||{})[id]=(o.pb[id]||{});q[k]=(q[k]||0)+v})};const ty=p.type,a=p.ids[0],b=p.ids[1];
    if(D.wp[p.id]!=null)wpS.push([p.t,D.wp[p.id],p]);
    if(/Timeout/.test(ty)&&!/Official/.test(ty)&&T[p.team])to[p.team]++;
    if(ty==='Challenge'&&T[p.team])ch[p.team].used++;if(/Challenge \((Overturned|Successful)/i.test(ty)&&T[p.team])ch[p.team].won++;
    const TT=t=>inF?[T[t],tq(p.per,t)]:[tq(p.per,t)];
    const offStat=(t,k,ON)=>{if(!inF)return;if(seg)seg.o[t][k]++;lu(t,(ON||on)[t],o=>o.o[k]++);lu(opp(t),(ON||on)[opp(t)],o=>o.d[k]++)};
    /* lineup-only counts for the full advanced spread (makes, threes, assists, defensive boards) */
    const luStat=(t,k,ON)=>{if(!inF||!t)return;lu(t,(ON||on)[t],o=>o.o[k]=(o.o[k]||0)+1);lu(opp(t),(ON||on)[opp(t)],o=>o.d[k]=(o.d[k]||0)+1)};
    if(ty==='Substitution'){if(a&&b){const t=teamOf(a);if(t){on[t].delete(b);on[t].add(a);B[a].played=true;leave(b,p.t);join(a,p.t);newSeg()}}return}
    const isFT=/^Free Throw/.test(ty);
    /* the period's first possession: whoever first shoots or turns it over had the ball from the start of the period (Oct 28) */
    {const tt=p.team&&T[p.team]?p.team:teamOf(a);if(hold===null&&tt&&T[tt]&&((p.shot&&!/Technical/.test(ty))||(/Turnover|^Traveling|Double Dribble|Discontinued? Dribble|Offensive Goaltending|Palming|Backcourt|3-Second Violation$|Inbound/.test(ty)&&!/Kicked|Defensive/.test(ty)))){newPoss(tt,pstart(p.per),'start',inF);hold=tt}}
    {const tt=p.team&&T[p.team]?p.team:teamOf(a);if(tt&&ps[tt]&&ps[tt].first==null&&(p.shot||/Turnover|Foul/.test(ty)))ps[tt].first=p.t-ps[tt].t}
    if(/Foul/.test(ty)&&!/Offensive|Technical/.test(ty)){snap={t:p.t,per:p.per,on:{}};tid.forEach(x=>snap.on[x]=new Set(on[x]))}
    const ftSnap=isFT&&!/Technical/.test(ty)&&snap&&snap.t===p.t&&snap.per===p.per;const ON=ftSnap?snap.on:on;curON=ftSnap?snap.on:null;
    if(p.shot&&a&&B[a]&&!/Heave/.test(ty)){const t=teamOf(a);
      if(isFT&&/ 1 of /.test(ty)&&inF)TT(t).forEach(x=>{x.ftTrips++;if(/1 of 1/.test(ty)&&lastMade&&lastMade.id===a&&lastMade.t===p.t)x.and1++});
      if(!isFT&&p.sc){lastMade={id:a,t:p.t};const g=p.t-(lastFG[t]!=null?lastFG[t]:pstart(1));if(g>=180)dr.push({t,kind:'fg',from:lastFG[t]!=null?lastFG[t]:0,to:p.t});lastFG[t]=p.t}
      if(isFT){if(inF){B[a].fta++;pbA(a,'fta',1,ON);if(p.sc){B[a].ftm++;pbA(a,'ftm',1,ON)}}TT(t).forEach(x=>{x.fta++;if(p.sc)x.ftm++});offStat(t,'fta',ON);if(p.sc)luStat(t,'ftm',ON)}
      else{const three=p.pa===3;const zi=p.x!=null?zoneOf(p.x,p.y,three):p.zh!=null&&(p.zh>=3)===three?p.zh:(three?4:1);const paint=!three&&p.x!=null&&Math.abs(p.x-25)<=8&&p.y<=13.75;
        if(inF){(B[a].fga++,pbA(a,'fga',1));if(three)(B[a].tpa++,pbA(a,'tpa',1));if(p.sc){(B[a].fgm++,pbA(a,'fgm',1));if(three)(B[a].tpm++,pbA(a,'tpm',1))}}
        TT(t).forEach(x=>{x.fga++;x.z[zi][1]++;if(three)x.tpa++;if(p.sc){x.fgm++;x.z[zi][0]++;if(three)x.tpm++;if(paint)x.paint+=2}});offStat(t,'fga');if(three)luStat(t,'tpa');if(p.sc){luStat(t,'fgm');if(three)luStat(t,'tpm');if(b&&/assists/.test(p.text))luStat(t,'ast')}
        if(p.sc&&b&&/assists/.test(p.text)&&B[b]){if(inF){(B[b].ast++,pbA(b,'ast',1));asts.push({t,p:b,s:a,v:three?3:2,z:zi})}TT(t).forEach(x=>x.ast++)}
        else if(!p.sc&&b&&/blocks/.test(p.text)&&B[b]){if(inF)(B[b].blk++,pbA(b,'blk',1));TT(teamOf(b)).forEach(x=>x.blk++)}
        if(inF){const st=ps[t],dt=p.t-st.t;const pt=/Putback|Tip/.test(ty)||(st.how==='oreb'&&dt<=3)?0:((st.how==='dreb'||st.how==='to'||st.how==='stl')&&dt<=7)?1:/Cutting|Alley Oop/.test(ty)?2:/Driving/.test(ty)?3:/Hook|Turnaround|Fade Away|Post/.test(ty)?4:/Pullup|Step Back/.test(ty)?5:/Jump Shot/.test(ty)?6:7;
          shots.push({t,on:[...on[t]].sort().join(','),od:[...on[opp(t)]].sort().join(','),id:a,x:p.x,y:p.y,hasXY:p.x!=null,m:!!p.sc,three,zi,pt,ast:!!(p.sc&&b&&/assists/.test(p.text)),per:p.per,clock:p.clock,text:p.text})}}}
    if(p.sc&&p.val>0){const t=p.team&&T[p.team]?p.team:teamOf(a);if(t){
      if(inF&&a&&B[a])(B[a].pts+=p.val,pbA(a,'pts',p.val,ON));if(inF&&seg){seg.pts[t]+=p.val;if(a)seg.pp[a]=(seg.pp[a]||0)+p.val}if(inF&&pc[t][ps[t].how])pc[t][ps[t].how].pts+=p.val;if(ps[t])ps[t].pts+=p.val;lineAt[p.id]={[t]:[...ON[t]],[opp(t)]:[...ON[opp(t)]]};TT(t).forEach(x=>{x.pts+=p.val;if(a&&D.P[a]){if(D.P[a].starter)x.stPts+=p.val;else x.bnPts+=p.val}if(src[t].includes('2nd'))x.second+=p.val;if(src[t].includes('to'))x.offto+=p.val});
      const o=opp(t);ON[t].forEach(id=>{pmAll[id]+=p.val;if(inF)B[id].pm+=p.val});ON[o].forEach(id=>{pmAll[id]-=p.val;if(inF)B[id].pm-=p.val});
      if(inF){lu(t,ON[t],x=>x.pf+=p.val);lu(o,ON[o],x=>x.pa+=p.val)}
      if(!isFT||/(\d) of \1/.test(ty)){src[o]='';newPoss(o,p.t,'made',inF)}}}
    if(/Rebound/.test(ty)){const off=/Offensive/.test(ty);const t=a&&B[a]?teamOf(a):p.team;
      if(t&&T[t]){if(a&&B[a]){if(inF)(B[a][off?'oreb':'dreb']++,pbA(a,off?'oreb':'dreb',1));TT(t).forEach(x=>x[off?'oreb':'dreb']++)}else TT(t).forEach(x=>x[off?'toreb':'tdreb']++);
        if(off){offStat(t,'oreb');src[t]=(src[t].includes('to')?'to':'')+'2nd';newPoss(t,p.t,'oreb',inF)}else{luStat(t,'dreb');src[t]='';newPoss(t,p.t,'dreb',inF)}}}
    if(/Turnover|^Traveling|Double Dribble|Discontinued? Dribble|Offensive Goaltending|Palming|Backcourt|3-Second Violation$|Inbound/.test(ty)&&!/Kicked|Defensive/.test(ty)){
      const t=p.team||teamOf(a);if(T[t]){TT(t).forEach(x=>x.to++);if(inF&&a&&B[a]&&teamOf(a)===t)(B[a].to++,pbA(a,'to',1));offStat(t,'to');src[opp(t)]='to';newPoss(opp(t),p.t,b&&/steals/.test(p.text)?'stl':'to',inF)}
      if(b&&/steals/.test(p.text)&&B[b]){if(inF)(B[b].stl++,pbA(b,'stl',1));TT(teamOf(b)).forEach(x=>x.stl++)}}
    else if(/Foul|Offensive Charge/.test(ty)&&!/Technical|Double Technical/.test(ty)&&a&&B[a]){/* Nov 2: charges are personal fouls too */if(inF)B[a].pf++;pfAll[a]=(pfAll[a]||0)+1;TT(teamOf(a)).forEach(x=>x.pf++);
      if(!/Offensive/.test(ty)){const k=p.per,tt=teamOf(a);tf[k]=tf[k]||{};const q=tf[k][tt]=tf[k][tt]||{n:0,l2:0};q.n++;if(pstart(k)+plen(k)-p.t<=120)q.l2++}}
    if(p.sc){const m=D.focus.ha==='home'?p.hs-p.as:p.as-p.hs;mgNow=m;margin.push([p.t,m]);const sg=Math.sign(m);if(sg===0&&prevSign!==0)ties++;if(sg&&prevSign&&sg!==prevSign)lc++;if(sg)prevSign=sg;
      if(m>lead[D.focus.id])lead[D.focus.id]=m;if(-m>lead[D.other.id])lead[D.other.id]=-m}
  });
  const lp=plays[plays.length-1];
  const curStint={};if(lp)tid.forEach(t=>on[t].forEach(id=>{if(enter[id]){let from=enter[id][0],pm=pmAll[id]-enter[id][1];const st=stints[id]||[];for(let i=st.length-1;i>=0&&st[i][1]===from;i--){from=st[i][0];pm+=st[i][2]}curStint[id]={from,sec:lp.t-from,pm}}}));
  if(lp)tid.forEach(t=>{const g=lp.t-(lastFG[t]!=null?lastFG[t]:0);if(g>=180)dr.push({t,kind:'fg',from:lastFG[t]!=null?lastFG[t]:0,to:lp.t,open:true})});
  if(lp){addTime(lp.t);if(lp.type==='End Period'||lp.type==='End Game')endPoss(hold,inFx(lp.per));const endT=lp.type==='End Period'||lp.type==='End Game'?pstart(lp.per)+plen(lp.per):lp.t;tid.forEach(t=>on[t].forEach(id=>{B[id].on=true;leave(id,endT)}));tid.forEach(t=>on[t].forEach(id=>{}))}
  /* runs */
  const runs=[];let run=null;
  plays.forEach(p=>{if(!(p.sc&&p.val>0))return;const t=p.team&&T[p.team]?p.team:teamOf(p.ids[0]);if(!t)return;
    if(run&&run.t===t){run.pts+=p.val;run.end=p}else{if(run&&run.pts>=8)runs.push(run);run={t,pts:p.val,start:p,end:p}}});
  if(run&&run.pts>=8)runs.push(Object.assign(run,{open:true}));
  /* counted possessions (each team's possessions in the stretch, not counting offensive-rebound continuations) */
  tid.forEach(t=>{T[t].np=PL.filter(q=>q.team===t&&q.how!=='oreb').length});
  const PLx=PL.filter(q=>q.first!=null||q.pts>0);
  return {PL:PLx,segs,curStint,dr,pmAll,pc,tf,to,ch,pfAll,wpS,lineAt,asts,plays,B,T,TQ,L,on,margin,runs,shots,stints,hs:lp?lp.hs:0,as:lp?lp.as:0,lp,lead,lc,ties,wp:lp&&D.wp[lp.id]!=null?D.wp[lp.id]:null,maxPer:lp?Math.max(4,lp.per):4};
}

/* NBA.com definitions: TOV% = TOV / (FGA + 0.44 FTA + TOV); OREB% = player offensive rebounds / (them + opponent player defensive rebounds) (Oct 28) */
function factors(a,b){const pa=poss({fga:a.fga,oreb:a.oreb,to:a.to,fta:a.fta,np:a.np});
  return {efg:a.fga?(a.fgm+0.5*a.tpm)/a.fga:null,tov:(a.fga+0.44*a.fta+a.to)?a.to/(a.fga+0.44*a.fta+a.to):null,orb:(a.oreb+b.dreb)?a.oreb/(a.oreb+b.dreb):null,ftr:a.fga?a.ftm/a.fga:null}}
const FF=[['efg','Shooting','Effective FG%',true],['tov','Ball security','Turnover rate',false],['orb','Second chances','Offensive rebound rate',true],['ftr','Getting to the line','Free throws made per FGA',true]];
const CLE='5',C3=Math.sqrt(23.75**2-22**2);

/* ---------- game highs (Nov 1): "most since", career and season highs for the recap ----------
   one game's line: {et, t:{pts,reb,ast,fgm,tpm,stl,blk}, p:{espnId:{n:name, ...same}}}. prior = this season's earlier games,
   H = pdata/highs-hist.json (Basketball Reference game logs through last season, kept as a staircase per stat). */
const HI_W={pts:'points',reb:'rebounds',ast:'assists',fgm:'made field goals',tpm:'made threes',stl:'steals',blk:'blocks'};
const HI_MIN={pts:20,reb:10,ast:8,fgm:8,tpm:4,stl:3,blk:3};
const HI_TM={ATL:'Atlanta',BOS:'Boston',BRK:'Brooklyn',NJN:'New Jersey',CHO:'Charlotte',CHA:'Charlotte',CHH:'Charlotte',CHI:'Chicago',CLE:'Cleveland',DAL:'Dallas',DEN:'Denver',DET:'Detroit',GSW:'Golden State',HOU:'Houston',IND:'Indiana',LAC:'the Clippers',LAL:'the Lakers',MEM:'Memphis',VAN:'Vancouver',MIA:'Miami',MIL:'Milwaukee',MIN:'Minnesota',NOP:'New Orleans',NOH:'New Orleans',NOK:'New Orleans',NYK:'New York',OKC:'Oklahoma City',SEA:'Seattle',ORL:'Orlando',PHI:'Philadelphia',PHO:'Phoenix',POR:'Portland',SAC:'Sacramento',SAS:'San Antonio',TOR:'Toronto',UTA:'Utah',WAS:'Washington',WSB:'Washington'};
const hiDate=d=>new Date(d+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
function highsL(cur,prior,H){
  const out=[],day=d=>Date.parse(d+'T12:00:00Z'),gap=d=>(day(cur.et)-day(d))/864e5;
  /* v against this season's earlier games, then the history staircase. Returns {kind, d, tm, tie} or null */
  const judge=(v,seasonVals,stairs,haveHist,minPrior)=>{
    if(v==null||!(v>0))return null;
    const sMax=seasonVals.length?Math.max(...seasonVals):-1;
    if(sMax>=v)return null;
    if(stairs){const hit=stairs.find(x=>x[1]>=v);
      if(!hit)return haveHist?{kind:'record'}:null;
      const tie=hit[1]===v,i=stairs.indexOf(hit),gt=tie?stairs[i+1]:hit;
      if(tie&&!gt)return {kind:'tie',d:hit[0],tm:hit[2]};
      if(!tie&&gap(hit[0])>=365)return {kind:'since',d:hit[0],tm:hit[2]};
      /* tied a recent game: say so, with the last time anyone went higher */
      if(tie&&gap(gt[0])>=365)return {kind:'tiesince',d:gt[0],tm:gt[2],d2:hit[0],tm2:hit[2]}}
    return seasonVals.length>=minPrior?{kind:'season'}:null};
  const score=j=>j.kind==='record'?1e6:j.kind==='tie'?9e5:j.kind==='since'||j.kind==='tiesince'?gap(j.d):0;
  const T=H&&H.team;
  for(const k in HI_W){const v=cur.t[k];const j=judge(v,prior.map(g=>g.t[k]).filter(x=>x!=null),T&&T[k],!!T,3);if(!j)continue;
    const w=HI_W[k],txt=j.kind==='record'?(H.teamFrom<=1971?`${v} ${w}, a Cavs regular-season record.`:`${v} ${w}, the most in a Cavs game since at least ${H.teamFrom-1}–${String(H.teamFrom).slice(2)}.`):j.kind==='tie'?`${v} ${w}, tying the Cavs’ most in a game (${hiDate(j.d)}).`:j.kind==='since'?`${v} ${w}, the Cavs’ most in a game since ${hiDate(j.d)}.`:j.kind==='tiesince'?`${v} ${w}, matching ${hiDate(j.d2)} for the Cavs’ most in a game since ${hiDate(j.d)}.`:`${v} ${w}, the Cavs’ most in a game this season.`;
    out.push([score(j)+.5,j.kind==='record'?'Cavs record':j.kind==='tie'?'Ties record':j.kind==='season'?'Season high':'Most since',txt])}
  for(const id in cur.p){const x=cur.p[id];let hp=H&&H.players&&H.players[normName(x.n)];const played=prior.filter(g=>g.p[id]);
    /* career claims need a real career: 15+ games counting this one */
    if(hp&&hp.games+played.length+1<15)hp=null;
    for(const k in HI_W){const v=x[k];if(v==null||v<HI_MIN[k])continue;const j=judge(v,played.map(g=>g.p[id][k]).filter(y=>y!=null),hp&&hp.s[k],!!hp,3);if(!j)continue;
      const w=HI_W[k],wt=t=>t&&t!=='CLE'?` with ${HI_TM[t]||t}`:'',with_=j.tm&&j.tm!=='CLE'?` (with ${HI_TM[j.tm]||j.tm})`:'';
      const txt=j.kind==='record'?`${x.n}: ${v} ${w}, a career high.`:j.kind==='tie'?`${x.n}: ${v} ${w}, tying his career high (${hiDate(j.d)}${wt(j.tm)?','+wt(j.tm):''}).`:j.kind==='since'?`${x.n}: ${v} ${w}, his most since ${hiDate(j.d)}${with_}.`:j.kind==='tiesince'?`${x.n}: ${v} ${w}, matching ${hiDate(j.d2)}${j.tm2!==j.tm?wt(j.tm2):''} for his most since ${hiDate(j.d)}${with_}.`:`${x.n}: ${v} ${w}, his most this season.`;
      out.push([score(j),j.kind==='record'||j.kind==='tie'?'Career high':j.kind==='since'||j.kind==='tiesince'?'Most since':'Season high',txt])}}
  return out.sort((a,b)=>b[0]-a[0]).slice(0,4).map(([,l,t])=>[l,t]);
}
/* one game's line for highsL, from a derived game */
function highLine(D,R){const t=R.T[D.focus.id];const p={};D.roster[D.focus.id].forEach(id=>{const b=R.B[id];if(!(b.min>0))return;p[id]={n:D.P[id].name,pts:b.pts,reb:b.oreb+b.dreb,ast:b.ast,fgm:b.fgm,tpm:b.tpm,stl:b.stl,blk:b.blk}});
  return {et:new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(D.date)),opp:D.other.abbr,t:{pts:t.pts,reb:t.oreb+t.dreb,ast:t.ast,fgm:t.fgm,tpm:t.tpm,stl:t.stl,blk:t.blk},p}}
if(typeof module!=='undefined')module.exports={fromNBA,nbaClock,highsL,highLine,unpackSlim,prep,deriveCore,factors,poss,ZN,PT,LG,normName,pname,fmtMin,inPer,pstart,plen};

/* ---------- NBA.com live feed (Nov 2) ----------
   The NBA's own JSON (nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData/{boxscore,playbyplay}/..._{gameId}.json),
   fetched through our worker (/nba) because the bucket sends no CORS headers. fromNBA turns a box score + play-by-play
   into the same shape as ESPN's summary, so prep() and deriveCore() work unchanged. Players keep their NBA person IDs
   (the league's own index, shared with every other NBA dataset); teams keep the ESPN team IDs the page already uses. */
const NBA_TEAM={ATL:1,BOS:2,BKN:17,CHA:30,CHI:4,CLE:5,DAL:6,DEN:7,DET:8,GSW:9,HOU:10,IND:11,LAC:12,LAL:13,MEM:29,MIA:14,MIL:15,MIN:16,NOP:3,NYK:18,OKC:25,ORL:19,PHI:20,PHX:21,POR:22,SAC:23,SAS:24,TOR:28,UTA:26,WAS:27};
const NBA_ESPNAB={GSW:'GS',NOP:'NO',NYK:'NY',SAS:'SA',UTA:'UTAH',WAS:'WSH'};
function nbaClock(iso){const m=/PT(\d+)M([\d.]+)S/.exec(iso||'');if(!m)return '0:00';const mi=+m[1],se=+m[2];return mi?mi+':'+String(Math.floor(se)).padStart(2,'0'):(se%1?se.toFixed(1):String(Math.floor(se)))}
const nbaTitle=s=>String(s||'').replace(/-/g,' ').split(' ').filter(Boolean).map(w=>w[0].toUpperCase()+w.slice(1).toLowerCase()).join(' ');
function nbaShotType(a){const sub=String(a.subType||'').toLowerCase(),d=String(a.descriptor||'').toLowerCase();
  if(a.actionType==='heave')return 'Heave Jump Shot';
  const base=/dunk/.test(sub)?'Dunk Shot':/layup/.test(sub)?'Layup Shot':/hook/.test(sub)?'Hook Shot':'Jump Shot';
  if(/\btip\b/.test(d)&&base!=='Dunk Shot')return 'Tip Shot';
  const W={pullup:'Pullup','pull up':'Pullup','step back':'Step Back',stepback:'Step Back',fadeaway:'Fade Away','fade away':'Fade Away',turnaround:'Turnaround',driving:'Driving',cutting:'Cutting','alley oop':'Alley Oop','alley-oop':'Alley Oop',putback:'Putback',running:'Running',floating:'Floating','finger roll':'Finger Roll',reverse:'Reverse',bank:'Bank',tip:'Tip'};
  const mods=[];Object.keys(W).forEach(k=>{if(d.includes(k)&&!mods.includes(W[k]))mods.push(W[k])});
  return mods.concat(base).join(' ')}
function fromNBA(box,pbp,extra){extra=extra||{};const g=box.game,acts=((pbp&&pbp.game&&pbp.game.actions)||[]).slice().sort((x,y)=>x.period-y.period||x.orderNumber-y.orderNumber);
  /* free throws belong to the five on the floor when the foul happened: a sub made between the foul and its free throws moves to after the last one (NBA plus-minus rule) */
  {const skip=x=>x.actionType==='substitution'||x.actionType==='timeout'||(x.actionType==='rebound'&&!x.personId)||x.actionType==='instantreplay'||x.actionType==='stoppage';
   for(let i=0;i<acts.length;i++){if(acts[i].actionType!=='substitution')continue;
    let j=i-1;while(j>=0&&skip(acts[j]))j--;if(j<0||!(acts[j].actionType==='foul'||acts[j].actionType==='freethrow')||acts[j].period!==acts[i].period)continue;
    let k=i+1;while(k<acts.length&&skip(acts[k]))k++;if(k>=acts.length||acts[k].actionType!=='freethrow')continue;
    let last=k;for(let m=k+1;m<acts.length;m++){if(acts[m].actionType==='freethrow')last=m;else if(!skip(acts[m]))break}
    let e=i;while(e+1<last&&acts[e+1].actionType==='substitution')e++;const mv=acts.splice(i,e-i+1);acts.splice(last-mv.length+1,0,...mv);i=last}}
  /* the NBA now and then names the wrong player in a "SUB out" (someone already on the bench). When exactly one player on the floor
     for that team next appears checking back in (no plays in between, this quarter or later), he's the one who left: fix the row (Nov 2) */
  {const court={};[g.homeTeam,g.awayTeam].forEach(t=>{const st=(t.players||[]).filter(p=>p.starter==='1').map(p=>p.personId);if(st.length===5)court[t.teamId]=new Set(st)});
   acts.forEach((a,n)=>{if(a.actionType!=='substitution')return;const T=court[a.teamId];if(!T)return;
     if(a.subType==='in'){if(T.has(a.personId)){court[a.teamId]=null;return}T.add(a.personId);if(T.size>5){court[a.teamId]=null}return}
     if(!T.has(a.personId)){const later=acts.slice(n+1);
       const cand=[...T].filter(id=>!later.some(b=>b.actionType==='substitution'&&b.subType==='out'&&b.personId===id&&b.clock===a.clock)).filter(id=>{for(const b of later){if(b.personId!==id)continue;return b.actionType==='substitution'&&b.subType==='in'}return false});   /* his next appearance is checking back in: he was the one on the bench */
       if(cand.length===1){a.personId=cand[0];a.fixed='sub-out'}else{court[a.teamId]=null;return}}
     T.delete(a.personId)})}
  const tid=t=>String(NBA_TEAM[t.teamTricode]||t.teamId);const H=g.homeTeam,A=g.awayTeam;const byNba={[H.teamId]:tid(H),[A.teamId]:tid(A)};
  const name={},team={};[H,A].forEach(t=>(t.players||[]).forEach(p=>{name[p.personId]=p.name;team[p.personId]=tid(t)}));const N=id=>name[id]||'';
  const st=g.gameStatus===3?'post':g.gameStatus===2?'in':'pre';const per=g.period||1,clk=nbaClock(g.gameClock);
  const comp=(t,ha)=>({id:tid(t),homeAway:ha,score:String(t.score||0),winner:st==='post'?(t.score>(ha==='home'?A:H).score):undefined,linescores:(t.periods||[]).map(q=>({displayValue:String(q.score)})),record:extra[t.teamTricode]?[{summary:extra[t.teamTricode]}]:[],
    team:{id:tid(t),abbreviation:NBA_ESPNAB[t.teamTricode]||t.teamTricode,shortDisplayName:t.teamName,name:t.teamName,location:t.teamCity,logos:[{href:'https://cdn.nba.com/logos/nba/'+t.teamId+'/primary/L/logo.svg'}]}});
  const ordP=n=>n<=4?['1st','2nd','3rd','4th'][n-1]:(n===5?'OT':(n-4)+'OT');
  const header={competitions:[{date:g.gameTimeUTC,competitors:[comp(H,'home'),comp(A,'away')],broadcasts:[],
    status:{period:per,displayClock:clk,type:{state:st,completed:st==='post',shortDetail:st==='post'?'Final'+(per>4?'/'+ordP(per):''):st==='in'?(g.gameStatusText||clk+' - '+ordP(per)):(g.gameStatusText||'')}}}]};
  const mins=iso=>{const m=/PT(\d+)M([\d.]+)S/.exec(iso||'');return m?String(Math.round(+m[1]+ +m[2]/60)):'0'};
  const players=[H,A].map(t=>({team:{id:tid(t)},statistics:[{names:['MIN','PTS','FG','3PT','FT','REB','AST','TO','STL','BLK','OREB','DREB','PF','+/-'],athletes:(t.players||[]).map(p=>{const s=p.statistics||{};const dnp=p.played!=='1';
    return {athlete:{id:String(p.personId),displayName:p.name,shortName:p.nameI||p.name,position:{abbreviation:p.position||''},jersey:p.jerseyNum,nba:1},starter:p.starter==='1',didNotPlay:dnp,reason:dnp?(p.notPlayingReason||p.notPlayingDescription||(p.status==='INACTIVE'?'Inactive':'DNP')):'',stats:dnp?[]:[mins(s.minutes),String(s.points||0),(s.fieldGoalsMade||0)+'-'+(s.fieldGoalsAttempted||0),(s.threePointersMade||0)+'-'+(s.threePointersAttempted||0),(s.freeThrowsMade||0)+'-'+(s.freeThrowsAttempted||0),String(s.reboundsTotal||0),String(s.assists||0),String(s.turnovers||0),String(s.steals||0),String(s.blocks||0),String(s.reboundsOffensive||0),String(s.reboundsDefensive||0),String(s.foulsPersonal||0),(s.plusMinusPoints>0?'+':'')+Math.round(s.plusMinusPoints||0)]}})}]}));
  const tstat=t=>{const s=t.statistics||{};return [['turnoverPoints',s.pointsFromTurnovers],['fastBreakPoints',s.pointsFastBreak],['pointsInPaint',s.pointsInThePaint]].map(([n,v])=>({name:n,displayValue:v==null?'':String(v)}))};
  const boxscore={players,teams:[{team:{id:tid(H)},statistics:tstat(H)},{team:{id:tid(A)},statistics:tstat(A)}]};
  /* plays: one ESPN-style play per NBA action; steals and blocks ride on the turnover / missed shot (as ESPN writes them), substitutions pair each "out" with an "in" at the same moment */
  const plays=[];let hs=0,as=0;const mk=(a,type,text,ids,o)=>{const sh=+a.scoreHome||0,sa=+a.scoreAway||0;if(sh>hs)hs=sh;if(sa>as)as=sa;
    plays.push(Object.assign({id:'n'+a.actionNumber+(o&&o.k||''),type:{text:type},text,period:{number:a.period},clock:{displayValue:nbaClock(a.clock)},team:a.teamId&&byNba[a.teamId]?{id:byNba[a.teamId]}:undefined,participants:ids.filter(x=>x).map(x=>({athlete:{id:String(x)}})),homeScore:hs,awayScore:as,scoringPlay:false,scoreValue:0,shootingPlay:false},o||{}))};
  const subQ={};const flushSubs=()=>{Object.values(subQ).forEach(q=>{q.out.forEach((o,i)=>{const n=q.in[i];if(n)mk(n,'Substitution',N(n.personId)+' enters the game for '+N(o.personId),[n.personId,o.personId],{k:'s'+i,team:{id:byNba[n.teamId]}})})});for(const k in subQ)delete subQ[k]};
  let subKey=null;
  for(const a of acts){const t=a.actionType,sub=String(a.subType||'').toLowerCase(),desc=String(a.descriptor||'').toLowerCase();
    if(t==='substitution'){const k=a.period+'|'+a.clock+'|'+a.teamId,m=a.period+'|'+a.clock;if(subKey&&subKey!==m)flushSubs();subKey=m;const q=subQ[k]=subQ[k]||{out:[],in:[]};(sub==='out'?q.out:q.in).push(a);if(q.out.length&&q.out.length===q.in.length){const one={[k]:q};delete subQ[k];const keep=Object.assign({},subQ);for(const x in subQ)delete subQ[x];Object.assign(subQ,one);flushSubs();Object.assign(subQ,keep)}continue}
    if(Object.keys(subQ).length&&subKey!==a.period+'|'+a.clock){flushSubs();subKey=null}   /* subs at one moment can be split by free throws or the other team's subs: pair them once the clock moves */
    if(t==='2pt'||t==='3pt'||t==='heave'){const three=t==='3pt'||(t==='heave'&&a.shotDistance>=22),v=three?3:2,made=a.shotResult==='Made',ty=nbaShotType(a);
      const dist=a.shotDistance!=null?Math.round(a.shotDistance)+'-foot ':'';const ast=made&&a.assistPersonId,blk=!made&&a.blockPersonId;
      const text=blk?N(a.blockPersonId)+' blocks '+N(a.personId)+"'s "+dist+(three?'three point ':'')+ty.toLowerCase():N(a.personId)+(made?' makes ':' misses ')+dist+(three?'three point ':'two point ')+ty.toLowerCase()+(ast?' ('+N(a.assistPersonId)+' assists)':'');
      const c=a.xLegacy!=null&&a.yLegacy!=null?{x:Math.round((25+a.xLegacy/10)*10)/10,y:Math.max(0,Math.round(a.yLegacy)/10)}:a.shotDistance!=null?{x:25,y:Math.round(Math.max(a.shotDistance,a.actionType==='3pt'?24:0)*10)/10}:undefined;   /* the rare shot with no court spot (about 1 in 1,500): placed straight on at its distance, so its zone still counts */
      const zh=c?undefined:v===3?(/Corner/.test(a.area||'')?3:4):a.shotDistance!=null?(a.shotDistance<4?0:a.shotDistance<14?1:2):/Restricted/.test(a.area||'')?0:/Paint/.test(a.area||'')?1:/Mid/.test(a.area||'')?2:undefined;   /* rare shots with no location: zone from the NBA's distance or area, kept off the shot chart */
      mk(a,ty,text,[a.personId,ast?a.assistPersonId:blk?a.blockPersonId:null],{scoringPlay:made,scoreValue:made?v:0,shootingPlay:true,pointsAttempted:v,coordinate:c,zh});continue}
    if(t==='freethrow'){const made=a.shotResult==='Made';const m=/(\d) of (\d)/.exec(sub);const tech=/technical/.test(sub),flag=/flagrant/.test(sub);
      const ty=tech?'Free Throw - Technical':'Free Throw - '+(flag?'Flagrant ':'')+(m?m[1]+' of '+m[2]:'1 of 1');
      mk(a,ty,N(a.personId)+(made?' makes ':' misses ')+'free throw'+(m?' '+m[1]+' of '+m[2]:''),[a.personId],{scoringPlay:made,scoreValue:made?1:0,shootingPlay:true,pointsAttempted:1});continue}
    if(t==='rebound'){const off=sub==='offensive';const who=a.personId&&name[a.personId]?a.personId:null;
      mk(a,off?'Offensive Rebound':'Defensive Rebound',(who?N(who):(a.teamTricode||'Team'))+(off?' offensive':' defensive')+(who?' rebound':' team rebound'),[who]);continue}
    if(t==='turnover'){const w=sub==='traveling'?'Traveling':sub==='shot clock'?'Shot Clock Turnover':sub==='offensive foul'?'Offensive Foul Turnover':sub==='bad pass'?'Bad Pass Turnover':sub==='lost ball'?'Lost Ball Turnover':sub==='out-of-bounds'?'Out of Bounds - '+(desc?nbaTitle(desc):'Lost Ball')+' Turnover':nbaTitle(sub||'turnover')+(/turnover/.test(sub)?'':' Turnover');
      const who=a.personId&&name[a.personId]?a.personId:null;mk(a,w,(who?N(who):(a.teamTricode||'Team'))+' '+(sub||'turnover')+(a.stealPersonId?' ('+N(a.stealPersonId)+' steals)':''),[who,a.stealPersonId]);continue}
    if(t==='foul'){const ty=sub==='offensive'?(desc==='charge'?'Offensive Charge':'Offensive Foul'):sub==='technical'?'Technical Foul':sub==='double technical'?'Double Technical Foul':/flagrant/.test(sub)?'Flagrant Foul Type '+((/2/.test(sub))?2:1):sub==='loose ball'?'Loose Ball Foul':desc==='shooting'?'Shooting Foul':desc==='take'?'Personal Take Foul':desc==='transition take'?'Transition Take Foul':'Personal Foul';
      mk(a,ty,(a.personId&&name[a.personId]?N(a.personId):(a.teamTricode||'Team'))+' '+ty.toLowerCase()+(a.foulDrawnPersonId?' ('+N(a.foulDrawnPersonId)+' draws the foul)':''),[a.personId&&name[a.personId]?a.personId:null,a.foulDrawnPersonId]);continue}
    if(t==='jumpball'){mk(a,'Jumpball',N(a.jumpBallWonPersonId)+' vs. '+N(a.jumpBallLostPersonId)+' ('+N(a.jumpBallRecoverdPersonId)+' gains possession)',[a.jumpBallWonPersonId,a.jumpBallLostPersonId,a.jumpBallRecoverdPersonId]);continue}
    if(t==='timeout'){mk(a,sub==='official'?'Official Timeout':'Full Timeout',(a.teamTricode||'Official')+' timeout',[]);continue}
    if(t==='violation'){mk(a,nbaTitle(sub)+(sub==='kicked ball'?'':' Violation'),(a.personId&&name[a.personId]?N(a.personId)+' ':'')+sub+' violation',[a.personId&&name[a.personId]?a.personId:null]);continue}
    if(t==='instantreplay'){mk(a,/overturn/.test(desc)?"Coach's Challenge (Overturned)":/challenge/.test(sub)?'Challenge':'Review',a.description||'Review',[]);continue}
    if(t==='period'&&sub==='end'){mk(a,'End Period','End of '+(a.period>4?'OT'+(a.period-4):'Q'+a.period),[],{clock:{displayValue:'0:00'}});continue}
    if(t==='game'&&sub==='end'){const l=plays[plays.length-1];if(l&&l.type.text==='End Period')l.type.text='End Game';else mk(a,'End Game','End of game',[],{clock:{displayValue:'0:00'}});continue}
  }
  if(Object.keys(subQ).length)flushSubs();
  return {src:'NBA',nbaId:g.gameId,header,boxscore,plays,winprobability:[],gameInfo:{venue:{fullName:(g.arena&&g.arena.arenaName)||''}}}}

/* ---------- archive helpers (used by the nightly job and the page) ---------- */
/* ESPN's win probability laid over NBA plays by game clock (the NBA feed has none). espn: an ESPN summary, full or slim */
function nbaWP(out,espn){if(!out||!espn||!espn.winprobability||!espn.winprobability.length)return out;const E=unpackSlim(espn);const byId={};(E.plays||[]).forEach(q=>byId[q.id]=gt(q.period.number,q.clock.displayValue));
  const W=(E.winprobability||[]).map(w=>[byId[w.playId],w.homeWinPercentage]).filter(w=>w[0]!=null).sort((x,y)=>x[0]-y[0]);let k=0,cur=null;
  out.winprobability=out.plays.map(q=>{const t=gt(q.period.number,q.clock.displayValue);while(k<W.length&&W[k][0]<=t){cur=W[k][1];k++}return cur==null?null:{playId:q.id,homeWinPercentage:cur}}).filter(Boolean);return out}
function slimSummary(d){
  const c=d.header.competitions[0];
  const P=x=>x==null?undefined:x;
  return {header:{competitions:[{date:c.date,status:c.status,broadcasts:(c.broadcasts||[]).map(b=>({media:{shortName:b.media&&b.media.shortName}})),
      competitors:c.competitors.map(x=>({id:x.id,homeAway:x.homeAway,winner:x.winner,score:x.score,linescores:(x.linescores||[]).map(l=>({displayValue:l.displayValue})),record:(x.record||[]).slice(0,1).map(r=>({summary:r.summary})),
        team:{id:x.team.id,abbreviation:x.team.abbreviation,shortDisplayName:x.team.shortDisplayName,name:x.team.name,location:x.team.location,logos:(x.team.logos||[]).slice(0,1).map(l=>({href:l.href}))}}))}]},
    gameInfo:{venue:{fullName:d.gameInfo&&d.gameInfo.venue&&d.gameInfo.venue.fullName}},
    boxscore:{teams:((d.boxscore&&d.boxscore.teams)||[]).map(t=>({team:{id:t.team.id},statistics:(t.statistics||[]).map(s=>({name:s.name,displayValue:s.displayValue}))})),
      players:((d.boxscore&&d.boxscore.players)||[]).map(t=>({team:{id:t.team.id},statistics:[{names:(t.statistics[0]||{}).names,athletes:((t.statistics[0]||{}).athletes||[]).map(a=>({athlete:{id:a.athlete.id,nba:a.athlete.nba?1:undefined,displayName:a.athlete.displayName,shortName:a.athlete.shortName,position:{abbreviation:a.athlete.position&&a.athlete.position.abbreviation},jersey:a.athlete.jersey},starter:a.starter,didNotPlay:a.didNotPlay,reason:a.reason,stats:a.stats}))}]}))},
    /* compact rows (pv:2): [id, type, text, period, clock, team, player ids, home, away, flags (1 scoring, 2 shooting), value, attempted, x, y]; prep() unpacks them */
    pv:2,plays:(unpackSlim(d).plays||[]).map(q=>{const c=q.coordinate&&q.coordinate.x>-100?q.coordinate:null;return [q.id,q.type.text,q.text,q.period.number,q.clock.displayValue,q.team?q.team.id:0,q.participants?q.participants.map(p=>p.athlete.id).join(','):'',q.homeScore,q.awayScore,(q.scoringPlay?1:0)|(q.shootingPlay?2:0),q.scoreValue,q.pointsAttempted==null?null:q.pointsAttempted,c?c.x:null,c?c.y:null,...(c||q.zh==null?[]:[q.zh])]}),
    winprobability:(unpackSlim(d).winprobability||[]).map(w=>[w.playId,w.homeWinPercentage])};
}
/* numbers-only recap for a finished game, focus team first */
function recap(D,R){
  const F=D.focus,O=D.other,fs=F.ha==='home'?R.hs:R.as,os=F.ha==='home'?R.as:R.hs,won=fs>os;const out=[];
  const per=R.lp?R.lp.per:4;out.push(`${F.name} ${won?'beat':'lost to'} the ${O.name} ${Math.max(fs,os)}–${Math.min(fs,os)}${per>4?' in '+(per===5?'overtime':(per-4)+' overtimes'):''}.`);
  const top=t=>D.roster[t.id].filter(id=>R.B[id].min>0).sort((a,b)=>R.B[b].pts-R.B[a].pts)[0];
  [F,O].forEach(t=>{const id=top(t);if(id){const b=R.B[id];out.push(`${D.P[id].name} led the ${t.name} with ${b.pts} points (${b.fgm}-${b.fga} FG${b.tpa?', '+b.tpm+'-'+b.tpa+' 3PT':''}), ${b.oreb+b.dreb} rebounds and ${b.ast} assists.`)}});
  const A=R.T[F.id],B=R.T[O.id],fa=factors(A,B),fb=factors(B,A);const wonF=FF.filter(([k,,,hib])=>fa[k]!=null&&fb[k]!=null&&fa[k]!==fb[k]&&((fa[k]>fb[k])===hib)).map(x=>x[1].toLowerCase());
  out.push(`${F.abbr} won ${wonF.length} of 4 factors${wonF.length?': '+wonF.join(', '):''}. Effective FG% ${(fa.efg*100).toFixed(1)} to ${(fb.efg*100).toFixed(1)}.`);
  const big=t=>R.runs.filter(r=>r.t===t.id).sort((a,b)=>b.pts-a.pts)[0];[F,O].forEach(t=>{const r=big(t);if(r)out.push(`Biggest ${t.abbr} run: ${r.pts}–0 (${pname(r.start.per)} ${r.start.clock} to ${r.end.per!==r.start.per?pname(r.end.per)+' ':''}${r.end.clock}).`)});
  if(R.wpS&&R.wpS.length>2){const fh=F===D.home;let best=null;for(let i=1;i<R.wpS.length;i++){const dv=(R.wpS[i][1]-R.wpS[i-1][1])*(fh?1:-1);if(!best||Math.abs(dv)>Math.abs(best[0]))best=[dv,R.wpS[i][2]]}
    if(best)out.push(`Biggest swing: ${best[1].text} (${pname(best[1].per)} ${best[1].clock}), ${best[0]>0?'+':'−'}${Math.abs(Math.round(best[0]*100))} points of ${F.abbr} win probability.`)}
  const L5=Object.values(R.L[F.id][5]).filter(l=>l.sec>=240).sort((a,b)=>(b.pf-b.pa)-(a.pf-a.pa))[0];if(L5)out.push(`Best ${F.abbr} lineup (4+ minutes): ${L5.ids.map(id=>D.P[id].last).join(', ')}, ${L5.pf-L5.pa>0?'+':''}${L5.pf-L5.pa} in ${fmtMin(L5.sec)}.`);
  out.push(`Bench points: ${F.abbr} ${A.bnPts}, ${O.abbr} ${B.bnPts}. Points in the paint: ${A.paint}–${B.paint}. Second-chance points: ${A.second}–${B.second}.`);
  return out;
}

/* the recap as labeled lines for the site's game page: [[label, text], ...] */
function recapL(D,R){
  const F=D.focus,O=D.other,fs=F.ha==='home'?R.hs:R.as,os=F.ha==='home'?R.as:R.hs,won=fs>os;const out=[];const per=R.lp?R.lp.per:4;
  out.push(['Result',`${F.name} ${won?'beat':'lost to'} the ${O.name} ${Math.max(fs,os)}–${Math.min(fs,os)}${per>4?' in '+(per===5?'overtime':(per-4)+' overtimes'):''}.`]);
  const top=t=>D.roster[t.id].filter(id=>R.B[id].min>0).sort((a,b)=>R.B[b].pts-R.B[a].pts)[0];
  [[F,'Cavs high'],[O,'Their high']].forEach(([t,l])=>{const id=top(t);if(id){const b=R.B[id];out.push([l,`${D.P[id].name}: ${b.pts} pts (${b.fgm}-${b.fga} FG${b.tpa?', '+b.tpm+'-'+b.tpa+' 3PT':''}), ${b.oreb+b.dreb} reb, ${b.ast} ast.`])}});
  const A=R.T[F.id],B=R.T[O.id],fa=factors(A,B),fb=factors(B,A);const wonF=FF.filter(([k,,,hib])=>fa[k]!=null&&fb[k]!=null&&fa[k]!==fb[k]&&((fa[k]>fb[k])===hib)).map(x=>x[1].toLowerCase());
  out.push(['Four factors',`Cavs won ${wonF.length} of 4${wonF.length?': '+wonF.join(', '):''}. Effective FG% ${(fa.efg*100).toFixed(1)} to ${(fb.efg*100).toFixed(1)}.`]);
  const big=t=>R.runs.filter(r=>r.t===t.id).sort((a,b)=>b.pts-a.pts)[0];const rs=[];
  [[F,'Cavs'],[O,O.name]].forEach(([t,n])=>{const r=big(t);if(r)rs.push(`${n==='Cavs'?'Best Cavs run':n+' best run'} ${r.pts}–0 (${pname(r.start.per)}${r.end.per!==r.start.per?' to '+pname(r.end.per):''})`)});
  if(rs.length)out.push(['Runs',rs.join('. ')+'.']);
  const L5=Object.values(R.L[F.id][5]).filter(l=>l.sec>=240).sort((a,b)=>(b.pf-b.pa)-(a.pf-a.pa))[0];if(L5)out.push(['Best lineup',`${L5.ids.map(id=>D.P[id].last).join(', ')}: ${L5.pf-L5.pa>0?'+':''}${L5.pf-L5.pa} in ${fmtMin(L5.sec)}.`]);
  out.push(['Edges',`Bench ${A.bnPts}–${B.bnPts} · Paint ${A.paint}–${B.paint} · Second chance ${A.second}–${B.second}`]);
  return out;
}
/* possession extras for both teams: how fast the first shot, turnover or foul came (0–8, 9–16, 17+ seconds; offensive rebounds keep the possession),
   the first possession after each team's own timeout, and the first 3 minutes of each quarter (points and possessions) */
function extras(D,R){const tid=[D.home.id,D.away.id],out={tim:{},ato:{},qs:{}};
  const grp={};tid.forEach(t=>{const g=[];R.PL.filter(q=>q.team===t).forEach(q=>{if(q.how==='oreb'&&g.length)g[g.length-1].push(q);else g.push([q])});grp[t]=g;
    const tm=[[0,0],[0,0],[0,0]];g.forEach(x=>{const q=x[0];if(q.first==null&&!q.pts)return;const s=q.first==null?99:q.first;const b=s<=8?0:s<=16?1:2;tm[b][0]++;tm[b][1]+=x.reduce((a,y)=>a+y.pts,0)});out.tim[t]=tm;out.ato[t]=[0,0,0]});
  const starts=R.PL.filter(q=>q.how!=='oreb');
  (R.plays||[]).forEach(p=>{if(!/Timeout/.test(p.type)||/Official/.test(p.type)||!out.ato[p.team])return;const t=p.team;let tgt=null;
    for(let i=starts.length-1;i>=0;i--)if(starts[i].t<=p.t){tgt=starts[i].team===t?starts[i]:null;break}
    if(!tgt)tgt=starts.find(q=>q.team===t&&q.t>p.t);if(!tgt)return;const g=grp[t].find(x=>x[0]===tgt);if(!g)return;const pts=g.reduce((a,y)=>a+y.pts,0);const o=out.ato[t];o[0]++;o[1]+=pts;if(pts>0)o[2]++});
  tid.forEach(t=>{out.qs[t]=[1,2,3,4].map(()=>[0,0])});
  [1,2,3,4].forEach(per=>{const st=pstart(per),en=st+180;(R.plays||[]).forEach(p=>{if(p.per!==per||!(p.sc&&p.val>0)||p.t>en)return;const t=p.team&&out.qs[p.team]?p.team:(D.P[p.ids[0]]||{}).team;if(out.qs[t])out.qs[t][per-1][0]+=p.val});
    starts.forEach(q=>{if(q.t>=st&&q.t<en&&out.qs[q.team])out.qs[q.team][per-1][1]++})});
  return out}
/* extras for one stretch of the game: only that stretch's plays (quarters/halves by period; clutch and no-garbage-time keep the timeouts followed by a counted possession) */
function extrasFor(D,R,per){if(!per||per==='all')return extras(D,R);let plays=R.plays||[];
  if(per==='clutch'||per==='nogt'){const st=(R.PL||[]).map(q=>q.t);plays=plays.filter(p=>st.some(t=>t>=p.t&&t-p.t<=24))}else plays=plays.filter(p=>inPer(per,p.per));
  return extras(D,Object.assign({},R,{plays}))}
if(typeof module!=='undefined')Object.assign(module.exports,{nbaWP,slimSummary,recap,recapL,extras,extrasFor});
