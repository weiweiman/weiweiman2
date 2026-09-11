module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const code = String(req.query.code || '2330').trim();
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(`tse_${code}.tw`)}&json=1&delay=0&_=${Date.now()}`;
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json,text/plain,*/*',
        'Referer': `https://mis.twse.com.tw/stock/fibest.jsp?stock=${code}`
      },
      cache: 'no-store'
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const setCookie = r.headers.get('set-cookie');
    return res.status(200).json({
      ok: r.ok,
      upstreamStatus: r.status,
      contentType: r.headers.get('content-type'),
      hasSetCookie: !!setCookie,
      setCookie: setCookie || null,
      length: text.length,
      parsed: !!json,
      sample: json ? json : text.slice(0, 1000)
    });
  } catch (e) {
    return res.status(200).json({ok:false,error:String(e && (e.stack || e.message) || e)});
  }
};
