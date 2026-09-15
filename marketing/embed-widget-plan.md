# CryptoTA — Embeddable Chart Widget (viral growth channel)

**Idea:** any blog/forum/docs page can paste 2 lines and get a live candlestick chart.
Every embedded chart is a free, permanent backlink and a top-of-funnel entry point.

## Why it works

TradingView grew to millions of users largely through embedded widgets. The pattern:
people embed charts in blog posts → readers see them → a percentage click through.
Zero acquisition cost, compounding forever.

CryptoTA is uniquely suited: the entire chart engine is vanilla JS + Canvas with zero
dependencies, and the embed script is ~4KB.

## The embed snippet

```html
<div id="cta-chart"></div>
<script src="https://cryptota.duckdns.org/js/embed-chart.js"></script>
<script>
  CryptoTAEmbed.mount({
    symbol: 'BTCUSDT',
    interval: '4h',
    canvasId: 'cta-chart',
    // optional elements — omit to skip
    priceId: 'cta-price',
    changeId: 'cta-change',
    quoteId: 'cta-vol'
  });
</script>
```

Minimal form (chart only, no price header):

```html
<canvas id="cta-chart" width="640" height="220"></canvas>
<script src="https://cryptota.duckdns.org/js/embed-chart.js"></script>
<script>CryptoTAEmbed.mount({symbol:'BTCUSDT', interval:'1h', canvasId:'cta-chart'})</script>
```

## Roadmap ( phase 2 — not yet implemented )

1. **Branded footer on embeds** — small "Charts by CryptoTA →" link under every widget.
   This is the actual growth mechanism (TradingView's "TradingView" watermark).
2. **One-line snippet generator** — a `/embed.html` builder page where a user picks
   pair/TF/size and copies the code.
3. **Click-through** — clicking the embedded chart opens the full terminal at the
   same pair/timeframe.
4. **Theme options** — `theme: 'dark' | 'light'` for blog backgrounds.
5. **Stat endpoint** — count embed loads to measure referral volume.

## Target sites for outreach

- Crypto news blogs on WordPress/Ghost (easiest — paste any script)
- Reddit/Telegram trading communities that allow "tools" in wiki/sidebar
- Notion/Obsidian second-brain users who track prices in docs
- Dev.to and Medium crypto tutorial authors (they embed charts in tutorials)
- DApp docs pages that need a "live price" panel

## Outreach DM template (English)

> Hey — I saw your post on [topic]. I've built a free charting terminal
> (no signup, no paywall) and it has a 2-line embed widget that puts a live
> [PAIR] candlestick chart on any page. It's ~4KB and doesn't slow the page.
> Would it be useful for your articles? Happy to add an option you need.

Keep it 4 sentences. No links to pricing. Offer to customize — that's the hook.
