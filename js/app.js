/* === CryptoTA — Main App === */

const App = (() => {
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

        await loadPairs();
        bindUI();
        connectTickerStream();
        renderIndicatorModal();
        renderStrategyModal();
        renderActiveIndicators();
        bindStrategyPanel();

        // Default to BTC/USDT
        if (state.pairs.length > 0) {
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
            updateHeaderPrice();
        });
        state.tickerStream.connect();
    }

    async function selectPair(symbol, forceReload = false) {
        if (state.activePair === symbol && !forceReload) return;
        state.activePair = symbol;

        // Close previous stream
        if (state.klineStream) { state.klineStream.close(); state.klineStream = null; }

        document.querySelectorAll('.pair-row').forEach(el => {
            el.classList.toggle('active', el.dataset.symbol === symbol);
        });

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
            },
            (candle) => { /* on candle close — recompute */ }
        );
        state.klineStream.connect();
    }

    async function changeTimeframe(tf) {
        if (state.timeframe === tf) return;
        state.timeframe = tf;
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
        });
        document.getElementById('showSidebarBtn').addEventListener('click', () => {
            document.body.classList.remove('sidebar-hidden');
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

        if (!filtered.length) {
            list.innerHTML = '<div class="empty-state">Nothing found</div>';
            return;
        }

        list.innerHTML = filtered.map(p => {
            const t = state.tickers[p.symbol];
            const last = t ? t.last : null;
            const change = t ? t.change : null;
            const cls = change > 0 ? 'up' : (change < 0 ? 'down' : 'flat');
            const sign = change > 0 ? '+' : '';
            return `
                <div class="pair-row ${p.symbol === state.activePair ? 'active' : ''}" data-symbol="${p.symbol}">
                    <div class="pair-symbol">
                        <span class="pair-symbol-base">${p.base}</span>
                        <span class="pair-symbol-quote">/${p.quote}</span>
                    </div>
                    <div class="pair-price">${last !== null ? formatPrice(last) : '—'}</div>
                    <div class="pair-change ${cls}">${change !== null ? sign + change.toFixed(2) + '%' : '—'}</div>
                </div>
            `;
        }).join('');

        // Bind clicks
        list.querySelectorAll('.pair-row').forEach(row => {
            row.addEventListener('click', () => selectPair(row.dataset.symbol));
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

        if (price !== null) priceEl.textContent = formatPrice(price);
        if (change !== null) {
            const cls = change > 0 ? 'up' : (change < 0 ? 'down' : 'flat');
            const sign = change > 0 ? '+' : '';
            changeEl.textContent = `${sign}${change.toFixed(2)}%`;
            changeEl.className = `symbol-change ${cls}`;
        }
    }

    function showToast(msg, ms = 2500) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.style.display = 'block';
        clearTimeout(t._timer);
        t._timer = setTimeout(() => { t.style.display = 'none'; }, ms);
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

    /* ============== Utilities ============== */

    function formatPrice(p) {
        if (p == null) return '—';
        if (p >= 1000) return p.toFixed(2);
        if (p >= 1) return p.toFixed(4);
        if (p >= 0.01) return p.toFixed(5);
        return p.toFixed(8);
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);