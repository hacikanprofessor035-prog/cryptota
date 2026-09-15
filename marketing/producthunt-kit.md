# CryptoTA — Product Hunt / BetaList Submission Kit

---

## Product Hunt

**Name:** CryptoTA — Free Crypto Technical Analysis Terminal

**Tagline (60 char max):**
```
Free crypto charts: 16 indicators, 6 backtests, zero signup
```
Alternatives:
```
16 indicators + 6 strategies, free. No account, no paywall
```
```
The free trading terminal that loads before you can blink
```

**Description (260 char max):**
```
Free in-browser crypto terminal: live Binance charts, 16 indicators, 6 backtestable strategies, drawing tools, multi-timeframe panel, heatmaps, price alerts, risk calculator. No signup, no paywall — open the link and you're charting. PWA for mobile.
```

**First comment (maker comment — post immediately after launch):**

Hey everyone! 👋

I built CryptoTA because every "free" charting tool I tried had the same problem: the chart wasn't the priority. Paywalls, account walls, popups, heavy frameworks that take 5 seconds to load.

So I went the opposite direction:

1️⃣ **The chart loads first.** Vanilla JS + Canvas — no framework, no build step. The whole terminal is smaller than a single hero image on most SaaS sites.

2️⃣ **No account, ever.** Open the link, you're charting. Your drawings and watchlist are saved in your browser.

3️⃣ **Actually free.** 16 indicators, 6 backtestable strategies, drawing tools, alerts, heatmap, risk calculator — none locked behind Pro. There's an optional Pro license (payable in TON), and the core terminal never asks about it.

**What's inside:**
- 16 indicators: RSI, MACD, EMA, SMA, Bollinger, Ichimoku, Stochastic, ATR, OBV, AO…
- 6 backtestable strategies with on-chart signals + equity curve
- Drawing tools that persist per pair (trend lines, fib fan, zones, text)
- Multi-timeframe panel: 5 TFs, trend/RSI/MACD/Stoch + confluence verdict
- Market heatmap (60 pairs), price alerts (browser push), risk calculator with R:R
- Share any view with a link: `/#/BTCUSDT/4h`
- PWA — install on mobile, pinch-zoom charts

**Ask me anything** — happy to talk about the vanilla-JS Canvas engine, keeping a crypto product free, or taking TON payments without a third party.

Not financial advice — this is a charting tool for your own research.

🔗 https://cryptota.duckdns.org/#/BTCUSDT/4h

**Topics:** Fintech, Crypto, Productivity

**Gallery copy (image captions):**
1. Main terminal — BTC/USDT 4h with indicators, dark theme
2. Backtesting — strategy signals + equity curve on the chart
3. Multi-timeframe panel — 5 timeframes, one verdict
4. Market heatmap — 60 pairs at a glance
5. Mobile PWA — installed on a phone, pinch-zoom

---

## BetaList

**Short pitch (140 chars max):**
```
Free crypto terminal in your browser: live charts, 16 indicators, 6 backtestable strategies. No signup, no paywall, PWA for mobile.
```

**Longer description:**

CryptoTA is a free technical analysis terminal for crypto traders that runs entirely in the browser.

No signup wall, no paywall, no 5-second framework load: you open the link and a live BTC chart is already in front of you, fed by the Binance public API in real time.

**Who it's for:** traders who want to check a chart with RSI/MACD/Bollinger without making an account, share an analysis with a link, or backtest a strategy without installing Python.

**Key features:**
- 16 indicators, stackable in panes
- 6 strategies backtested live on the chart with equity curves
- Drawing tools saved per pair in the browser
- Multi-timeframe confluence panel (5 TFs)
- Market heatmap, price alerts, risk/position calculator
- Share-by-link, one-click screenshot export
- PWA with mobile pinch-zoom

Core features are free forever; an optional Pro license adds extras and can be paid in TON.

Not financial advice.

---

## Directory one-liners

**AlternativeTo / Slant style:**
> Free alternative to TradingView — 16 indicators, 6 backtests, no signup.

**Hacker News title (Show HN):**
> Show HN: I built a crypto trading terminal in vanilla JS (no framework, no signup)

**Hacker News body:**

I wanted a charting tool that puts the chart first, so I built one.

CryptoTA is a technical analysis terminal that runs entirely in the browser: no account, no build step, no framework. Vanilla JS and Canvas 2D — the whole app is smaller than most landing-page hero images.

Live data comes from the Binance public API over WebSocket (klines, tickers, depth).

What's in it:
- 16 indicators in stackable panes
- 6 strategies backtested on the chart, with equity curves
- Drawing tools persisted per pair in localStorage
- Multi-timeframe panel, market heatmap, price alerts, risk calculator
- PWA, mobile pinch-zoom, share-by-link

Core is free; an optional Pro license is payable in TON (no card processor in the loop).

Would love feedback on the Canvas rendering approach and the no-framework decision. Not financial advice.

https://cryptota.duckdns.org/
