# CryptoTA — Reddit Posts

⚠ **Read `reddit-strategy.md` first.** It contains the rules we found and the warm-up plan.
Posting from a cold account, or with a bad promo ratio, is how accounts get banned.

**Short version:**
- r/CryptoCurrency Rule 9: **3 comments per post minimum**, ongoing.
- r/CryptoCurrency Rule 3: **never link the Reddit post from X/Telegram** ( brigading ).
- r/algotrading: no product/self-promo posts — educational methodology only.
- Site-wide ~10:1 non-promo : promo.
- Start in r/SideProject ( it exists for this ), then Daily Discussion threads.

Subreddits: r/SideProject, r/IndieHackers, r/Sidehustle, r/CryptoCurrency ( daily thread ),
r/Bitcoin, r/Ethereum, r/algotrading ( methodology only ).

---

## Post 1 — r/SideProject ( FIRST post — this sub exists for showing projects )

**Title:** Built a free crypto trading terminal with no framework, no build step, no signup wall

**Body:**

I kept running into the same thing with "free" charting tools: the chart wasn't the priority.
Paywalls, account walls, popups, and 5-second framework load times before you see a single candle.

So I built the opposite.

**The constraints I gave myself:**
- Vanilla JS + Canvas 2D. No React, no webpack, no dependencies.
- The whole app is smaller than a single hero image on most SaaS landing pages — it loads in about a second.
- No account, no email, no download. Open the link → chart is live.

**What's in it:**
- 16 indicators ( RSI, MACD, EMA, SMA, Bollinger Bands, Ichimoku, Stochastic, ATR, OBV… ), stackable in panes
- 6 strategies you can **backtest on the chart**: EMA Cross, RSI Divergence, MACD Cross, BB Squeeze, Mean Reversion, Supertrend+RSI — entry/exit signals + equity curve
- Drawing tools ( trend lines, rectangles, fib fan, horizontal levels, text notes ) saved per pair in the browser
- Multi-timeframe panel: trend/RSI/MACD/Stoch across 5 TFs with a confluence verdict
- Market heatmap of 60 pairs, price alerts via browser push, risk calculator with position sizing
- PWA — installs on the phone, pinch-zoom charts
- Share any view with a link: `/#/BTCUSDT/4h`

**Tech notes for the builders here:** the chart engine is hand-rolled Canvas 2D with a
data↔pixel transform layer so drawing tools can be stored in price/time space and re-rendered
on any resize. Live data is Binance public WebSocket ( klines, tickers, depth ). Backends are
Node/Express/SQLite on a VPS behind Caddy, with a Cloudflare Pages mirror.

**Monetization:** core is free forever. Optional Pro license, paid in TON — no card processor
in the loop, which is what made the whole "free core" math actually work.

**Honest status:** I'm a solo dev with zero marketing budget. Happy to answer anything about
the vanilla-JS approach, the Canvas engine, or taking crypto payments without a third party.

Link: https://cryptota.duckdns.org/

Not financial advice — it's a charting tool for your own research.

---

## Post 1b — r/CryptoCurrency Daily Discussion ( after warm-up, week 3 )

**Keep it short. Daily threads move fast; a wall of text gets ignored.**

**Body:**

For anyone who wants to check a chart with RSI/MACD/Bollinger without making an account or
closing three paywall popups — I built a free terminal that loads the chart first.

Live Binance data, 16 indicators, 6 backtestable strategies, drawing tools that save in your
browser, price alerts, mobile PWA. No signup.

https://cryptota.duckdns.org/#/BTCUSDT/4h

Not financial advice, and I'm not claiming it predicts anything — it's just a charting tool.

---

## Post 2 — r/algotrading ( educational framing — their rules ban product/self-promo posts )

**⚠ Read first:** r/algotrading forbids "posts for the sole purpose of generating referrals/sales"
and proprietary software. Post this as **methodology**, not as a product launch. Mention the tool
only if a commenter asks for tooling. Never lead with the link.

**Title:** How I backtest a mean-reversion entry on live crypto data ( no signup, no Python )

**Body:**

Sharing a workflow, not a product — mods remove the other kind.

**The setup:** mean reversion fades extremes back to the mean. On crypto the cleanest version
I've found uses Bollinger Bands as the trigger and RSI as the filter:

1. Price closes outside the lower band ( stretched move down )
2. RSI is below 30 *and* curling up ( exhaustion, not just stretched )
3. Enter on the close back inside the band ( the reversal is confirmed )
4. Target: the 20 SMA ( the mean the band is built on )
5. Stop: just below the entry candle's low

**Why that order matters:** band touches alone are noise in a trend — every strong move
"tags the band" and keeps going. Adding the RSI curl filters out the ones where momentum
is still one-directional.

**Where I run it:** I built a browser tool that backtests this directly on the chart so I can
see signals on the candles instead of staring at a results table. It's free, no account,
data is Binance public API. Happy to share the link if useful — not dropping it unprompted
since the sub doesn't like that.

**The honest caveat:** mean reversion works in ranges and gets destroyed in trends. Over the
last ~250 candles on 4h BTC this entry type printed more false signals than profitable ones
in trending regimes. Use it on ranging pairs, or pair it with a trend filter.

What would you change about the entry logic?

---

## Post 2b — r/algotrading fallback: pure methodology, no tool mention at all

Use this if the mods are strict or the sub feels hostile to any tool mention.

**Title:** A simple filter for mean-reversion entries that removes most of the bad ones

**Body:**

Mean reversion is the strategy everyone breaks on. The failure mode is always the same:
you fade a stretched move, and it was stretched because it was trending.

The cheapest filter I've found: **require a momentum curl, not just a stretch.**

- Price tags the lower Bollinger Band → that's the *stretch*
- RSI below 30 → still just stretch
- **RSI curling up while price closes back inside the band** → that's exhaustion + reversal

The difference is that the third condition can only print after momentum has actually turned.
Stretches in a strong trend never satisfy it — which is exactly the set you wanted to skip.

Backtest it on any charting tool that lets you see RSI and BB together. The improvement in
win-rate vs. blind band-touch entries is obvious within an hour of scrolling pairs.

Curious what others use as a regime filter — I rotate between ADX and a simple
"price below all three EMAs" check, and I'm not convinced either is best.

---

## Post 2c — r/Bitcoin ( utility framing, keep it small )

**Title:** Live BTC chart with 16 indicators and zero signup walls

**Body:**

Simple one. If you want to look at the BTC chart with RSI, MACD or Bollinger Bands without making an account or closing three paywall popups:

https://cryptota.duckdns.org/p/bitcoin.html

It's a live candlestick chart fed by Binance. From there you can jump into the full terminal, draw trend lines, set price alerts, backtest a strategy, or share your view with a link like `/#/BTCUSDT/4h`.

Mobile works too — it's a PWA, so you can install it from the browser and it behaves like an app.

No signup. Not financial advice.

---

## Post 4 — r/SideProject / r/IndieHackers / r/Sidehushle ( use Post 1 above — it is already this )

Post 1 covers this audience. Do not double-post the same content into multiple subs in the
same week — that reads as spam and Reddit's duplicate-content filters will catch it.
Stagger: one sub per week, and vary the title/body between them.
