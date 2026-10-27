/* cavsdatabase.com live game core: turns an ESPN game summary into team, player, lineup, shot and possession stats.
   Shared by /live.html, /embed/live.html and the nightly archive job (scripts/live-archive.mjs). */
'use strict';
/* league FG% and shot share by zone, 2025–26 (pbpstats team totals) */
const LG={AtRim:[.6726,.2805],ShortMidRange:[.444,.2267],LongMidRange:[.4118,.0747],Corner3:[.3868,.107],Arc3:[.3445,.311]};
const normName=n=>n.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g,'').replace(/[^a-z]/g,'');
const PT=[['putback','Putbacks and tip-ins'],['trans','Transition'],['cut','Cuts and lobs'],['drive','Drives'],['post','Post-ups and turnarounds'],['pull','Pull-ups and step-backs'],['spot','Spot-up jumpers'],['fin','Other layups and dunks']];
const ZN=[['AtRim','At the rim','0–4 ft'],['ShortMidRange','Short midrange','4–14 ft'],['LongMidRange','Long midrange','14 ft to the arc'],['Corner3','Corner 3',''],['Arc3','Above-the-break 3','']];
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
const inPer=(f,p)=>Array.isArray(f)?f.includes(Math.min(p,5)):f==='all'||(f==='h1'&&p<=2)||(f==='h2'&&p>=3)||(f==='ot'&&p>4)||String(p)===f;
const perLabel=f=>Array.isArray(f)?(eqSet(f,[1,2])?'1st half':eqSet(f,[3,4,5])||eqSet(f,[3,4])?'2nd half':f.length===1?(f[0]===5?'Overtime':'Quarter '+f[0]):f.slice().sort().map(p=>p===5?'OT':'Q'+p).join(' + ')):({all:'Full game',h1:'1st half',h2:'2nd half (incl. OT)',ot:'Overtime',clutch:'Clutch: last 5 minutes, score within 5'})[f]||'Quarter '+f;

/* ---------- prepare ---------- */
function lastName(n){const p=n.replace(/ (Jr\.|Sr\.|II|III|IV)$/,'').split(' ');return p.length>1?p.slice(1).join(' '):n}
/* archived games store plays and win probability as compact rows (pv:2, from slimSummary); turn them back into ESPN's shape */
function unpackSlim(d){if(!d||d.pv!==2)return d;const o=Object.assign({},d);delete o.pv;
  o.plays=(d.plays||[]).map(r=>({id:r[0],type:{text:r[1]},text:r[2],period:{number:r[3]},clock:{displayValue:r[4]},team:r[5]?{id:r[5]}:undefined,participants:r[6]?r[6].split(',').map(i=>({athlete:{id:i}})):undefined,homeScore:r[7],awayScore:r[8],scoringPlay:!!(r[9]&1),shootingPlay:!!(r[9]&2),scoreValue:r[10],pointsAttempted:r[11]==null?undefined:r[11],coordinate:r[12]==null?undefined:{x:r[12],y:r[13]}}));
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
    P[a.athlete.id]={id:a.athlete.id,name:a.athlete.displayName,short:a.athlete.shortName,last:lastName(a.athlete.displayName),pos:a.athlete.position&&a.athlete.position.abbreviation,team:tb.team.id,starter:!!a.starter,dnp:!!a.didNotPlay,reason:a.reason,espn:s};
    roster[tb.team.id].push(a.athlete.id)})});
  const plays=(d.plays||[]).map(q=>({id:q.id,type:q.type.text.replace(/\n/g,' '),text:q.text,per:q.period.number,clock:q.clock.displayValue,t:gt(q.period.number,q.clock.displayValue),team:q.team&&q.team.id,ids:(q.participants||[]).map(x=>x.athlete.id),hs:q.homeScore,as:q.awayScore,sc:q.scoringPlay,val:q.scoreValue,shot:q.shootingPlay,pa:q.pointsAttempted,x:q.coordinate&&q.coordinate.x>-100?q.coordinate.x:null,y:q.coordinate&&q.coordinate.y>-100?q.coordinate.y:null}));
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
  const inFx=per=>F==='clutch'?clutchNow:inPer(F,per);
  let hold=null;const endPoss=(t,inF)=>{if(!inF||!t)return;if(seg)seg.o[t].np++;lu(t,on[t],o=>o.o.np++);lu(opp(t),on[opp(t)],o=>o.d.np++)};
  const PL=[];const newPoss=(t,tt,how,inF)=>{if(ps[t]&&ps[t].t===tt&&ps[t].how===how&&how!=='oreb')return;if(how!=='start'){if(how!=='oreb'&&hold===opp(t))endPoss(opp(t),inF);hold=t}ps[t]={t:tt,how,pts:0,first:null,inF,on:on[t]?[...on[t]].sort().join(','):'',od:on[opp(t)]?[...on[opp(t)]].sort().join(','):''};if(inF){pc[t][how].n++;PL.push(Object.assign(ps[t],{team:t}))}};
  const margin=[[0,0]];let lc=0,ties=0,prevSign=0;const lead={};tid.forEach(t=>lead[t]=0);
  const shots=[],asts=[];const lastFG={},lastPt={},dr=[];let lastMade=null;
  /* segments: every stretch with the same ten players on the floor (for player-vs-opponent on/off) */
  const segs=[];let seg=null;const newSeg=()=>{seg={a:{},sec:0,pts:{},pp:{},o:{}};tid.forEach(t=>{seg.a[t]=[...on[t]];seg.pts[t]=0;seg.o[t]={fga:0,oreb:0,to:0,fta:0,np:0}});segs.push(seg)};
  const addTime=t1=>{const dt=t1-last;if(dt>0){const inF=inFx(curPer);if(inF&&seg)seg.sec+=dt;tid.forEach(t=>{const q=tq(curPer,t);q.sec+=dt;on[t].forEach(id=>{if(D.P[id].starter)q.stSec+=dt;else q.bnSec+=dt});if(inF){T[t].sec+=dt;on[t].forEach(id=>{B[id].min+=dt;if(D.P[id].starter)T[t].stSec+=dt;else T[t].bnSec+=dt});lu(t,on[t],o=>o.sec+=dt)}})}last=Math.max(last,t1)};
  const leave=(id,t1)=>{if(enter[id]!=null){(stints[id]=stints[id]||[]).push([enter[id][0],t1,pmAll[id]-enter[id][1]]);delete enter[id]}};
  const join=(id,t1)=>{enter[id]=[t1,pmAll[id]]};
  plays.forEach(p=>{
    if(p.per!==curPer){if(curPer){addTime(pstart(curPer)+plen(curPer));endPoss(hold,inFx(curPer));hold=null;tid.forEach(t=>on[t].forEach(id=>leave(id,pstart(curPer)+plen(curPer))))}
      curPer=p.per;last=pstart(p.per);tid.forEach(t=>{on[t]=new Set(startFive[p.per][t]||[]);on[t].forEach(id=>{B[id].played=true;join(id,last)});src[t]='';newPoss(t,last,'start',inFx(p.per))});newSeg()}
    clutchNow=p.per>=4&&(p.per>4||p.t>=2580)&&Math.abs(mgNow)<=5;
    addTime(p.t);
    const inF=inFx(p.per);const ty=p.type,a=p.ids[0],b=p.ids[1];
    if(D.wp[p.id]!=null)wpS.push([p.t,D.wp[p.id],p]);
    if(/Timeout/.test(ty)&&!/Official/.test(ty)&&T[p.team])to[p.team]++;
    if(ty==='Challenge'&&T[p.team])ch[p.team].used++;if(/Challenge \((Overturned|Successful)/i.test(ty)&&T[p.team])ch[p.team].won++;
    const TT=t=>inF?[T[t],tq(p.per,t)]:[tq(p.per,t)];
    const offStat=(t,k,ON)=>{if(!inF)return;if(seg)seg.o[t][k]++;lu(t,(ON||on)[t],o=>o.o[k]++);lu(opp(t),(ON||on)[opp(t)],o=>o.d[k]++)};
    /* lineup-only counts for the full advanced spread (makes, threes, assists, defensive boards) */
    const luStat=(t,k,ON)=>{if(!inF||!t)return;lu(t,(ON||on)[t],o=>o.o[k]=(o.o[k]||0)+1);lu(opp(t),(ON||on)[opp(t)],o=>o.d[k]=(o.d[k]||0)+1)};
    if(ty==='Substitution'){if(a&&b){const t=teamOf(a);if(t){on[t].delete(b);on[t].add(a);B[a].played=true;leave(b,p.t);join(a,p.t);newSeg()}}return}
    const isFT=/^Free Throw/.test(ty);{const tt=p.team&&T[p.team]?p.team:teamOf(a);if(tt&&ps[tt]&&ps[tt].first==null&&(p.shot||/Turnover|Foul/.test(ty)))ps[tt].first=p.t-ps[tt].t}
    if(/Foul/.test(ty)&&!/Offensive|Technical/.test(ty)){snap={t:p.t,per:p.per,on:{}};tid.forEach(x=>snap.on[x]=new Set(on[x]))}
    const ftSnap=isFT&&!/Technical/.test(ty)&&snap&&snap.t===p.t&&snap.per===p.per;const ON=ftSnap?snap.on:on;
    if(p.shot&&a&&B[a]&&!/Heave/.test(ty)){const t=teamOf(a);
      if(isFT&&/ 1 of /.test(ty)&&inF)TT(t).forEach(x=>{x.ftTrips++;if(/1 of 1/.test(ty)&&lastMade&&lastMade.id===a&&lastMade.t===p.t)x.and1++});
      if(!isFT&&p.sc){lastMade={id:a,t:p.t};const g=p.t-(lastFG[t]!=null?lastFG[t]:pstart(1));if(g>=180)dr.push({t,kind:'fg',from:lastFG[t]!=null?lastFG[t]:0,to:p.t});lastFG[t]=p.t}
      if(isFT){if(inF){B[a].fta++;if(p.sc)B[a].ftm++}TT(t).forEach(x=>{x.fta++;if(p.sc)x.ftm++});offStat(t,'fta',ON);if(p.sc)luStat(t,'ftm',ON)}
      else{const three=p.pa===3;const zi=p.x!=null?zoneOf(p.x,p.y,three):(three?4:1);const paint=!three&&p.x!=null&&Math.abs(p.x-25)<=8&&p.y<=13.75;
        if(inF){B[a].fga++;if(three)B[a].tpa++;if(p.sc){B[a].fgm++;if(three)B[a].tpm++}}
        TT(t).forEach(x=>{x.fga++;x.z[zi][1]++;if(three)x.tpa++;if(p.sc){x.fgm++;x.z[zi][0]++;if(three)x.tpm++;if(paint)x.paint+=2}});offStat(t,'fga');if(three)luStat(t,'tpa');if(p.sc){luStat(t,'fgm');if(three)luStat(t,'tpm');if(b&&/assists/.test(p.text))luStat(t,'ast')}
        if(p.sc&&b&&/assists/.test(p.text)&&B[b]){if(inF){B[b].ast++;asts.push({t,p:b,s:a,v:three?3:2,z:zi})}TT(t).forEach(x=>x.ast++)}
        else if(!p.sc&&b&&/blocks/.test(p.text)&&B[b]){if(inF)B[b].blk++;TT(teamOf(b)).forEach(x=>x.blk++)}
        if(inF){const st=ps[t],dt=p.t-st.t;const pt=/Putback|Tip/.test(ty)||(st.how==='oreb'&&dt<=3)?0:((st.how==='dreb'||st.how==='to'||st.how==='stl')&&dt<=7)?1:/Cutting|Alley Oop/.test(ty)?2:/Driving/.test(ty)?3:/Hook|Turnaround|Fade Away|Post/.test(ty)?4:/Pullup|Step Back/.test(ty)?5:/Jump Shot/.test(ty)?6:7;
          shots.push({t,on:[...on[t]].sort().join(','),od:[...on[opp(t)]].sort().join(','),id:a,x:p.x,y:p.y,hasXY:p.x!=null,m:!!p.sc,three,zi,pt,ast:!!(p.sc&&b&&/assists/.test(p.text)),per:p.per,clock:p.clock,text:p.text})}}}
    if(p.sc&&p.val>0){const t=p.team&&T[p.team]?p.team:teamOf(a);if(t){
      if(inF&&a&&B[a])B[a].pts+=p.val;if(inF&&seg){seg.pts[t]+=p.val;if(a)seg.pp[a]=(seg.pp[a]||0)+p.val}if(inF)pc[t][ps[t].how].pts+=p.val;if(ps[t])ps[t].pts+=p.val;lineAt[p.id]={[t]:[...ON[t]],[opp(t)]:[...ON[opp(t)]]};TT(t).forEach(x=>{x.pts+=p.val;if(a&&D.P[a]){if(D.P[a].starter)x.stPts+=p.val;else x.bnPts+=p.val}if(src[t].includes('2nd'))x.second+=p.val;if(src[t].includes('to'))x.offto+=p.val});
      const o=opp(t);ON[t].forEach(id=>{pmAll[id]+=p.val;if(inF)B[id].pm+=p.val});ON[o].forEach(id=>{pmAll[id]-=p.val;if(inF)B[id].pm-=p.val});
      if(inF){lu(t,ON[t],x=>x.pf+=p.val);lu(o,ON[o],x=>x.pa+=p.val)}
      if(!isFT||/(\d) of \1/.test(ty)){src[o]='';newPoss(o,p.t,'made',inF)}}}
    if(/Rebound/.test(ty)){const off=/Offensive/.test(ty);const t=a&&B[a]?teamOf(a):p.team;
      if(t&&T[t]){if(a&&B[a]){if(inF)B[a][off?'oreb':'dreb']++;TT(t).forEach(x=>x[off?'oreb':'dreb']++)}else TT(t).forEach(x=>x[off?'toreb':'tdreb']++);
        if(off){offStat(t,'oreb');src[t]=(src[t].includes('to')?'to':'')+'2nd';newPoss(t,p.t,'oreb',inF)}else{luStat(t,'dreb');src[t]='';newPoss(t,p.t,'dreb',inF)}}}
    if(/Turnover|^Traveling|Double Dribble|Discontinued? Dribble|Offensive Goaltending|Palming|Backcourt|3-Second Violation$|Inbound/.test(ty)&&!/Kicked|Defensive/.test(ty)){
      const t=p.team||teamOf(a);if(T[t]){TT(t).forEach(x=>x.to++);if(inF&&a&&B[a]&&teamOf(a)===t)B[a].to++;offStat(t,'to');src[opp(t)]='to';newPoss(opp(t),p.t,b&&/steals/.test(p.text)?'stl':'to',inF)}
      if(b&&/steals/.test(p.text)&&B[b]){if(inF)B[b].stl++;TT(teamOf(b)).forEach(x=>x.stl++)}}
    else if(/Foul/.test(ty)&&!/Technical|Double Technical/.test(ty)&&a&&B[a]){if(inF)B[a].pf++;pfAll[a]=(pfAll[a]||0)+1;TT(teamOf(a)).forEach(x=>x.pf++);
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
  const PLx=PL.filter(q=>q.first!=null||q.pts>0);
  return {PL:PLx,segs,curStint,dr,pmAll,pc,tf,to,ch,pfAll,wpS,lineAt,asts,plays,B,T,TQ,L,on,margin,runs,shots,stints,hs:lp?lp.hs:0,as:lp?lp.as:0,lp,lead,lc,ties,wp:lp&&D.wp[lp.id]!=null?D.wp[lp.id]:null,maxPer:lp?Math.max(4,lp.per):4};
}

function factors(a,b){const pa=poss({fga:a.fga,oreb:a.oreb+a.toreb,to:a.to,fta:a.fta});
  return {efg:a.fga?(a.fgm+0.5*a.tpm)/a.fga:null,tov:pa?a.to/pa:null,orb:(a.oreb+a.toreb+b.dreb+b.tdreb)?(a.oreb+a.toreb)/(a.oreb+a.toreb+b.dreb+b.tdreb):null,ftr:a.fga?a.ftm/a.fga:null}}
const FF=[['efg','Shooting','Effective FG%',true],['tov','Ball security','Turnover rate',false],['orb','Second chances','Offensive rebound rate',true],['ftr','Getting to the line','Free throws made per FGA',true]];
const CLE='5',C3=Math.sqrt(23.75**2-22**2);
if(typeof module!=='undefined')module.exports={unpackSlim,prep,deriveCore,factors,poss,ZN,PT,LG,normName,pname,fmtMin,inPer,pstart,plen};

/* ---------- archive helpers (used by the nightly job and the page) ---------- */
function slimSummary(d){
  const c=d.header.competitions[0];
  const P=x=>x==null?undefined:x;
  return {header:{competitions:[{date:c.date,status:c.status,broadcasts:(c.broadcasts||[]).map(b=>({media:{shortName:b.media&&b.media.shortName}})),
      competitors:c.competitors.map(x=>({id:x.id,homeAway:x.homeAway,winner:x.winner,score:x.score,linescores:(x.linescores||[]).map(l=>({displayValue:l.displayValue})),record:(x.record||[]).slice(0,1).map(r=>({summary:r.summary})),
        team:{id:x.team.id,abbreviation:x.team.abbreviation,shortDisplayName:x.team.shortDisplayName,name:x.team.name,location:x.team.location,logos:(x.team.logos||[]).slice(0,1).map(l=>({href:l.href}))}}))}]},
    gameInfo:{venue:{fullName:d.gameInfo&&d.gameInfo.venue&&d.gameInfo.venue.fullName}},
    boxscore:{teams:((d.boxscore&&d.boxscore.teams)||[]).map(t=>({team:{id:t.team.id},statistics:(t.statistics||[]).map(s=>({name:s.name,displayValue:s.displayValue}))})),
      players:((d.boxscore&&d.boxscore.players)||[]).map(t=>({team:{id:t.team.id},statistics:[{names:(t.statistics[0]||{}).names,athletes:((t.statistics[0]||{}).athletes||[]).map(a=>({athlete:{id:a.athlete.id,displayName:a.athlete.displayName,shortName:a.athlete.shortName,position:{abbreviation:a.athlete.position&&a.athlete.position.abbreviation},jersey:a.athlete.jersey},starter:a.starter,didNotPlay:a.didNotPlay,reason:a.reason,stats:a.stats}))}]}))},
    /* compact rows (pv:2): [id, type, text, period, clock, team, player ids, home, away, flags (1 scoring, 2 shooting), value, attempted, x, y]; prep() unpacks them */
    pv:2,plays:(unpackSlim(d).plays||[]).map(q=>{const c=q.coordinate&&q.coordinate.x>-100?q.coordinate:null;return [q.id,q.type.text,q.text,q.period.number,q.clock.displayValue,q.team?q.team.id:0,q.participants?q.participants.map(p=>p.athlete.id).join(','):'',q.homeScore,q.awayScore,(q.scoringPlay?1:0)|(q.shootingPlay?2:0),q.scoreValue,q.pointsAttempted==null?null:q.pointsAttempted,c?c.x:null,c?c.y:null]}),
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
if(typeof module!=='undefined')Object.assign(module.exports,{slimSummary,recap,recapL});
