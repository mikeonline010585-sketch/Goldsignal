const $=id=>document.getElementById(id);
const KEY='gold_api_key';
const state={lastNotifiedBar:null,timer:null};

$('apiKey').value=localStorage.getItem(KEY)||'';

function ema(a,p){if(a.length<p)return null;let k=2/(p+1),e=a.slice(0,p).reduce((x,y)=>x+y,0)/p;for(let i=p;i<a.length;i++)e=a[i]*k+e*(1-k);return e}
function emaSeries(a,p){if(a.length<p)return [];let k=2/(p+1),e=a.slice(0,p).reduce((x,y)=>x+y,0)/p,r=new Array(p-1).fill(null);r.push(e);for(let i=p;i<a.length;i++){e=a[i]*k+e*(1-k);r.push(e)}return r}
function rsi(a,p=14){if(a.length<=p)return null;let g=0,l=0;for(let i=a.length-p;i<a.length;i++){let d=a[i]-a[i-1];if(d>0)g+=d;else l-=d}if(l===0)return 100;let rs=(g/p)/(l/p);return 100-100/(1+rs)}
function atr(rows,p=14){if(rows.length<=p)return null;let tr=[];for(let i=1;i<rows.length;i++){let x=rows[i],prev=rows[i-1];tr.push(Math.max(x.high-x.low,Math.abs(x.high-prev.close),Math.abs(x.low-prev.close)))}return tr.slice(-p).reduce((a,b)=>a+b,0)/p}
function bucket(ts,mins){return Math.floor(ts/(mins*60000))*(mins*60000)}
function aggregate(rows,mins){
  const m=new Map();
  for(const r of rows){const b=bucket(r.ts,mins);let x=m.get(b);if(!x)x={ts:b,open:r.open,high:r.high,low:r.low,close:r.close,volume:r.volume};else{x.high=Math.max(x.high,r.high);x.low=Math.min(x.low,r.low);x.close=r.close;x.volume+=r.volume}m.set(b,x)}
  return [...m.values()].sort((a,b)=>a.ts-b.ts);
}
function condLine(name,ok,extra=''){return `<div class="cond"><span>${name}${extra?` — ${extra}`:''}</span><b class="${ok?'ok':'bad'}">${ok?'✓':'✗'}</b></div>`}
function fmt(x){return x==null?'—':Number(x).toFixed(2)}

async function fetchData(){
  const key=$('apiKey').value.trim();
  if(!key)throw new Error('Introdu cheia Twelve Data.');
  // We request UTC explicitly and enough M5 history for H1 EMA50.
  const url=`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=5min&outputsize=1000&timezone=UTC&apikey=${encodeURIComponent(key)}&format=JSON`;
  const res=await fetch(url,{cache:'no-store'});
  if(!res.ok)throw new Error('HTTP '+res.status);
  const j=await res.json();
  if(j.status==='error'||!j.values)throw new Error(j.message||'Twelve Data nu a returnat date.');
  return j.values.map(v=>({ts:Date.parse(v.datetime+'Z'),open:+v.open,high:+v.high,low:+v.low,close:+v.close,volume:+(v.volume||0)})).sort((a,b)=>a.ts-b.ts);
}

async function update(){
  $('error').textContent='';
  try{
    let rows=await fetchData();
    // Ignore the newest candle because it may still be forming.
    if(rows.length>1)rows=rows.slice(0,-1);
    if(rows.length<250)throw new Error('Nu sunt suficiente lumânări pentru H1 EMA50.');

    const m15=aggregate(rows,15), h1=aggregate(rows,60);
    const last=rows[rows.length-1];
    const m15Closed=m15.filter(x=>x.ts<=last.ts);
    const h1Closed=h1.filter(x=>x.ts<=last.ts);
    const c=last.close;
    const m5ema20=ema(rows.map(x=>x.close),20);
    const m5ema50=ema(rows.map(x=>x.close),50);
    const R=rsi(rows.map(x=>x.close),14);
    const A=atr(rows,14);
    const vols=rows.slice(-21,-1).map(x=>x.volume);
    const avgVol=vols.reduce((a,b)=>a+b,0)/(vols.length||1);
    const prev12=rows.slice(-13,-1);
    const breakout=prev12.length===12 && c<Math.min(...prev12.map(x=>x.low));

    const m15c=m15Closed.map(x=>x.close), h1c=h1Closed.map(x=>x.close);
    const e15=emaSeries(m15c,20), e1=emaSeries(h1c,20), e15_50=emaSeries(m15c,50), e1_50=emaSeries(h1c,50);
    const p15=e15.at(-1), p15s=e15.at(-4), p1=e1.at(-1), p1s=e1.at(-4);
    const p15_50=e15_50.at(-1), p1_50=e1_50.at(-1);

    const h1Trend=p1!=null&&p1_50!=null&&p1<p1_50;
    const m15Trend=p15!=null&&p15_50!=null&&p15<p15_50;
    const m15Slope=p15!=null&&p15s!=null&&p15<p15s;
    const h1Slope=p1!=null&&p1s!=null&&p1<p1s;
    const volOk=avgVol>0&&last.volume>avgVol;
    const rsiOk=R!=null&&R<42;
    const score=[h1Trend,m15Trend,breakout,rsiOk,volOk,m15Slope,h1Slope].filter(Boolean).length;
    const hour=new Date(last.ts).getUTCHours();
    const session=hour>=7&&hour<9;
    const sell=score>=5&&session&&rsiOk;
    const sl=sell?c+A:null,tp=sell?c+2*A:null;

    $('signal').textContent=sell?'SELL':'NO TRADE';
    $('signal').className='signal '+(sell?'sell':'neutral');
    $('reason').textContent=sell?'Setup SELL valid — toate filtrele principale sunt aliniate.':(!session?'În afara ferestrei 07:00–09:00 UTC.':`Score ${score}/7 — sunt necesare minimum 5/7.`);
    $('entry').textContent=sell?fmt(c):'—'; $('sl').textContent=sell?fmt(sl):'—'; $('tp').textContent=sell?fmt(tp):'—';
    $('rr').textContent='2:1'; $('score').textContent=score+'/7'; $('rsi').textContent=fmt(R);
    $('conditions').innerHTML=[
      condLine('H1 trend bearish',h1Trend),condLine('M15 trend bearish',m15Trend),
      condLine('Breakout sub minimul ultimelor 12 M5',breakout),
      condLine('RSI < 42',rsiOk,fmt(R)),condLine('Volum > media 20',volOk),
      condLine('Pantă EMA20 M15 negativă',m15Slope),condLine('Pantă EMA20 H1 negativă',h1Slope),
      condLine('Sesiune 07:00–09:00 UTC',session)
    ].join('');
    $('lastCheck').textContent=new Date().toLocaleString('ro-RO');
    $('statusDot').className='dot on';

    if(sell && state.lastNotifiedBar!==last.ts){
      state.lastNotifiedBar=last.ts;
      notify(`GOLD SELL — ${fmt(c)}`,`Entry ${fmt(c)} | SL ${fmt(sl)} | TP ${fmt(tp)} | Score ${score}/7`);
    }
  }catch(e){
    $('statusDot').className='dot off';
    $('error').textContent=e.message||String(e);
  }
}
function notify(title,body){
  if(Notification.permission==='granted')new Notification(title,{body,icon:'icons/icon.svg'});
}
$('saveKey').onclick=()=>{localStorage.setItem(KEY,$('apiKey').value.trim());update()};
$('notifyBtn').onclick=async()=>{if('Notification' in window){const p=await Notification.requestPermission();if(p==='granted')notify('Gold Signal','Notificările sunt activate.')}};
$('auto').onchange=()=>{if(state.timer)clearInterval(state.timer);if($('auto').checked)state.timer=setInterval(update,60000)};
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
update();state.timer=setInterval(update,60000);
