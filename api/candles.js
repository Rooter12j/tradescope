export const config = { runtime: 'edge' };

const TD_INTERVAL = {
  '1': '1min', '5': '5min', '15': '15min',
  '60': '1h', '240': '4h', 'D': '1day',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function toEpoch(dt) {
  // "2026-10-03 09:45:00" (UTC) or "2026-10-03" (daily)
  const iso = dt.length === 10 ? `${dt}T00:00:00Z` : `${dt.replace(' ', 'T')}Z`;
  return Math.floor(Date.parse(iso) / 1000);
}

export default async function handler(req) {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    return json({ error: 'TWELVEDATA_API_KEY is not set in Vercel environment variables.' }, 500);
  }

  const url = new URL(req.url);
  const symbol = url.searchParams.get('symbol');      // e.g. EUR/USD
  const tf = url.searchParams.get('interval') || '15';
  const interval = TD_INTERVAL[tf];

  if (!symbol || !/^[A-Za-z]{3,6}\/[A-Za-z]{3,6}$/.test(symbol)) {
    return json({ error: 'Invalid or missing symbol. Use a pair like EUR/USD.' }, 400);
  }
  if (!interval) return json({ error: 'Unsupported interval.' }, 400);

  try {
    const api = new URL('https://api.twelvedata.com/time_series');
    api.searchParams.set('symbol', symbol.toUpperCase());
    api.searchParams.set('interval', interval);
    api.searchParams.set('outputsize', '300');
    api.searchParams.set('order', 'ASC');
    api.searchParams.set('timezone', 'UTC');

    const r = await fetch(api.toString(), { headers: { Authorization: `apikey ${apiKey}` } });
    const data = await r.json();

    if (data.status === 'error' || !Array.isArray(data.values)) {
      return json({ error: data.message || 'Twelve Data returned no candles.' }, 502);
    }

    const candles = data.values
      .map(v => ({
        time: toEpoch(v.datetime),
        open: parseFloat(v.open),
        high: parseFloat(v.high),
        low: parseFloat(v.low),
        close: parseFloat(v.close),
      }))
      .filter(c => Number.isFinite(c.time) && Number.isFinite(c.close))
      .sort((a, b) => a.time - b.time);

    return json({ candles });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
