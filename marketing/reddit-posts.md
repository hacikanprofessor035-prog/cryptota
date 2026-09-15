# CryptoTA — Reddit Posts

 subreddit list ( r/CryptoCurrency, r/Bitcoin, r/Ethereum, r/algotrading, r/Daytrading ).
**Rule:** read each subreddit's rules first — many ban promotion outside megathreads or require low self-promo ratio. r/CryptoCurrency enforces this hard; post only in designated threads unless rules allow otherwise.

---

## Post 1 — r/CryptoCurrency "Daily Discussion" (safe entry)

**Title:** Free in-browser crypto charting terminal — no signup, 16 indicators + backtests

**Body:**

I got tired of "free" charting tools where every second indicator is behind a Pro wall, so I built one that isn't.

**What it is:** a technical analysis terminal that runs entirely in the browser. You open the link and the BTC chart is already live — no account, no email, no download.

**What's in it:**
- 16 indicators (RSI, MACD, EMA, Bollinger Bands, Ichimoku, Stochastic, ATR, OBV, …), stackable in multiple panes
- 6 strategies you can **backtest on the chart**: EMA Cross, RSI Divergence, MACD Cross, BB Squeeze, Mean Reversion, Supertrend+RSI — with entry/exit signals and an equity curve
- Drawing tools (trend lines, rectangles, fib fan, horizontal levels, text notes) that save in your browser per pair
- Multi-timeframe panel: trend/RSI/MACD/Stoch across 5 TFs at once with a confluence verdict
- Market heatmap of 60 pairs, price alerts via browser push, risk calculator with position sizing
- It's a PWA — installs on your phone, pinch-zoom charts

Data comes straight from the Binance public API (WebSocket), so it's real-time.

**Cost:** everything above is free. There's an optional Pro license for extras (payable in TON) — the core terminal never asks for it.

Link: https://cryptota.duckdns.org/#/BTCUSDT/4h

Happy to answer questions or take feature requests. Not financial advice — it's a charting tool for your own research.

---

## Post 2 — r/algotrading

**Title:** Backtest 6 strategies directly on live Binance charts — free, in-browser, no signup

**Body:**

Most backtesting tools want you to install something, write Python, or pay. I went the other way.

CryptoTA runs backtests **on the chart you're already looking at**, in the browser:

| Strategy | What it does |
|---|---|
| EMA Cross | trend following on EMA crossovers |
| RSI Divergence | reversal when price/RSI disagree |
| MACD Cross | momentum crossover entries |
| BB Squeeze | volatility-breakout entries |
| Mean Reversion | fade extremes back to the mean |
| Supertrend+RSI | filtered trend following |

Signals are plotted on the candles, and the equity curve renders below the price so you can see where the strategy actually made money vs. where it bled.

Data: Binance public API, all spot pairs, every timeframe. No API key needed (read-only public data).

It's vanilla JS + Canvas — the whole thing loads in about a second. Free, no account. Optional Pro extras (TON), the backtesting is not one of them.

Try it: https://cryptota.duckdns.org/#/BTCUSDT/4h

Standard disclaimer: this is a tool, not financial advice, and past performance doesn't guarantee anything.

---

## Post 3 — r/Bitcoin

**Title:** Live BTC chart with 16 indicators and zero signup walls

**Body:**

Simple one. If you want to look at the BTC chart with RSI, MACD or Bollinger Bands without making an account or closing three paywall popups:

https://cryptota.duckdns.org/p/bitcoin.html

It's a live candlestick chart fed by Binance. From there you can jump into the full terminal, draw trend lines, set price alerts, backtest a strategy, or share your view with a link like `/#/BTCUSDT/4h`.

Mobile works too — it's a PWA, so you can install it from the browser and it behaves like an app.

No signup. Not financial advice.

---

## Post 4 — r/SideProject / r/IndieHackers / r/Sidehustle

**Title:** Built a crypto trading terminal with no framework and no build step

**Body:**

Vanilla JS + Canvas 2D, one HTML file plus some JS/CSS. No React, no webpack, no dependencies. The entire app is smaller than a single hero image on most SaaS landing pages — it loads in about a second on mobile.

**The features:** 16 indicators, 6 backtestable strategies, drawing tools, multi-timeframe analysis, heatmaps, price alerts, risk calculator, PWA install, share-by-link.

**Monetization:** core is free forever. Optional Pro license, paid in TON (crypto-native — no card processor, no Stripe fees eating the margin).

**Hosting:** static files + Node API on a VPS behind Caddy, mirrored on Cloudflare Pages. Costs are basically zero.

It's live: https://cryptota.duckdns.org/

AMA about the vanilla-JS approach, the Canvas charting engine, or taking crypto payments without a third party.
