module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const code = String(req.query.code || '2330').trim();
  const baseHeaders = {
    'User-Agent':'Mozilla/5.0',
    'Accept':'application/json,text/plain,*/*',
    'Referer':`https://mis.twse.com.tw/stock/fibest.jsp?stock=${code}`
  };
  const jar = new Map();
  function cookieHeader(){return [...jar.entries()].map(([k,v])=>`${k}=${v}`).join('; ')}
  function absorbCookie(raw){
    if(!raw) return;
    for(const chunk of raw.split(/,(?=[^;,]+=)/)){
      const pair=chunk.trim().split(';')[0];
      const eq=pair.indexOf('=');
      if(eq>0) jar.set(pair.slice(0,eq).trim(),pair.slice(eq+1).trim());
    }
  }
  async function getJSON(url){
    const headers={...baseHeaders};
    const c=cookieHeader(); if(c) headers.Cookie=c;
    const r=await fetch(url,{headers,cache:'no-store'});
    absorbCookie(r.headers.get('set-cookie'));
    const text=await r.text();
    let json=null; try{json=JSON.parse(text)}catch{}
    return {r,text,json};
  }
  try {
    const show = await getJSON(`https://mis.twse.com.tw/stock/api/getShowChart.jsp?_=${Date.now()}`);
    const stock = await getJSON(`https://mis.twse.com.tw/stock/api/getStock.jsp?ch=${encodeURIComponent(code+'.tw')}&json=1&_=${Date.now()}`);
    const row = stock.json?.msgArray?.[0];
    const key = row?.key;
    const d0 = row?.d;
    if(!key||!d0) return res.status(200).json({ok:false,stage:'getStock',stock:stock.json,cookies:[...jar.keys()]});

    const quote = await getJSON(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(key)}&json=1&delay=0&_=${Date.now()}`);
    const ohlc = await getJSON(`https://mis.twse.com.tw/stock/api/getOhlc.jsp?ex_ch=${encodeURIComponent(key)}&d0=${encodeURIComponent(d0)}&_=${Date.now()}`);
    const j=ohlc.json;
    return res.status(200).json({
      ok:ohlc.r.ok,
      showChart:show.json?.showchart ?? null,
      stockRtcode:stock.json?.rtcode || null,
      key,d0,
      quoteRtcode:quote.json?.rtcode || null,
      quoteMsgCount:Array.isArray(quote.json?.msgArray)?quote.json.msgArray.length:null,
      cookies:[...jar.keys()],
      upstreamStatus:ohlc.r.status,
      parsed:!!j,
      rtcode:j?.rtcode || null,
      rtmessage:j?.rtmessage || null,
      count:Array.isArray(j?.msgArray)?j.msgArray.length:null,
      first:Array.isArray(j?.msgArray)?j.msgArray[0]||null:null,
      last:Array.isArray(j?.msgArray)?j.msgArray[j.msgArray.length-1]||null:null,
      rawSample:j?undefined:ohlc.text.slice(0,1200)
    });
  } catch(e) {
    return res.status(200).json({ok:false,error:String(e && (e.stack || e.message) || e),cookies:[...jar.keys()]});
  }
};
