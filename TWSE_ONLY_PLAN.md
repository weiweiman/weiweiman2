# v2.2 TWSE-only data engine

This branch/plan replaces Yahoo Finance entirely with Taiwan Stock Exchange (TWSE) official market data sources.

Target endpoints used by the server-side gateway:
- `https://mis.twse.com.tw/stock/api/getStockInfo.jsp` — realtime quote, volume, bid/ask, trading timestamp.
- `https://mis.twse.com.tw/stock/api/getOhlc.jsp` — intraday chart points from TWSE MIS, aggregated server-side into 5m/15m/60m bars.
- `https://mis.twse.com.tw/stock/api/getDailyRangeWithMA.jsp` — official historical daily OHLC/MA data for daily indicators and warm-up.

No Yahoo endpoint or fallback is allowed. If TWSE data is unavailable or stale, the app returns `unavailable` and does not generate a long/short score.

Browser calls go through `/api/twse` because GitHub Pages cannot reliably read MIS responses cross-origin (CORS). The gateway is intended for serverless deployment (Vercel) and sets `Cache-Control: no-store` for realtime responses.
