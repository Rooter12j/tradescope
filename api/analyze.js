export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const TF_LABELS = {
  '1': '1-minute', '5': '5-minute', '15': '15-minute',
  '60': '1-hour', '240': '4-hour', 'D': 'daily',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: 'GEMINI_API_KEY not set in Vercel environment variables.' }, 500);

  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  try {
    const {
      symbol, marketType, timeframe, tradeStyle, livePrice, change,
      technicals, zones, recentCandles,
    } = await req.json();
    const tfLabel = TF_LABELS[timeframe] || `${timeframe}-minute`;

    const priceCtx = livePrice
      ? `LIVE PRICE: ${symbol} is trading at EXACTLY ${livePrice}. Every price you output must make sense relative to ${livePrice}.`
      : `Live price unavailable. Use a realistic current market estimate for ${symbol} and put it in the currentPrice field.`;

    const dataCtx = technicals
      ? `REAL MARKET DATA computed from the actual ${tfLabel} candles (use it, do not invent your own):

TECHNICALS:
${JSON.stringify(technicals)}

DETECTED ZONES (support/resistance clusters from real swing highs/lows; "touches" = number of swing points inside the zone):
${JSON.stringify(zones || [])}

LAST 30 CANDLES as [open, high, low, close], oldest first:
${JSON.stringify(recentCandles || [])}

RULES FOR USING THIS DATA:
- The "indicators" array must reflect the technicals above (use the provided numbers as the "value" fields).
- Base entry, stop loss and take profits on the detected zones. Place the stop loss just beyond the relevant zone, with a buffer of roughly 0.5 x ATR. Prefer take profits at the next opposing zones when they make sense.
- Do not invent zones that are not in the list. You may refer to them by their price range.
- If the data shows no clear edge, return "NEUTRAL" with a lower confidence instead of forcing a trade.`
      : `No candle data was available for this symbol, so base your analysis on the live price and general market knowledge, and say so in riskWarning.`;

    const prompt = `You are TradeScope, a professional trading analysis AI.
Respond ONLY with a single valid JSON object. No markdown fences, no commentary, pure JSON only.

${priceCtx}

${dataCtx}

Analyze ${symbol} (${marketType}) on the ${tfLabel} timeframe for a ${tradeStyle} trader.
${change ? `24h change: ${change}%` : ''}

Return this exact JSON structure (all fields required, prices as plain numbers in strings, no currency symbols):
{
  "signal": "BUY" | "SELL" | "NEUTRAL",
  "confidence": <integer 0-100>,
  "trend": "BULLISH" | "BEARISH" | "SIDEWAYS",
  "volatility": "LOW" | "MEDIUM" | "HIGH",
  "riskReward": "<e.g. 1:2.5>",
  "currentPrice": "${livePrice || 'your estimate'}",
  "entryZone": "<single price, or a range written like 1.0850-1.0860>",
  "stopLoss": "<single price>",
  "takeProfit1": "<single price>",
  "takeProfit2": "<single price>",
  "takeProfit3": "<single price>",
  "marketBias": "<2 sentences on directional bias right now>",
  "priceAction": "<2-3 sentences on current price action and structure>",
  "keyLevels": "<2-3 sentences on the key support/resistance zones near current price>",
  "zoneCommentary": "<2-3 sentences explaining which detected zone is the trade's entry area, which zone invalidates it, and which zone is the target>",
  "indicators": [
    { "name": "RSI (14)", "value": "<reading>", "signal": "BUY"|"SELL"|"NEUTRAL" },
    { "name": "MACD", "value": "<reading>", "signal": "BUY"|"SELL"|"NEUTRAL" },
    { "name": "EMA 20/50", "value": "<cross status>", "signal": "BUY"|"SELL"|"NEUTRAL" },
    { "name": "Bollinger Bands", "value": "<reading>", "signal": "BUY"|"SELL"|"NEUTRAL" },
    { "name": "ATR (14)", "value": "<value>", "signal": "NEUTRAL" }
  ],
  "sessionContext": "<1-2 sentences on the active trading session>",
  "tradeScenario": "<4-5 sentences: step-by-step trade plan with specific prices>",
  "riskWarning": "<2 sentences on the main risk to this setup>",
  "binaryNote": "<digit match strategy if binary/synthetic, else empty string>"
}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      return json({ error: data?.error?.message || 'Gemini API error' }, response.status);
    }

    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || '').join('') || '{}';

    return json({ text });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
