module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Access-Control-Allow-Origin','*');
  const code=String(req.query.code||'2330').trim();
  const baseHeaders={
    'User-Agent':'Mozilla/5.0',
    'Accept':'application/json,text/plain,*/*',
    'Referer':`https://mis.twse.com.tw/stock/fibest.jsp?stock=${code}`
  };
  const jar=new Map();
  function cookieHeader(){return [...jar.entries()].map(([k,v])=>`${k}=${v}`).join('; ')}
  function absorb(raw){if(!raw)return;for(const chunk of raw.split(/,(?=[^;,]+=)/)){const pair=chunk.trim().split(';')[0];const i=pair.indexOf('=');if(i>0)jar.set(pair.slice(0,i).trim(),pair.slice(i+1).trim())}}
  async function get(url){const headers={...baseHeaders};const c=cookieHeader();if(c)headers.Cookie=c;const r=await fetch(url,{headers,cache:'no-store'});absorb(r.headers.get('set-cookie'));const text=await r.text();let json=null;try{json=JSON.parse(text)}catch{}return{r,text,json}}
  try{
    const s=await get(`https://mis.twse.com.tw/stock/api/getStock.jsp?ch=${encodeURIComponent(code+'.tw')}&json=1&_=${Date.now()}`);
    const row=s.json?.msgArray?.[0];
    if(!row?.key||!row?.d)return res.status(200).json({ok:false,stage:'stock',raw:s.json});
    const end=row.d;
    const y=Number(end.slice(0,4)),m=Number(end.slice(4,6)),d=Number(end.slice(6,8));
    const sd=new Date(y,m-1,d);sd.setMonth(sd.getMonth()-12);
    const pad=n=>String(n).padStart(2,'0');
    const start=`${sd.getFullYear()}${pad(sd.getMonth()+1)}${pad(sd.getDate())}`;
    const q=await get(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(row.key)}&json=1&delay=0&_=${Date.now()}`);
    const u=`https://mis.twse.com.tw/stock/api/getDailyRangeWithMA.jsp?ex_ch=${encodeURIComponent(row.key)}&d0=${start}&d1=${end}&_=${Date.now()}`;
    const rr=await get(u);
    const j=rr.json;
    return res.status(200).json({ok:rr.r.ok,key:row.key,start,end,quoteRtcode:q.json?.rtcode||null,status:rr.r.status,parsed:!!j,rtcode:j?.rtcode||null,rtmessage:j?.rtmessage||null,count:Array.isArray(j?.msgArray)?j.msgArray.length:null,first:Array.isArray(j?.msgArray)?j.msgArray[0]||null:null,last:Array.isArray(j?.msgArray)?j.msgArray[j.msgArray.length-1]||null:null,rawSample:j?undefined:rr.text.slice(0,1200)});
  }catch(e){return res.status(200).json({ok:false,error:String(e&&e.stack||e)})}
};
