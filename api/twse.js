module.exports = async function handler(req, res) {
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

  const misBase = 'https://mis.twse.com.tw/stock/api/';
  const commonHeaders = {
    'User-Agent':'Mozilla/5.0 (compatible; TW-DayTrade-Pro/2.2)',
    'Accept':'application/json,text/plain,*/*',
    'Referer':`https://mis.twse.com.tw/stock/fibest.jsp?stock=${code}`
  };
  const jar = new Map();
  const num = v => { const n = Number(String(v ?? '').replace(/,/g,'')); return Number.isFinite(n) ? n : null; };
  const pad = n => String(n).padStart(2,'0');

  function absorbCookie(raw){
    if(!raw) return;
    for(const chunk of raw.split(/,(?=[^;,]+=)/)){
      const pair = chunk.trim().split(';')[0];
      const i = pair.indexOf('=');
      if(i > 0) jar.set(pair.slice(0,i).trim(), pair.slice(i+1).trim());
    }
  }
  function cookieHeader(){ return [...jar.entries()].map(([k,v])=>`${k}=${v}`).join('; '); }
  async function getJSON(url, useCookies=true){
    const ctl = new AbortController();
    const timer = setTimeout(()=>ctl.abort(), 6500);
    try{
      const headers = {...commonHeaders};
      if(useCookies){ const c = cookieHeader(); if(c) headers.Cookie = c; }
      const r = await fetch(url,{headers,cache:'no-store',signal:ctl.signal});
      absorbCookie(r.headers.get('set-cookie'));
      const text = await r.text();
      if(!r.ok) throw new Error(`TWSE HTTP ${r.status}`);
      try { return JSON.parse(text); }
      catch { throw new Error('TWSE returned non-JSON response'); }
    } finally { clearTimeout(timer); }
  }
  function bucketMs(iv){ return iv==='1m'?60000:iv==='5m'?300000:iv==='15m'?900000:3600000; }
  function aggregate(points, iv){
    const span = bucketMs(iv), m = new Map();
    for(const p of points){
      if(!Number.isFinite(p.t) || !Number.isFinite(p.p)) continue;
      const k = Math.floor(p.t/span)*span;
      let b = m.get(k);
      if(!b){ b={t:k,o:p.p,h:p.p,l:p.p,c:p.p,v:0}; m.set(k,b); }
      b.h=Math.max(b.h,p.p); b.l=Math.min(b.l,p.p); b.c=p.p; b.v += Number.isFinite(p.v)?p.v:0;
    }
    return [...m.values()].sort((a,b)=>a.t-b.t);
  }
  function twDateMs(yyyymmdd){
    if(!/^\d{8}$/.test(String(yyyymmdd||''))) return null;
    const y=+yyyymmdd.slice(0,4),m=+yyyymmdd.slice(4,6),d=+yyyymmdd.slice(6,8);
    return Date.UTC(y,m-1,d,5,30,0);
  }
  function rocDateMs(s){
    const m=String(s||'').match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);
    if(!m) return null;
    return Date.UTC(Number(m[1])+1911,Number(m[2])-1,Number(m[3]),5,30,0);
  }
  function monthKeys(endDate, count=5){
    const y=Number(endDate.slice(0,4)), m=Number(endDate.slice(4,6));
    const out=[];
    for(let i=0;i<count;i++){
      const d=new Date(Date.UTC(y,m-1-i,1));
      out.push(`${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}01`);
    }
    return out;
  }
  async function getDailyBars(endDate, quote){
    const months = monthKeys(endDate,5);
    const all=[];
    for(const date of months){
      const u=`https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${encodeURIComponent(code)}&_=${Date.now()}`;
      try{
        const j=await getJSON(u,false);
        if(j?.stat!=='OK' || !Array.isArray(j.data)) continue;
        for(const row of j.data){
          const t=rocDateMs(row?.[0]), o=num(row?.[3]), h=num(row?.[4]), l=num(row?.[5]), c=num(row?.[6]), v=num(row?.[1]);
          if([t,o,h,l,c].every(Number.isFinite)) all.push({t,o,h,l,c,v:v??0});
        }
      }catch{}
    }
    const byTime=new Map(all.map(b=>[b.t,b]));
    const qt=twDateMs(quote.tradeDate);
    if(Number.isFinite(qt) && !byTime.has(qt) && [quote.open,quote.high,quote.low,quote.price].every(Number.isFinite)){
      byTime.set(qt,{t:qt,o:quote.open,h:quote.high,l:quote.low,c:quote.price,v:quote.volume??0,partial:true});
    }
    return [...byTime.values()].sort((a,b)=>a.t-b.t);
  }

  try{
    // Follow the same sequence as the TWSE MIS page to establish its session and current stock key.
    const stock = await getJSON(`${misBase}getStock.jsp?ch=${encodeURIComponent(code+'.tw')}&json=1&_=${Date.now()}`);
    const stockRow = stock?.msgArray?.[0];
    if(stock?.rtcode!=='0000' || !stockRow?.key || stockRow?.ex!=='tse'){
      return res.status(422).json({ok:false,error:'not_twse_listed',message:'此代號不是證交所上市（TSE）股票，TWSE-only 模式不切換其他來源。',provider:'TWSE',yahooUsed:false});
    }

    const key = stockRow.key;
    const quoteRaw = await getJSON(`${misBase}getStockInfo.jsp?ex_ch=${encodeURIComponent(key)}&json=1&delay=0&_=${Date.now()}`);
    const q = quoteRaw?.msgArray?.find(x=>x?.c===code) || quoteRaw?.msgArray?.[0];
    if(quoteRaw?.rtcode!=='0000' || !q) return res.status(502).json({ok:false,error:'twse_quote_unavailable',message:quoteRaw?.rtmessage||'TWSE quote unavailable',provider:'TWSE',yahooUsed:false});
    if(q.ex!=='tse') return res.status(422).json({ok:false,error:'not_twse_listed',message:'TWSE-only 模式拒絕非 TSE 資料。',provider:'TWSE',yahooUsed:false});

    const bid=(q.b||'').split('_').filter(Boolean).map(Number), ask=(q.a||'').split('_').filter(Boolean).map(Number);
    const quote={
      code:q.c,name:q.n,fullName:q.nf,exchange:q.ex,
      price:num(q.z)??num(q.pz)??num(bid[0])??num(ask[0]),open:num(q.o),high:num(q.h),low:num(q.l),prevClose:num(q.y),
      volume:num(q.v),tradeVolume:num(q.tv),bid,ask,
      bidVol:(q.g||'').split('_').filter(Boolean).map(Number),askVol:(q.f||'').split('_').filter(Boolean).map(Number),
      limitUp:num(q.u),limitDown:num(q.w),tradeTime:q.t||null,tradeDate:q.d||stockRow.d||null,sourceTime:num(q.tlong),source:'TWSE MIS getStockInfo'
    };

    let bars=[], barSource='', barStatus='available', showChart=null;
    if(interval==='1d'){
      bars = await getDailyBars(quote.tradeDate || stockRow.d, quote);
      barSource = 'TWSE STOCK_DAY official daily API + MIS current quote';
      if(bars.length===0) barStatus='twse_daily_unavailable';
    }else{
      const show = await getJSON(`${misBase}getShowChart.jsp?_=${Date.now()}`);
      showChart = show?.showchart === true;
      if(showChart){
        const d0 = quote.tradeDate || stockRow.d;
        const ohlc = await getJSON(`${misBase}getOhlc.jsp?ex_ch=${encodeURIComponent(key)}&d0=${encodeURIComponent(d0)}&_=${Date.now()}`);
        const pts=[];
        for(const x of (ohlc?.msgArray||[])){
          const t=num(x.tlong), p=num(x.c??x.z), v=num(x.s??x.v)??0;
          if(Number.isFinite(t)&&Number.isFinite(p)) pts.push({t,p,v});
        }
        bars=aggregate(pts,interval);
        barSource='TWSE MIS getOhlc → local interval aggregation';
        if(bars.length===0) barStatus='twse_intraday_no_data';
      }else{
        bars=[];
        barSource='TWSE MIS getOhlc';
        barStatus='twse_intraday_chart_unavailable_after_hours';
      }
    }

    const sourceTime=quote.sourceTime;
    const staleMs=Number.isFinite(sourceTime)?Math.max(0,Date.now()-sourceTime):null;
    return res.status(200).json({
      ok:true,provider:'TWSE',yahooUsed:false,market:'TSE',interval,quote,bars,barCount:bars.length,
      barSource,barStatus,showChart,newestBarTime:bars.length?bars[bars.length-1].t:null,staleMs,generatedAt:Date.now()
    });
  }catch(e){
    return res.status(502).json({ok:false,error:'twse_fetch_failed',message:String(e?.name==='AbortError'?'TWSE request timeout':e?.message||e),provider:'TWSE',yahooUsed:false});
  }
};
