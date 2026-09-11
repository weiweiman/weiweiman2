module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const code = String(req.query.code || '2330').trim();
  const d0 = String(req.query.d0 || '20260911').trim();
  const ex = `tse_${code}.tw`;
  const url = `https://mis.twse.com.tw/stock/api/getOhlc.jsp?ex_ch=${encodeURIComponent(ex)}&d0=${encodeURIComponent(d0)}`;
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent':'Mozilla/5.0',
        'Accept':'application/json,text/plain,*/*',
        'Referer':`https://mis.twse.com.tw/stock/fibest.jsp?stock=${code}`
      },
      cache:'no-store'
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return res.status(200).json({
      ok:r.ok,
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
