module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const code = String(req.query.code || '2330').trim();
  const d0 = String(req.query.d0 || '20260911').trim();
  const ex = `tse_${code}.tw`;
  const baseHeaders = {
    'User-Agent':'Mozilla/5.0',
    'Accept':'application/json,text/plain,*/*',
    'Referer':`https://mis.twse.com.tw/stock/fibest.jsp?stock=${code}`
  };
  try {
    const qurl = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(ex)}&json=1&delay=0&_=${Date.now()}`;
    const qr = await fetch(qurl,{headers:baseHeaders,cache:'no-store'});
    const qtext = await qr.text();
    let qjson=null; try{qjson=JSON.parse(qtext)}catch{}
    const rawCookie = qr.headers.get('set-cookie') || '';
    const cookie = rawCookie.split(';')[0] || '';

    const url = `https://mis.twse.com.tw/stock/api/getOhlc.jsp?ex_ch=${encodeURIComponent(ex)}&d0=${encodeURIComponent(d0)}&_=${Date.now()}`;
    const r = await fetch(url, {
      headers: {...baseHeaders, ...(cookie?{'Cookie':cookie}:{})},
      cache:'no-store'
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return res.status(200).json({
      ok:r.ok,
      quoteRtcode:qjson?.rtcode || null,
      quoteDate:qjson?.msgArray?.[0]?.d || null,
      hasSession:!!cookie,
      upstreamStatus:r.status,
      parsed:!!json,
      rtcode:json?.rtcode || null,
      rtmessage:json?.rtmessage || null,
      count:Array.isArray(json?.msgArray)?json.msgArray.length:null,
      first:Array.isArray(json?.msgArray)?json.msgArray[0]||null:null,
      last:Array.isArray(json?.msgArray)?json.msgArray[json.msgArray.length-1]||null:null,
      rawSample:json?undefined:text.slice(0,1000)
    });
  } catch(e) {
    return res.status(200).json({ok:false,error:String(e && (e.stack || e.message) || e)});
  }
};
