export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ok:false,error:'method_not_allowed'});

  const code = String(req.query.code || '').trim();
  const interval = String(req.query.interval || '5m').trim();
  if (!/^\d{4,6}$/.test(code)) return res.status(400).json({ok:false,error:'invalid_code'});
  if (!['1m','5m','15m','60m','1d'].includes(interval)) return res.status(400).json({ok:false,error:'invalid_interval'});

  const UA = 'Mozilla/5.0 (compatible; TW-DayTrade-Pro/2.2; +https://github.com/weiweiman/weiweiman2)';
  const headers = { 'User-Agent': UA, 'Accept': 'application/json,text/plain,*/*', 'Referer': `https://mis.twse.com.tw/stock/fibest.jsp?stock=${code}` };

  async function getJSON(url) {
    const r = await fetch(url, { headers, cache: 'no-store' });
    if (!r.ok) throw new Error(`TWSE HTTP ${r.status}`);
    const text = await r.text();
    try { return JSON.parse(text); } catch { throw new Error('TWSE returned non-JSON response'); }
  }

  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  function ymd(ts) {
    const d = new Date(ts);
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
    return `${y}${m}${day}`;
  }
  function priorWeekdays(count) {
    const out=[]; const d=new Date(); d.setHours(12,0,0,0);
    while(out.length<count){ const wd=d.getDay(); if(wd!==0&&wd!==6) out.push(ymd(d)); d.setDate(d.getDate()-1); }
    return out;
  }
  function bucketMs(iv){ return iv==='1m'?60000:iv==='5m'?300000:iv==='15m'?900000:iv==='60m'?3600000:86400000; }
  function aggregate(points, iv) {
    const span=bucketMs(iv), buckets=new Map();
    for (const p of points) {
      if (!Number.isFinite(p.t)||!Number.isFinite(p.p)) continue;
      const k=Math.floor(p.t/span)*span;
      let b=buckets.get(k);
      if(!b){ b={t:k,o:p.p,h:p.p,l:p.p,c:p.p,v:0}; buckets.set(k,b); }
      b.h=Math.max(b.h,p.p); b.l=Math.min(b.l,p.p); b.c=p.p; b.v += Number.isFinite(p.v)?p.v:0;
    }
    return [...buckets.values()].sort((a,b)=>a.t-b.t);
  }

  try {
    const ex = `tse_${code}.tw`;
    const now = Date.now();
    const quoteUrl = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(ex)}&json=1&delay=0&_=${now}`;
    const quoteRaw = await getJSON(quoteUrl);
    const q = quoteRaw?.msgArray?.find(x => x?.c === code) || quoteRaw?.msgArray?.[0];
    if (!q || quoteRaw?.rtcode !== '0000') return res.status(502).json({ok:false,error:'twse_quote_unavailable',detail:quoteRaw?.rtmessage||null});

    const quote = {
      code: q.c, name: q.n, exchange: q.ex,
      price: num(q.z) ?? num((q.b||'').split('_')[0]) ?? num((q.a||'').split('_')[0]),
      open: num(q.o), high: num(q.h), low: num(q.l), prevClose: num(q.y),
      volume: num(q.v), tradeVolume: num(q.tv),
      bid: (q.b||'').split('_').filter(Boolean).map(Number), ask: (q.a||'').split('_').filter(Boolean).map(Number),
      bidVol: (q.g||'').split('_').filter(Boolean).map(Number), askVol: (q.f||'').split('_').filter(Boolean).map(Number),
      limitUp: num(q.u), limitDown: num(q.w),
      tradeTime: q.t || null, tradeDate: q.d || null, sourceTime: num(q.tlong),
      source: 'TWSE MIS getStockInfo'
    };

    let bars=[];
    if (interval === '1d') {
      const end = q.d || ymd(Date.now());
      const startDate = new Date(); startDate.setMonth(startDate.getMonth()-10);
      const start = ymd(startDate);
      const u = `https://mis.twse.com.tw/stock/api/getDailyRangeWithMA.jsp?ex_ch=${encodeURIComponent(ex)}&d0=${start}&d1=${end}`;
      const d = await getJSON(u);
      bars = (d?.msgArray||[]).map(x=>({t:num(x.tlong),o:num(x.o),h:num(x.h),l:num(x.l),c:num(x.z),v:num(x.v)})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite));
    } else {
      const days = priorWeekdays(interval==='60m'?18:8);
      const pts=[];
      for (const day of days) {
        try {
          const u=`https://mis.twse.com.tw/stock/api/getOhlc.jsp?ex_ch=${encodeURIComponent(ex)}&d0=${day}`;
          const d=await getJSON(u);
          for (const x of (d?.msgArray||[])) {
            const t=num(x.tlong), p=num(x.c ?? x.z), v=num(x.s ?? x.v) ?? 0;
            if(Number.isFinite(t)&&Number.isFinite(p)) pts.push({t,p,v});
          }
        } catch (_) {}
      }
      bars = aggregate(pts, interval);
    }

    const newest = bars.length ? bars[bars.length-1].t : null;
    const staleMs = quote.sourceTime ? Math.max(0, Date.now()-quote.sourceTime) : null;
    return res.status(200).json({
      ok:true,
      provider:'TWSE',
      yahooUsed:false,
      interval,
      quote,
      bars,
      barCount:bars.length,
      newestBarTime:newest,
      staleMs,
      generatedAt:Date.now()
    });
  } catch (e) {
    return res.status(502).json({ok:false,error:'twse_fetch_failed',message:String(e?.message||e),provider:'TWSE',yahooUsed:false});
  }
}
