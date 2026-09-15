/* === CryptoTA — Main App === */

const App = (() => {
    /* ============== Watchlist (favorites) ============== */
    const Watchlist = (() => {
        const LS_KEY = 'cryptota.watchlist';
        let items = [];           // symbols in add order
        let collapsed = false;

        function load() {
            try {
                items = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
                collapsed = localStorage.getItem(LS_KEY + '.collapsed') === '1';
            } catch (e) { items = []; }
        }

        function save() {
            try {
                localStorage.setItem(LS_KEY, JSON.stringify(items));
                localStorage.setItem(LS_KEY + '.collapsed', collapsed ? '1' : '0');
            } catch (e) { /* full */ }
        }

        function has(sym) { return items.includes(sym); }
        function toggle(sym) {
            const i = items.indexOf(sym);
            if (i >= 0) { items.splice(i, 1); }
            else items.push(sym);
            save();
            render();
            renderPairList();
        }
        function toggleCollapse() {
            collapsed = !collapsed;
            save();
            render();
        }
        function render() {
            const box = document.getElementById('watchlist');
            const wrap = document.getElementById('watchlistItems');
            if (!box || !wrap) return;
            box.style.display = items.length ? '' : 'none';
            if (!items.length) return;
            const colBtn = document.getElementById('watchlistCollapse');
            if (colBtn) colBtn.textContent = collapsed ? '+' : '−';
            if (collapsed) { wrap.style.display = 'none'; return; }
            wrap.style.display = '';
            wrap.innerHTML = items.map(sym => {
                const p = state.pairs.find(x => x.symbol === sym);
                const t = state.tickers[sym];
                const last = t ? t.last : null;
                const change = t ? t.change : null;
                const cls = change > 0 ? 'up' : (change < 0 ? 'down' : 'flat');
                const sign = change > 0 ? '+' : '';
                const base = p ? p.base : sym.replace(/USDT$|BTC$|ETH$|BNB$/, '');
                const quote = p ? '/' + p.quote : '';
                return `
                    <div class="pair-row wl-row ${sym === state.activePair ? 'active' : ''}" data-symbol="${sym}">
                        <button class="pair-fav active" data-fav="${sym}" title="Remove from favorites">★</button>
                        <div class="pair-symbol">
                            <span class="pair-symbol-base">${base}</span>
                            <span class="pair-symbol-quote">${quote}</span>
                        </div>
                        <div class="pair-price">${last !== null ? formatPrice(last) : '—'}</div>
                        <div class="pair-change ${cls}">${change !== null ? sign + change.toFixed(2) + '%' : '—'}</div>
                        <div class="pair-volume"><span class="pair-volume-text">${t ? formatVolume(t.quoteVolume) : ''}</span></div>
                    </div>
                `;
            }).join('');
            wrap.querySelectorAll('.wl-row').forEach(row => {
                row.addEventListener('click', () => selectPair(row.dataset.symbol));
            });
            wrap.querySelectorAll('.pair-fav').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggle(btn.dataset.fav);
                });
            });
        }

        return { load, has, toggle, toggleCollapse, render };
    })();


    /* ============== Share links (chart state in URL hash) ==============
     * Format: #/<SYMBOL>/<TF>?d=<base64url drawing objects>
     * Compact JSON: lines as arrays [type?, t1, p1, t2?, p2?]. */
    const Share = (() => {
        const b64e = (s) => btoa(JSON.stringify(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const b64d = (s) => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/')));

        function encodeObjects(objs) {
            const compact = objs.map(o => {
                if (o.type === 'hline') return [1, o.price];
                if (o.type === 'rect') return [2, o.time1, o.price1, o.time2, o.price2];
                if (o.type === 'fib') return [3, o.time1, o.price1, o.time2, o.price2];
                return [0, o.time1, o.price1, o.time2, o.price2];   // segment
            });
            return b64e(compact);
        }

        function decodeObjects(code) {
            try {
                const compact = b64d(code);
                return compact.map(c => {
                    const k = c[0];
                    if (k === 1) return { type: 'hline', price: c[1] };
                    if (k === 2) return { type: 'rect', time1: c[1], price1: c[2], time2: c[3], price2: c[4] };
                    if (k === 3) return { type: 'fib', time1: c[1], price1: c[2], time2: c[3], price2: c[4] };
                    return { time1: c[1], price1: c[2], time2: c[3], price2: c[4] };
                }).filter(o => o && (o.price != null || o.price1 != null));
            } catch (e) {
                return null;
            }
        }

        function buildHash() {
            const objs = window.Drawing ? Drawing.getObjects() : [];
            let hash = `#/${state.activePair || 'BTCUSDT'}/${state.timeframe}`;
            if (objs.length) hash += `?d=${encodeObjects(objs)}`;
            return hash;
        }

        function copyLink() {
            const url = location.origin + location.pathname + buildHash();
            const done = () => showToast('Link copied — share your setup!');
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url, done));
            } else fallbackCopy(url, done);
        }

        function fallbackCopy(text, done) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); done(); }
            catch (e) { showToast('Copy failed — URL is in the address bar'); }
            ta.remove();
        }

        /* parse location.hash → {symbol, tf, objects} | null */
        function parseHash() {
            const h = location.hash;
            if (!h.startsWith('#/')) return null;
            const m = h.match(/^#\/([A-Z0-9]+)\/(\w+)(?:\?d=([\w-]+))?/);
            if (!m) return null;
            return {
                symbol: m[1],
                tf: m[2],
                objects: m[3] ? decodeObjects(m[3]) : null
            };
        }

        return { encodeObjects, decodeObjects, buildHash, copyLink, parseHash };
    })();


    const state = {
        pairs: [],                // [{symbol, base, quote}]
        tickers: {},              // symbol -> {last, change, ...}
        activeQuote: 'USDT',
        searchQuery: '',
        activePair: null,
        timeframe: '4h',
        chartType: 'candles',
        candles: [],
        indicators: [],           // active indicators (with computed data)
        strategies: [],           // active strategies (with computed signals)
        strategyPanelVisible: true,
        klineStream: null,
        tickerStream: null
    };

    /* ============== Initialisation ============== */
    async function init() {
        // License & session (phase 1: no-ops; phase 2: queries backend)
        await License.load();
        Session.load();

        ChartEngine.init(
            document.getElementById('chartCanvas'),
            document.getElementById('chartOverlay')
        );

        // Watchlist (favorites)
        Watchlist.load();
        const colBtn = document.getElementById('watchlistCollapse');
        if (colBtn) colBtn.addEventListener('click', Watchlist.toggleCollapse);

        // Share link button
        const shareBtn = document.getElementById('shareButton');
        if (shareBtn) shareBtn.addEventListener('click', Share.copyLink);

        // Technical summary panel
        const sumBtn = document.getElementById('summaryButton');
        if (sumBtn) sumBtn.addEventListener('click', toggleSummaryPanel);
        const sumHide = document.getElementById('hideSummaryPanel');
        if (sumHide) sumHide.addEventListener('click', () => toggleSummaryPanel(false));
        const sumCopy = document.getElementById('summaryCopyBtn');
        if (sumCopy) sumCopy.addEventListener('click', copySummary);

        // Market heatmap
        if (window.Heatmap) {
            window.Heatmap.onSelect(selectPair);
            const hmBtn = document.getElementById('heatmapButton');
            if (hmBtn) hmBtn.addEventListener('click', () => {
                window.Heatmap.render(state.pairs, state.tickers, state.activePair);
                window.Heatmap.toggle();
            });
        }

        // Order book
        if (window.Book) {
            const bkBtn = document.getElementById('bookButton');
            if (bkBtn) bkBtn.addEventListener('click', () => {
                window.Book.toggle(state.activePair, summaryMeta());
            });
        }

        // Drawing layer (trend lines) — inject coordinate API
        if (window.Drawing) {
            Drawing.setChartAPI(ChartEngine.getCoordAPI(), null, updateDrawUI);
            bindDrawingUI();
        }
        bindScreenshotButton();

        await loadPairs();
        bindUI();
        connectTickerStream();
        renderIndicatorModal();
        renderStrategyModal();
        renderActiveIndicators();
        bindStrategyPanel();

        // Default to BTC/USDT — or the pair from a share link (#/SYMBOL/TF)
        const shared = Share.parseHash();
        if (shared && state.pairs.some(p => p.symbol === shared.symbol)) {
            // apply timeframe from the link
            const tfBtn = document.querySelector(`.tf-btn[data-tf="${shared.tf}"]`);
            if (tfBtn) tfBtn.click();
            await selectPair(shared.symbol);
            // apply shared drawings AFTER the pair's data is loaded
            if (shared.objects && shared.objects.length && window.Drawing) {
                Drawing.setSymbol(shared.symbol);
                Drawing.setObjects(shared.objects);
                ChartEngine.render();
                showToast(`Loaded shared setup (${shared.objects.length} objects)`, 3000);
            }
        } else if (state.pairs.length > 0) {
            const btc = state.pairs.find(p => p.symbol === 'BTCUSDT') || state.pairs[0];
            await selectPair(btc.symbol);
        }
    }

    /* ============== Data ============== */
    async function loadPairs() {
        const list = document.getElementById('pairList');
        list.innerHTML = '<div class="loading">Loading pair list...</div>';
        try {
            const [info, tickers] = await Promise.all([
                BinanceAPI.getExchangeInfo(),
                BinanceAPI.get24hTickers()
            ]);
            state.pairs = info;
            state.tickers = tickers;
            renderPairList();
        } catch (e) {
            list.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
            showToast('Failed to load pairs. Check your connection.');
        }
    }

    function connectTickerStream() {
        if (state.tickerStream) state.tickerStream.close();
        state.tickerStream = new BinanceAPI.TickerStream((map) => {
            Object.assign(state.tickers, map);
            renderPairList();
            Watchlist.render();
            updateHeaderPrice();
            if (isSummaryOpen()) renderSummaryPanel();
            if (window.Heatmap && Heatmap.isOpen()) {
                Heatmap.render(state.pairs, state.tickers, state.activePair, { quote: Heatmap.getQuote() });
            }
        });
        state.tickerStream.connect();
    }

    async function selectPair(symbol, forceReload = false) {
        if (state.activePair === symbol && !forceReload) return;
        state.activePair = symbol;

        // Chart watermark: SYMBOL · TF
        if (window.ChartEngine?.setWatermark) ChartEngine.setWatermark(symbol, state.timeframe);

        // Share link: keep URL in sync (no drawings in plain pair switching)
        history.replaceState(null, '', `#/${symbol}/${state.timeframe}`);

        // Drawing layer: switch storage key to the new pair
        if (window.Drawing) Drawing.setSymbol(symbol);

        // Close previous stream
        if (state.klineStream) { state.klineStream.close(); state.klineStream = null; }

        document.querySelectorAll('.pair-row').forEach(el => {
            el.classList.toggle('active', el.dataset.symbol === symbol);
        });
        Watchlist.render();

        const loading = document.getElementById('chartLoading');
        loading.style.display = 'block';

        try {
            const candles = await BinanceAPI.getKlines(symbol, state.timeframe, 500);
            state.candles = candles;
            ChartEngine.setData(candles);

            // Compute active indicators
            recomputeIndicators();
            recomputeStrategies();
            pushToChart();

            updateHeaderPrice();
            renderActiveIndicators();
            updateSymbolHeader();
            if (isSummaryOpen()) renderSummaryPanel();
            if (window.Book && Book.isOpen()) Book.setSymbol(symbol, summaryMeta());
            if (window.MTF && MTF.isOpen()) MTF.onPairChanged(symbol);
        } catch (e) {
            showToast(`Data load error: ${e.message}`);
        } finally {
            loading.style.display = 'none';
        }

        // Connect to realtime stream
        state.klineStream = new BinanceAPI.KlineStream(
            symbol,
            state.timeframe,
            (candle) => {
                // update last candle in state
                const last = state.candles[state.candles.length - 1];
                if (last && last.time === candle.time) {
                    state.candles[state.candles.length - 1] = candle;
                } else {
                    state.candles.push(candle);
                }
                ChartEngine.appendCandle(candle);
                // Recompute last point only (optimisation: full recompute)
                recomputeIndicators();
                recomputeStrategies();
                pushToChart();
                updateHeaderPrice();
                if (isSummaryOpen()) renderSummaryPanel();
            },
            (candle) => { /* on candle close — recompute */ }
        );
        state.klineStream.connect();
    }

    async function changeTimeframe(tf) {
        if (state.timeframe === tf) return;
        state.timeframe = tf;
        // Watermark follows the timeframe
        if (window.ChartEngine?.setWatermark && state.activePair) {
            ChartEngine.setWatermark(state.activePair, tf);
        }
        if (state.activePair) await selectPair(state.activePair, true);
        showToast(`Timeframe ${tf} loaded`, 1500);
    }

    function recomputeIndicators() {
        if (!state.candles.length) return;
        for (const ind of state.indicators) {
            const def = Indicators[ind.key];
            if (!def) continue;
            try {
                const result = def.calc(state.candles, ind.params);
                ind.data = result;
            } catch (e) {
                console.warn(`Indicator ${ind.key} failed:`, e);
                ind.data = null;
            }
        }
    }

    function recomputeStrategies() {
        if (!state.candles.length) return;
        for (const s of state.strategies) {
            const def = Strategies[s.key];
            if (!def) continue;
            try {
                s.result = def.run(state.candles, s.params);
                s.result.color = s.color;
                s.result.key = s.key;
            } catch (e) {
                console.warn(`Strategy ${s.key} failed:`, e);
                s.result = null;
            }
        }
        renderStrategyPanelList();
    }

    function pushToChart() {
        const overlay = state.indicators.filter(i => i.type === 'overlay');
        const panes = state.indicators.filter(i => i.type === 'pane').map(i => ({
            ind: i, data: i.data, height: 90
        }));
        const strategies = state.strategies
            .filter(s => s.enabled && s.result)
            .map(s => ({
                key: s.key,
                name: s.name,
                color: s.color,
                enabled: true,
                signals: s.result.signals
            }));
        ChartEngine.setIndicators(overlay, panes, strategies);
    }

    /* ============== UI ============== */

    function bindUI() {
        // Search
        document.getElementById('searchInput').addEventListener('input', (e) => {
            state.searchQuery = e.target.value.toLowerCase();
            renderPairList();
        });

        // Quote filter
        document.querySelectorAll('.quote-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.quote-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.activeQuote = btn.dataset.quote;
                renderPairList();
            });
        });

        // Timeframes — use delegation on parent for reliability
        const tfContainer = document.getElementById('timeframes');
        if (tfContainer) {
            tfContainer.addEventListener('click', (e) => {
                const btn = e.target.closest('.tf-btn');
                if (!btn) return;
                const tf = btn.dataset.tf;
                if (!tf) return;
                document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                showToast(`Loading ${tf}...`, 1200);
                changeTimeframe(tf);
            });
        }

        // Chart type
        document.querySelectorAll('.ct-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.ct-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.chartType = btn.dataset.type;
                ChartEngine.setChartType(state.chartType);
            });
        });

        // Indicators
        document.getElementById('addIndicatorBtn').addEventListener('click', () => {
            document.getElementById('indicatorModal').style.display = 'flex';
            document.getElementById('indicatorSearch').focus();
        });
        document.getElementById('closeModal').addEventListener('click', () => {
            document.getElementById('indicatorModal').style.display = 'none';
        });
        document.getElementById('indicatorModal').addEventListener('click', (e) => {
            if (e.target.id === 'indicatorModal') {
                document.getElementById('indicatorModal').style.display = 'none';
            }
        });
        document.getElementById('indicatorSearch').addEventListener('input', (e) => {
            renderIndicatorModal(e.target.value.toLowerCase());
        });

        // Strategy — modal
        document.getElementById('addStrategyBtn').addEventListener('click', () => {
            document.getElementById('strategyModal').style.display = 'flex';
            document.getElementById('strategySearch').focus();
        });
        document.getElementById('closeStrategyModal').addEventListener('click', () => {
            document.getElementById('strategyModal').style.display = 'none';
        });
        document.getElementById('strategyModal').addEventListener('click', (e) => {
            if (e.target.id === 'strategyModal') {
                document.getElementById('strategyModal').style.display = 'none';
            }
        });
        document.getElementById('strategySearch').addEventListener('input', (e) => {
            renderStrategyModal(e.target.value.toLowerCase());
        });

        // Reset zoom
        document.getElementById('resetChart').addEventListener('click', () => {
            ChartEngine.resetView();
        });

        // Clear indicators (bottom bar)
        document.getElementById('clearIndicators').addEventListener('click', clearAllIndicators);

        // Show/hide sidebar
        document.getElementById('toggleSidebar').addEventListener('click', () => {
            document.body.classList.add('sidebar-hidden');
            document.body.classList.remove('sidebar-mobile-open');
        });
        document.getElementById('showSidebarBtn').addEventListener('click', () => {
            document.body.classList.remove('sidebar-hidden');
            document.body.classList.remove('sidebar-mobile-open');
        });

        // Mobile drawer: click the ▶ to slide the panel over the chart
        const showBtn = document.getElementById('showSidebarBtn');
        if (showBtn) {
            // on phones the ▶ button becomes a drawer toggle
            showBtn.addEventListener('click', () => {
                if (window.matchMedia('(max-width: 640px)').matches) {
                    document.body.classList.toggle('sidebar-mobile-open');
                }
            });
        }
        // Close the drawer when a pair is picked or the backdrop is tapped
        document.addEventListener('click', (e) => {
            if (!document.body.classList.contains('sidebar-mobile-open')) return;
            const sidebar = document.getElementById('sidebar');
            const inSidebar = sidebar.contains(e.target);
            const isToggle = e.target.closest('#showSidebarBtn, #toggleSidebar');
            if (!inSidebar && !isToggle) {
                document.body.classList.remove('sidebar-mobile-open');
            }
        });
        // ...and when a pair inside the drawer is selected (pair click IS inside sidebar)
        document.querySelectorAll('#pairList, #watchlistItems').forEach(wrap => {
            wrap.addEventListener('click', (e) => {
                const row = e.target.closest('.pair-row');
                if (row) document.body.classList.remove('sidebar-mobile-open');
            });
        });

        // Indicator / strategy / auth / upgrade modal helpers
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.getElementById('indicatorModal').style.display = 'none';
                document.getElementById('strategyModal').style.display = 'none';
                UI.closeModal('upgradeModal');
                UI.closeModal('authModal');
                UI.closeCheckoutModal();
            }
        });

        // Bind upgrade/auth UI
        UI.init();
        window.UI = UI;
        // Expose toast for UI module
        window.appShowToast = showToast;

        // Price alerts (bell button + panel) — needs Session, registers SW
        if (window.AlertsUI) AlertsUI.init();
        if (window.MTF) MTF.init();
        if (window.Risk) Risk.init();
        if (window.Theme) Theme.init();
        if (window.Hotkeys) Hotkeys.init();
        buildThemeButton();

    }


    function renderPairList() {
        const list = document.getElementById('pairList');
        const quote = state.activeQuote;
        const query = state.searchQuery;
        let filtered = state.pairs.filter(p => p.quote === quote);
        if (query) {
            filtered = filtered.filter(p =>
                p.symbol.toLowerCase().includes(query) ||
                p.base.toLowerCase().includes(query)
            );
        }
        // Sort by volume (if ticker data available)
        filtered.sort((a, b) => {
            const ta = state.tickers[a.symbol]?.quoteVolume || 0;
            const tb = state.tickers[b.symbol]?.quoteVolume || 0;
            return tb - ta;
        });

        // Compute max quoteVolume for bar widths (only among currently visible rows)
        let maxVol = 0;
        for (const p of filtered) {
            const v = state.tickers[p.symbol]?.quoteVolume || 0;
            if (v > maxVol) maxVol = v;
        }

        if (!filtered.length) {
            list.innerHTML = '<div class="empty-state">Nothing found</div>';
            return;
        }

        list.innerHTML = filtered.map(p => {
            const t = state.tickers[p.symbol];
            const last = t ? t.last : null;
            const change = t ? t.change : null;
            const vol = t ? t.quoteVolume : null;
            const cls = change > 0 ? 'up' : (change < 0 ? 'down' : 'flat');
            const sign = change > 0 ? '+' : '';
            // Bar width: 0..100% relative to max volume of visible list
            const pct = (vol && maxVol > 0) ? Math.max(4, Math.min(100, (vol / maxVol) * 100)) : 0;
            const barCls = change > 0 ? 'buy' : (change < 0 ? 'sell' : '');
            const fav = Watchlist.has(p.symbol);
            return `
                <div class="pair-row ${p.symbol === state.activePair ? 'active' : ''}" data-symbol="${p.symbol}">
                    <button class="pair-fav ${fav ? 'active' : ''}" data-fav="${p.symbol}" title="${fav ? 'Remove from favorites' : 'Add to favorites'}">${fav ? '★' : '☆'}</button>
                    <div class="pair-symbol">
                        <span class="pair-symbol-base">${p.base}</span>
                        <span class="pair-symbol-quote">/${p.quote}</span>
                    </div>
                    <div class="pair-price">${last !== null ? formatPrice(last) : '—'}</div>
                    <div class="pair-change ${cls}">${change !== null ? sign + change.toFixed(2) + '%' : '—'}</div>
                    <div class="pair-volume">
                        ${vol ? `<div class="pair-volume-bar ${barCls}" style="width:${pct}%"></div>` : ''}
                        <span class="pair-volume-text">${vol !== null ? formatVolume(vol) : '—'}</span>
                    </div>
                </div>
            `;
        }).join('');

        // Bind clicks
        list.querySelectorAll('.pair-row').forEach(row => {
            row.addEventListener('click', () => selectPair(row.dataset.symbol));
        });
        list.querySelectorAll('.pair-fav').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                Watchlist.toggle(btn.dataset.fav);
            });
        });
    }

    function renderIndicatorModal(query = '') {
        const wrap = document.getElementById('indicatorCategories');
        const catalog = Indicators.getCatalog();
        let html = '';
        for (const cat in catalog) {
            const items = catalog[cat].filter(i =>
                !query ||
                i.name.toLowerCase().includes(query) ||
                i.full.toLowerCase().includes(query) ||
                i.desc.toLowerCase().includes(query) ||
                cat.toLowerCase().includes(query)
            );
            if (!items.length) continue;
            html += `
                <div class="cat-group">
                    <div class="cat-title">${cat}</div>
                    <div class="cat-list">
                        ${items.map(i => {
                            const paramPreview = Object.entries(i.params)
                                .map(([k, v]) => v.def)
                                .filter(v => v !== undefined)
                                .join(',');
                            const paramsHint = paramPreview ? `(${paramPreview})` : '';
                            return `
                                <div class="ind-item" data-key="${i.key}">
                                    <div class="ind-item-name">${i.name} <span class="ind-item-params">${paramsHint}</span></div>
                                    <div class="ind-item-desc">${i.desc}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }
        if (!html) html = '<div class="empty-state">Not found</div>';
        wrap.innerHTML = html;

        wrap.querySelectorAll('.ind-item').forEach(el => {
            el.addEventListener('click', () => {
                addIndicator(el.dataset.key);
                document.getElementById('indicatorModal').style.display = 'none';
            });
        });
    }

    function addIndicator(key) {
        // Feature gate (only enforced when CryptoTA_CONFIG.billingEnabled === true)
        if (!License.canAddIndicator(state.indicators.length)) {
            showToast(`Free tier limit reached (${License.limits().indicators} indicators). Pro = unlimited.`);
            return;
        }

        // Color — take next from palette accounting for already-added ones
        const usedColors = state.indicators.map(i => i.color);
        const palette = ['#5cc8c0','#c9a857','#9b8ec9','#a87a5c','#7a8a9e','#c97a8a','#8b9bb3','#e8ecf4'];
        const color = palette[state.indicators.length % palette.length];

        const inst = Indicators.create(key);
        if (!inst) return;
        inst.color = color;

        try {
            const result = Indicators[key].calc(state.candles, inst.params);
            inst.data = result;
        } catch (e) {
            showToast(`Indicator calculation error: ${e.message}`);
            return;
        }

        // If already added — replace (in case of double-click)
        state.indicators = state.indicators.filter(i => i.key !== key);
        state.indicators.push(inst);

        renderActiveIndicators();
        updateIndicatorCount();

        ChartEngine.setIndicators(
            state.indicators.filter(i => i.type === 'overlay'),
            state.indicators.filter(i => i.type === 'pane').map(i => ({
                ind: i,
                data: i.data,
                height: 90
            }))
        );
        showToast(`Added: ${inst.full}`);
    }

    function removeIndicator(instanceId) {
        state.indicators = state.indicators.filter(i => i.instanceId !== instanceId);
        renderActiveIndicators();
        updateIndicatorCount();
        ChartEngine.setIndicators(
            state.indicators.filter(i => i.type === 'overlay'),
            state.indicators.filter(i => i.type === 'pane').map(i => ({
                ind: i,
                data: i.data,
                height: 90
            }))
        );
    }

    function renderActiveIndicators() {
        const wrap = document.getElementById('activeIndicators');
        if (!state.indicators.length) {
            wrap.innerHTML = '';
            wrap.classList.remove('has-items');
            return;
        }
        wrap.classList.add('has-items');
        const chips = state.indicators.map(ind => {
            const paramStr = Object.values(ind.params).map(v => v).join(',');
            return `
                <div class="ind-chip" title="${ind.full}">
                    <span class="ind-chip-color" style="background:${ind.color}"></span>
                    <span class="ind-chip-name">${ind.name}${paramStr ? '(' + paramStr + ')' : ''}</span>
                    <button class="ind-chip-close" data-id="${ind.instanceId}" title="Remove">✕</button>
                </div>
            `;
        }).join('');
        wrap.innerHTML = chips + `<button class="clear-all-btn" id="clearAllBtnTop" title="Remove all indicators">✕ Clear all</button>`;
        wrap.querySelectorAll('.ind-chip-close').forEach(btn => {
            btn.addEventListener('click', () => removeIndicator(btn.dataset.id));
        });
        const clearBtn = document.getElementById('clearAllBtnTop');
        if (clearBtn) {
            clearBtn.addEventListener('click', clearAllIndicators);
        }
    }

    function clearAllIndicators() {
        if (!state.indicators.length) return;
        const count = state.indicators.length;
        state.indicators = [];
        renderActiveIndicators();
        updateIndicatorCount();
        ChartEngine.setIndicators([], []);
        showToast(`Indicators cleared: ${count}`);
    }

    function updateIndicatorCount() {
        document.getElementById('indicatorCount').textContent = state.indicators.length;
    }

    function updateSymbolHeader() {
        if (!state.activePair) return;
        const pair = state.pairs.find(p => p.symbol === state.activePair);
        if (pair) document.getElementById('symbolName').textContent = `${pair.base}/${pair.quote}`;
    }

    function updateHeaderPrice() {
        if (!state.activePair) return;
        const t = state.tickers[state.activePair];
        const lastCandle = state.candles[state.candles.length - 1];
        const price = t?.last ?? lastCandle?.close ?? null;
        const change = t?.change ?? null;

        const priceEl = document.getElementById('symbolPrice');
        const changeEl = document.getElementById('symbolChange');
        const volumeEl = document.getElementById('symbolVolume');

        if (price !== null) {
            // Flash the price up/down on tick — subtle, 400ms fade.
            // Skip the very first render (no previous price to compare).
            const prev = updateHeaderPrice._lastPrice;
            if (prev !== undefined && prev !== null && prev !== price) {
                priceEl.classList.remove('flash-up', 'flash-down');
                void priceEl.offsetWidth;          // restart CSS animation
                priceEl.classList.add(price > prev ? 'flash-up' : 'flash-down');
            }
            updateHeaderPrice._lastPrice = price;
            priceEl.textContent = formatPrice(price);
        }
        if (change !== null) {
            const cls = change > 0 ? 'up' : (change < 0 ? 'down' : 'flat');
            const sign = change > 0 ? '+' : '';
            changeEl.textContent = `${sign}${change.toFixed(2)}%`;
            changeEl.className = `symbol-change ${cls}`;
        }
        if (volumeEl) {
            const vol = t?.quoteVolume ?? null;
            volumeEl.textContent = vol !== null ? formatVolume(vol) : '—';
        }
    }

    function showToast(msg, ms = 2500) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.style.display = 'block';
        clearTimeout(t._timer);
        t._timer = setTimeout(() => { t.style.display = 'none'; }, ms);
    }

    /* ============== TECHNICAL SUMMARY ============== */

    function summaryMeta() {
        const pair = state.pairs.find(p => p.symbol === state.activePair);
        return {
            quote: pair?.quote || '',
            timeframe: state.timeframe || '',
        };
    }

    function renderSummaryPanel() {
        const body = document.getElementById('summaryBody');
        if (!body) return;
        const t = state.tickers[state.activePair];
        const sections = window.Summary.build(state.candles, t, summaryMeta());
        body.innerHTML = sections.map(s => {
            const badge = s.badge
                ? `<span class="sum-badge ${s.badge.cls}">${s.badge.text}</span>`
                : '';
            const rows = s.rows.map(r =>
                `<div class="sum-row">${r.label ? `<span class="sum-label">${r.label}</span>` : ''}<span class="sum-val">${r.text}</span></div>`
            ).join('');
            return `<div class="sum-section">
                <div class="sum-section-head"><span class="sum-section-title">${s.title}</span>${badge}</div>
                <div class="sum-rows">${rows}</div>
            </div>`;
        }).join('');
    }

    function isSummaryOpen() {
        const panel = document.getElementById('summaryPanel');
        return !!panel && panel.style.display !== 'none';
    }

    function toggleSummaryPanel(force) {
        const panel = document.getElementById('summaryPanel');
        if (!panel) return;
        const open = force !== undefined ? force : !isSummaryOpen();
        panel.style.display = open ? 'flex' : 'none';
        if (open) {
            renderSummaryPanel();
            const btn = document.getElementById('summaryButton');
            if (btn) btn.classList.toggle('active', true);
        } else {
            const btn = document.getElementById('summaryButton');
            if (btn) btn.classList.toggle('active', false);
        }
    }

    async function copySummary() {
        const t = state.tickers[state.activePair];
        const sections = window.Summary.build(state.candles, t, summaryMeta());
        const pair = state.pairs.find(p => p.symbol === state.activePair);
        const header = `CryptoTA — ${pair ? pair.base + '/' + pair.quote : state.activePair} · ${state.timeframe} · ${new Date().toLocaleDateString()}`;
        const text = window.Summary.toText(sections, header);
        try {
            await navigator.clipboard.writeText(text);
            showToast('Summary copied to clipboard');
        } catch (e) {
            showToast('Copy failed — select text manually');
        }
    }

    /* ============== STRATEGIES ============== */

    function renderStrategyModal(query = '') {
        const wrap = document.getElementById('strategyCategories');
        const catalog = Strategies.getCatalog();
        let html = '';
        for (const cat in catalog) {
            const items = catalog[cat].filter(i =>
                !query ||
                i.name.toLowerCase().includes(query) ||
                i.desc.toLowerCase().includes(query) ||
                cat.toLowerCase().includes(query)
            );
            if (!items.length) continue;
            html += `
                <div class="cat-group">
                    <div class="cat-title">${cat}</div>
                    <div class="cat-list">
                        ${items.map(i => `
                            <div class="ind-item" data-key="${i.key}">
                                <div class="ind-item-name">${i.name}</div>
                                <div class="ind-item-desc">${i.desc}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        if (!html) html = '<div class="empty-state">Not found</div>';
        wrap.innerHTML = html;

        wrap.querySelectorAll('.ind-item').forEach(el => {
            el.addEventListener('click', () => {
                addStrategy(el.dataset.key);
                document.getElementById('strategyModal').style.display = 'none';
            });
        });
    }

    function addStrategy(key) {
        // Feature gate
        if (!License.canAddStrategy(state.strategies.length)) {
            showToast(`Free tier limit reached (${License.limits().strategies} strategies). Pro = unlimited.`);
            return;
        }

        // If already added — toggle active state, don't duplicate
        const existing = state.strategies.find(s => s.key === key);
        if (existing) {
            existing.enabled = !existing.enabled;
            showToast(`${existing.name}: ${existing.enabled ? 'enabled' : 'disabled'}`);
        } else {
            const palette = ['#5cc8c0', '#c9a857', '#9b8ec9', '#a87a5c', '#c97a8a', '#7a8a9e'];
            const color = palette[state.strategies.length % palette.length];
            const inst = Strategies.create(key);
            if (!inst) return;
            inst.color = color;
            inst.enabled = true;
            state.strategies.push(inst);
            showToast(`Strategy added: ${inst.name}`);
        }
        recomputeStrategies();
        pushToChart();
        renderStrategyPanelList();
        showStrategyPanelIfNeeded();
    }

    function removeStrategy(key) {
        state.strategies = state.strategies.filter(s => s.key !== key);
        recomputeStrategies();
        pushToChart();
        renderStrategyPanelList();
        if (!state.strategies.length) {
            document.getElementById('strategyPanel').style.display = 'none';
            document.getElementById('showStrategyPanelBtn').style.display = 'none';
        }
    }

    function bindStrategyPanel() {
        document.getElementById('hideStrategyPanel').addEventListener('click', () => {
            document.getElementById('strategyPanel').style.display = 'none';
            document.getElementById('showStrategyPanelBtn').style.display = 'flex';
        });

        // Export backtest to CSV
        document.getElementById('exportCSVBtn')?.addEventListener('click', () => {
            exportBacktestCSV();
        });
        document.getElementById('showStrategyPanelBtn').addEventListener('click', () => {
            document.getElementById('strategyPanel').style.display = 'flex';
            document.getElementById('showStrategyPanelBtn').style.display = 'none';
        });

        // Drag panel
        const panel = document.getElementById('strategyPanel');
        const head = panel?.querySelector('.strategy-panel-head');
        if (!panel || !head) return;

        const STORAGE_KEY = 'cryptota:strategyPanelPos';
        // Load saved position
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
                applyPanelPosition(panel, saved.x, saved.y);
            } else {
                applyPanelPosition(panel, panel.parentNode.clientWidth - 290 - 16, 56);
            }
        } catch { applyPanelPosition(panel, panel.parentNode.clientWidth - 290 - 16, 56); }

        let drag = null;
        head.addEventListener('mousedown', (e) => {
            // Ignore if clicked on a button (hideStrategyPanel etc)
            if (e.target.closest('button')) return;
            const rect = panel.getBoundingClientRect();
            drag = {
                startX: e.clientX,
                startY: e.clientY,
                originLeft: rect.left,
                originTop: rect.top
            };
            panel.classList.add('dragging');
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!drag) return;
            const parentRect = panel.parentNode.getBoundingClientRect();
            const dx = e.clientX - drag.startX;
            const dy = e.clientY - drag.startY;
            let newX = drag.originLeft - parentRect.left + dx;
            let newY = drag.originTop - parentRect.top + dy;
            // Clamp to parent (chart area)
            const maxX = parentRect.width - panel.offsetWidth - 4;
            const maxY = parentRect.height - panel.offsetHeight - 4;
            newX = Math.max(4, Math.min(maxX, newX));
            newY = Math.max(4, Math.min(maxY, newY));
            panel.style.left = newX + 'px';
            panel.style.top  = newY + 'px';
            panel.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => {
            if (!drag) return;
            drag = null;
            panel.classList.remove('dragging');
            // Persist
            try {
                const x = parseFloat(panel.style.left) || 0;
                const y = parseFloat(panel.style.top) || 0;
                localStorage.setItem(STORAGE_KEY, JSON.stringify({ x, y }));
            } catch {}
        });
    }

    function applyPanelPosition(panel, x, y) {
        panel.style.left = x + 'px';
        panel.style.top  = y + 'px';
        panel.style.right = 'auto';
    }

    function showStrategyPanelIfNeeded() {
        if (state.strategies.length) {
            document.getElementById('strategyPanel').style.display = 'flex';
            document.getElementById('showStrategyPanelBtn').style.display = 'none';
        }
    }


    /* ===== Export active-strategy backtest results to CSV =====
     * Rebuilds the trade list from signals (same buy-at-close→sell-at-close
     * logic as Strategies._buildResult) and writes a downloadable CSV:
     * summary rows + one row per trade with real dates. */
    function exportBacktestCSV() {
        const actives = state.strategies.filter(s => s.enabled && s.result?.signals?.length);
        if (!actives.length) {
            showToast('No active strategies with signals to export');
            return;
        }
        const sym = state.activePair || 'CHART';
        const tf = state.timeframe;
        const escCell = (v) => {
            const t = String(v ?? '');
            return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
        };
        const lines = [];
        lines.push(`CryptoTA backtest — ${sym} ${tf} — ${new Date().toISOString().slice(0, 10)}`);
        lines.push('');
        lines.push('Strategy,Params,Signals,Trades,Open,Wins,Losses,Win rate %,Total PnL %,Current signal');
        for (const s of actives) {
            const st = s.result.stats;
            const params = Object.entries(s.params).map(([k, v]) => k + '=' + v).join(' ');
            lines.push([
                s.name, params, s.result.signals.length, st.trades, st.open,
                st.wins, st.losses, st.winRate.toFixed(1), st.pnl.toFixed(2), st.currentSignal
            ].map(escCell).join(','));
        }
        lines.push('');
        lines.push('Trades');
        lines.push('Strategy,Side,Entry time,Entry price,Exit time,Exit price,PnL %,Open,Entry reason,Exit reason');
        const fmtTime = (ts) => new Date(ts).toISOString().replace('T', ' ').slice(0, 16);
        for (const s of actives) {
            // rebuild trades from signals (same rules as _buildResult)
            const candles = state.candles;
            let pos = null;
            for (const sig of s.result.signals) {
                const price = candles[sig.i]?.close;
                if (price == null) continue;
                if (sig.type === 'BUY' && !pos) {
                    pos = { i: sig.i, price, reason: sig.reason };
                } else if (sig.type === 'SELL' && pos) {
                    const pnl = (price - pos.price) / pos.price * 100;
                    lines.push([
                        s.name, 'LONG',
                        fmtTime(candles[pos.i].time), pos.price,
                        fmtTime(candles[sig.i].time), price,
                        pnl.toFixed(2), 'no',
                        pos.reason || '', sig.reason || ''
                    ].map(escCell).join(','));
                    pos = null;
                }
            }
            if (pos) {
                const last = candles[candles.length - 1];
                const pnl = (last.close - pos.price) / pos.price * 100;
                lines.push([
                    s.name, 'LONG',
                    fmtTime(candles[pos.i].time), pos.price,
                    fmtTime(last.time), last.close,
                    pnl.toFixed(2), 'yes',
                    pos.reason || '', '(still open)'
                ].map(escCell).join(','));
            }
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cryptota-backtest-${sym}-${tf}-${Date.now()}.csv`.toLowerCase();
        a.click();
        URL.revokeObjectURL(url);
        showToast('CSV downloaded');
    }

    function renderStrategyPanelList() {
        const wrap = document.getElementById('strategyPanelList');
        if (!wrap) return;
        if (!state.strategies.length) {
            wrap.innerHTML = '<div class="strategy-panel-empty">No active strategies</div>';
            return;
        }
        // Header: color legend
        const legend = state.strategies.map(s =>
            `<span class="legend-item" title="${s.name}"><span class="legend-dot" style="background:${s.color}"></span></span>`
        ).join('');
        const headerEl = document.querySelector('.strategy-panel-head .strategy-panel-title');
        if (headerEl && !document.querySelector('.strategy-legend')) {
            const leg = document.createElement('div');
            leg.className = 'strategy-legend';
            leg.innerHTML = legend;
            headerEl.appendChild(leg);
        } else if (document.querySelector('.strategy-legend')) {
            document.querySelector('.strategy-legend').innerHTML = legend;
        }

        wrap.innerHTML = state.strategies.map(s => {
            const stats = s.result?.stats;
            const signalClass = stats?.currentSignal === 'BUY' ? 'buy'
                : stats?.currentSignal === 'SELL' ? 'sell' : 'none';
            const signalText = stats?.currentSignal === 'BUY' ? '▲ BUY'
                : stats?.currentSignal === 'SELL' ? '▼ SELL' : '◇ NONE';
            const wr = stats ? stats.winRate.toFixed(1) : '—';
            const wrCls = stats && stats.winRate >= 55 ? 'good' : (stats ? 'bad' : '');
            const pnl = stats ? stats.pnl.toFixed(2) : '—';
            const pnlCls = stats && stats.pnl >= 0 ? 'good' : (stats ? 'bad' : '');
            const signalCount = s.result?.signals?.length || 0;
            const enabledCls = s.enabled ? '' : 'disabled';
            const paramStr = Object.entries(s.params).map(([k, v]) => v).join(',');
            return `
                <div class="strategy-card ${enabledCls}" data-key="${s.key}">
                    <div class="strategy-card-head">
                        <span class="strategy-card-color" style="background:${s.color}"></span>
                        <span class="strategy-card-name">${s.name}</span>
                        <span class="strategy-card-signal ${signalClass}">${signalText}</span>
                        <button class="strategy-card-toggle" data-key="${s.key}" title="${s.enabled ? 'Disable' : 'Enable'}">${s.enabled ? '◉' : '○'}</button>
                        <button class="strategy-card-close" data-key="${s.key}" title="Remove">✕</button>
                    </div>
                    <div class="strategy-card-params">(${paramStr})</div>
                    <div class="strategy-card-stats">
                        <div class="stat"><span>Trades</span><b>${stats?.trades ?? 0}</b></div>
                        <div class="stat"><span>Closed</span><b>${stats?.closed ?? 0}</b></div>
                        <div class="stat"><span>Signals</span><b>${signalCount}</b></div>
                        <div class="stat"><span>Win rate</span><b class="${wrCls}">${wr}${wr !== '—' ? '%' : ''}</b></div>
                        <div class="stat"><span>P&amp;L</span><b class="${pnlCls}">${pnl}${pnl !== '—' ? '%' : ''}</b></div>
                    </div>
                    <div class="strategy-card-reason">${stats?.lastReason || '—'}</div>
                </div>
            `;
        }).join('');

        wrap.querySelectorAll('.strategy-card-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const key = btn.dataset.key;
                const s = state.strategies.find(x => x.key === key);
                if (!s) return;
                s.enabled = !s.enabled;
                showToast(`${s.name}: ${s.enabled ? 'enabled' : 'disabled'}`);
                recomputeStrategies();
                pushToChart();
                renderStrategyPanelList();
            });
        });
        wrap.querySelectorAll('.strategy-card-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeStrategy(btn.dataset.key);
            });
        });
    }

    /* ============== Drawing tools UI ============== */

    function bindDrawingUI() {
        const toggle = document.getElementById('drawToggle');
        const tools = document.getElementById('drawTools');
        if (!toggle || !tools) return;

        // Show/hide the tool group
        toggle.addEventListener('click', () => {
            const visible = tools.style.display !== 'none';
            tools.style.display = visible ? 'none' : 'flex';
            toggle.classList.toggle('on', !visible);
            if (visible) {
                Drawing.setTool('off');      // leaving — reset mode
                setDrawCursor('off');
            }
        });

        // Tool selection inside the group
        tools.addEventListener('click', (e) => {
            const btn = e.target.closest('.ct-btn');
            if (!btn) return;
            const tool = btn.dataset.tool;

            if (tool === 'clear') {
                if (Drawing.getLineCount() > 0) {
                    Drawing.clearAll();
                    showToast('All lines removed');
                    ChartEngine.render();
                } else {
                    showToast('No lines to remove');
                }
                return;   // clear is an action, not a mode
            }

            tools.querySelectorAll('.ct-btn').forEach(b => b.classList.toggle('active', b === btn));
            Drawing.setTool(tool);
            setDrawCursor(tool);
            showToast(tool === 'line'
                ? 'Draw mode: click & drag to draw a trend line'
                : tool === 'hline'
                    ? 'Level mode: click to place a horizontal line, drag to adjust'
                    : tool === 'rect'
                        ? 'Zone mode: click & drag to mark a range'
                        : tool === 'fib'
                            ? 'Fib fan: drag along a trend to fan out the levels'
                            : tool === 'text'
                                ? 'Note mode: click a point on the chart to label it'
                                : 'Normal mode: drag to pan', 2000);
        });

        // Keyboard: Delete hovered line, Escape cancels drawing
        document.addEventListener('keydown', (e) => {
            if (Drawing.getTool() === 'off') return;
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
            if (Drawing.onKeyDown(e)) {
                e.preventDefault();
                ChartEngine.render();
            }
        });
    }

    /* ============== Screenshot (chart PNG) ============== */
    function bindScreenshotButton() {
        const btn = document.getElementById('screenshotButton');
        if (!btn) return;
        btn.addEventListener('click', downloadChartPNG);
    }

    function downloadChartPNG() {
        const src = document.getElementById('chartCanvas');
        if (!src) return;

        // Compose: dark bg + chart + watermark header
        const out = document.createElement('canvas');
        const dpr = window.devicePixelRatio || 1;
        out.width = src.width;
        out.height = src.height;
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#0a0e1a';
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(src, 0, 0);

        // Header strip: CryptoTA · SYMBOL · TF · date — drawn on top of chart padding area
        const hdr = `${state.activePair || ''} · ${state.timeframe.toUpperCase()} · ${new Date().toISOString().slice(0, 10)}`;
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.font = '600 12px JetBrains Mono, monospace';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(232, 236, 244, 0.9)';
        const cw = src.width / dpr;
        ctx.fillText(hdr, cw - 8, 6);
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(201, 168, 87, 0.95)';       // amber
        ctx.fillText('CryptoTA', 8, 6);
        // watermark bottom-right
        ctx.globalAlpha = 0.35;
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillText('cryptota.pages.dev', 8, src.height / dpr - 16);
        ctx.restore();

        // Download
        out.toBlob((blob) => {
            if (!blob) { showToast('Screenshot failed'); return; }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `cryptota-${state.activePair || 'chart'}-${state.timeframe || ''}-${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 3000);
            showToast('Chart saved as PNG');
        }, 'image/png');
    }

    /* Theme toggle button (☀/☾) + shortcuts hint (?) in the topbar */
    function buildThemeButton() {
        if (document.getElementById('themeButton')) return;
        const btn = document.createElement('button');
        btn.id = 'themeButton';
        btn.className = 'ct-icon-btn';
        btn.title = 'Light / dark theme (T)';
        const render = () => { btn.innerHTML = Theme.get() === 'light' ? '☀' : '☾'; };
        render();
        btn.addEventListener('click', () => { Theme.toggle(); render(); });
        const anchor = document.getElementById('riskButton') || document.getElementById('mtfButton');
        if (anchor) anchor.parentNode.insertBefore(btn, anchor);

        const hint = document.createElement('button');
        hint.id = 'hotkeyHint';
        hint.className = 'ct-icon-btn';
        hint.title = 'Keyboard shortcuts (?)';
        hint.textContent = '?';
        hint.addEventListener('click', () => Hotkeys.toggleSheet());
        anchor.parentNode.insertBefore(hint, btn);
    }

    function setDrawCursor(tool) {
        const cv = document.getElementById('chartCanvas');
        if (!cv) return;
        cv.classList.toggle('draw-mode', tool !== 'off');
    }

    function updateDrawUI(tool) {
        const tools = document.getElementById('drawTools');
        if (!tools) return;
        tools.querySelectorAll('.ct-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.tool === tool);
        });
    }

    /* ============== Utilities ============== */

    function formatPrice(p) {
        if (p == null) return '—';
        if (p >= 1000) return p.toFixed(2);
        if (p >= 1) return p.toFixed(4);
        if (p >= 0.01) return p.toFixed(5);
        return p.toFixed(8);
    }

    // Compact volume: 1.23B, 45.6M, 789K, 123
    function formatVolume(v) {
        if (v == null || isNaN(v)) return '—';
        if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
        if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
        if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
        return v.toFixed(0);
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);