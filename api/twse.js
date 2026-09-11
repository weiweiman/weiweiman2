export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('X-Data-Provider', 'TWSE');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ok:false,error:'method_not_allowed',provider:'TWSE',yahooUsed:false});

  const code = String(req.query.code || '').trim();
  const interval = String(req.query.interval || '5m').trim();
  if (!/^\d{4,6}$/.test(code)) return res.status(400).json({ok:false,error:'invalid_code',provider:'TWSE',yahooUsed:false});
  if (!['1m','5m','15m','60m','1d'].includes(interval)) return res.status(400).json({ok:false,error:'invalid_interval',provider:'TWSE',yahooUsed:false});

  const headers = {
    'User-Agent':'Mozilla/5.0 (compatible; TW-DayTrade-Pro/2.2)',
    'Accept':'application/json,text/plain,*/*',
    'Referer':`https://mis.twse.com.tw/stock/fibest.jsp?stock=${code}`
  };

  async function getJSON(url) {
    const ctl = new AbortController();
    const timer = setTimeout(()=>ctl.abort(), 5500);
    try {
      const r = await fetch(url,{headers,cache:'no-store',signal:ctl.signal});
      if(!r.ok) throw new Error(`TWSE HTTP ${r.status}`);
      const text = await r.text();
      try { return JSON.parse(text); }
      catch { throw new Error('TWSE returned non-JSON response'); }
    } finally { clearTimeout(timer); }
  }
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
  const pad=n=>String(n).padStart(2,'0');
  function ymd(d){return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`}
  function priorWeekdays(count){const out=[],d=new Date();d.setHours(12,0,0,0);while(out.length<count){const wd=d.getDay();if(wd!==0&&wd!==6)out.push(ymd(d));d.setDate(d.getDate()-1)}return out}
  function bucketMs(iv){return iv==='1m'?60000:iv==='5m'?300000:iv==='15m'?900000:iv==='60m'?3600000:86400000}
  function aggregate(points,iv){const span=bucketMs(iv),m=new Map();for(const p of points){if(!Number.isFinite(p.t)||!Number.isFinite(p.p))continue;const k=Math.floor(p.t/span)*span;let b=m.get(k);if(!b){b={t:k,o:p.p,h:p.p,l:p.p,c:p.p,v:0};m.set(k,b)}b.h=Math.max(b.h,p.p);b.l=Math.min(b.l,p.p);b.c=p.p;b.v+=Number.isFinite(p.v)?p.v:0}return [...m.values()].sort((a,b)=>a.t-b.t)}
  async function mapLimit(items,limit,fn){const out=new Array(items.length);let next=0;async function worker(){while(true){const i=next++;if(i>=items.length)return;try{out[i]=await fn(items[i],i)}catch(e){out[i]=null}}await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));return out}

  try {
    const ex=`tse_${code}.tw`,now=Date.now();
    const quoteUrl=`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(ex)}&json=1&delay=0&_=${now}`;
    const qr=await getJSON(quoteUrl),q=qr?.msgArray?.find(x=>x?.c===code)||qr?.msgArray?.[0];
    if(qr?.rtcode!=='0000'||!q) return res.status(502).json({ok:false,error:'twse_quote_unavailable',message:qr?.rtmessage||'TWSE quote unavailable',provider:'TWSE',yahooUsed:false});
    if(q.ex!=='tse') return res.status(422).json({ok:false,error:'not_twse_listed',message:'此代號不是證交所上市（TSE）資料，TWSE-only 模式不切換其他來源。',provider:'TWSE',yahooUsed:false});

    const bid=(q.b||'').split('_').filter(Boolean).map(Number),ask=(q.a||'').split('_').filter(Boolean).map(Number);
    const quote={
      code:q.c,name:q.n,fullName:q.nf,exchange:q.ex,
      price:num(q.z)??num(bid[0])??num(ask[0]),open:num(q.o),high:num(q.h),low:num(q.l),prevClose:num(q.y),
      volume:num(q.v),tradeVolume:num(q.tv),bid,ask,
      bidVol:(q.g||'').split('_').filter(Boolean).map(Number),askVol:(q.f||'').split('_').filter(Boolean).map(Number),
      limitUp:num(q.u),limitDown:num(q.w),tradeTime:q.t||null,tradeDate:q.d||null,sourceTime:num(q.tlong),source:'TWSE MIS getStockInfo'
    };

    let bars=[],barSource='';
    if(interval==='1d'){
      const end=q.d||ymd(new Date()),sd=new Date();sd.setMonth(sd.getMonth()-10);const start=ymd(sd);
      const u=`https://mis.twse.com.tw/stock/api/getDailyRangeWithMA.jsp?ex_ch=${encodeURIComponent(ex)}&d0=${start}&d1=${end}`;
      const d=await getJSON(u);
      bars=(d?.msgArray||[]).map(x=>({t:num(x.tlong),o:num(x.o),h:num(x.h),l:num(x.l),c:num(x.z),v:num(x.v)})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a,b)=>a.t-b.t);
      barSource='TWSE MIS getDailyRangeWithMA';
    }else{
      const days=priorWeekdays(10);
      const chunks=await mapLimit(days,3,async day=>{
        const u=`https://mis.twse.com.tw/stock/api/getOhlc.jsp?ex_ch=${encodeURIComponent(ex)}&d0=${day}`;
        const d=await getJSON(u);const pts=[];
        for(const x of (d?.msgArray||[])){const t=num(x.tlong),p=num(x.c??x.z),v=num(x.s??x.v)??0;if(Number.isFinite(t)&&Number.isFinite(p))pts.push({t,p,v})}
        return pts;
      });
      const pts=chunks.filter(Boolean).flat().sort((a,b)=>a.t-b.t);
      bars=aggregate(pts,interval);barSource='TWSE MIS getOhlc → local interval aggregation';
    }

    const sourceTime=quote.sourceTime,staleMs=Number.isFinite(sourceTime)?Math.max(0,Date.now()-sourceTime):null;
    return res.status(200).json({
      ok:true,provider:'TWSE',yahooUsed:false,market:'TSE',interval,quote,bars,barCount:bars.length,
      barSource,newestBarTime:bars.length?bars[bars.length-1].t:null,staleMs,generatedAt:Date.now()
    });
  } catch(e) {
    return res.status(502).json({ok:false,error:'twse_fetch_failed',message:String(e?.name==='AbortError'?'TWSE request timeout':e?.message||e),provider:'TWSE',yahooUsed:false});
  }
}
