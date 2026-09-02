/* === CryptoTA — Canvas Chart Engine === */

const ChartEngine = (() => {
    const COLORS = {
        up:        '#16c784',
        down:      '#ea3943',
        wickUp:    '#16c784',
        wickDown:  '#ea3943',
        grid:      'rgba(255,255,255,0.04)',
        gridStrong:'rgba(255,255,255,0.08)',
        text:      '#9ba4b8',
        textDim:   '#6b7488',
        textBright:'#e8ecf4',
        bg:        '#0a0e1a',
        volUp:     'rgba(22,199,132,0.45)',
        volDown:   'rgba(234,57,67,0.45)',
        crosshair: 'rgba(255,255,255,0.25)',
        lastPrice: 'rgba(92,200,192,0.85)',
        paneBg:    'rgba(255,255,255,0.02)'
    };

    // Indicator palette (cyclic)
    const IND_PALETTE = ['#5cc8c0','#c9a857','#9b8ec9','#a87a5c','#7a8a9e','#c97a8a','#8b9bb3','#e8ecf4'];

    let state = {
        candles: [],
        indicators: [],           // active indicators
        chartType: 'candles',     // candles | line | area
        viewStart: 0,             // first visible candle index
        viewCount: 100,           // number of visible candles
        hoverIndex: -1,
        paddingLeft: 8,
        paddingRight: 64,         // space for Y axis
        paddingTop: 16,
        paddingBottom: 28,
        dpr: 1,
        width: 0,
        height: 0,
        crosshair: null,
        lastPriceLine: true,
        overlayIndicators: [],
        paneIndicators: [],       // [{ind, data, min, max, height}]
        strategies: [],           // [{key, name, signals: [{i, type}], color, enabled}]
        totalPaneHeight: 0
    };

    let canvas, ctx, overlay;
    let onStateChange = null;

    function init(canvasEl, overlayEl, onChange) {
        canvas = canvasEl;
        overlay = overlayEl;
        ctx = canvas.getContext('2d');
        onStateChange = onChange;

        resize();
        window.addEventListener('resize', resize);

        // Mouse-wheel zoom
        canvas.addEventListener('wheel', onWheel, { passive: false });
        // Drag to scroll / zoom
        canvas.addEventListener('mousedown', onMouseDown);
        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('mouseup', onMouseUp);
        canvas.addEventListener('mouseleave', onMouseLeave);
    }

    function resize() {
        const rect = canvas.parentElement.getBoundingClientRect();
        state.dpr = window.devicePixelRatio || 1;
        state.width = rect.width;
        state.height = rect.height;
        canvas.width = rect.width * state.dpr;
        canvas.height = rect.height * state.dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
        computePanesLayout();
        render();
    }

    function computePanesLayout() {
        // Each pane takes ~90px by default; total height is the sum
        let totalPaneHeight = 0;
        for (const p of state.paneIndicators) {
            p.height = 90;
            totalPaneHeight += p.height + 16; // 16 — separator
        }
        state.totalPaneHeight = totalPaneHeight;
        // Shrink price chart area by total pane height
        state.paddingBottom = 28 + totalPaneHeight;
    }

    function setData(candles) {
        state.candles = candles;
        state.viewStart = Math.max(0, candles.length - state.viewCount);
        render();
    }

    function appendCandle(candle) {
        const last = state.candles[state.candles.length - 1];
        if (last && last.time === candle.time) {
            state.candles[state.candles.length - 1] = candle;
        } else {
            state.candles.push(candle);
        }
        // if user is at the latest bar — slide the view
        const atEnd = state.viewStart + state.viewCount >= state.candles.length - 1;
        if (atEnd) {
            state.viewStart = Math.max(0, state.candles.length - state.viewCount);
        }
        render();
    }

    function setChartType(t) {
        state.chartType = t;
        render();
    }

    function setIndicators(overlayInds, paneInds, strategies = []) {
        state.overlayIndicators = overlayInds;
        state.paneIndicators = paneInds;
        state.strategies = strategies.filter(s => s.enabled);
        computePanesLayout();
        render();
    }

    function resetView() {
        state.viewCount = 100;
        state.viewStart = Math.max(0, state.candles.length - state.viewCount);
        render();
    }

    /* ============== Calculations ============== */

    function priceArea() {
        const top = state.paddingTop;
        const bottom = state.height - state.paddingBottom;
        return { top, bottom, height: bottom - top };
    }

    function xForIndex(i) {
        const { width, paddingLeft, paddingRight, viewCount } = state;
        const usable = width - paddingLeft - paddingRight;
        return paddingLeft + ((i - state.viewStart) + 0.5) * (usable / viewCount);
    }

    function indexForX(x) {
        const { width, paddingLeft, paddingRight, viewCount } = state;
        const usable = width - paddingLeft - paddingRight;
        const rel = (x - paddingLeft) / (usable / viewCount) - 0.5;
        return Math.round(state.viewStart + rel);
    }

    function visibleCandles() {
        const end = Math.min(state.viewStart + state.viewCount, state.candles.length);
        return state.candles.slice(state.viewStart, end);
    }

    function priceRange(visible) {
        let min = Infinity, max = -Infinity;
        for (const c of visible) {
            if (c.low < min) min = c.low;
            if (c.high > max) max = c.high;
        }
        // Include overlay indicators in range calculation
        for (const ind of state.overlayIndicators) {
            extendRange(ind.data, min, max);
        }
        if (min === max) { min *= 0.999; max *= 1.001; }
        const pad = (max - min) * 0.08;
        return { min: min - pad, max: max + pad };
    }

    function extendRange(data, min, max) {
        if (!data) return;
        if (Array.isArray(data)) {
            for (const v of data) {
                if (v == null || isNaN(v)) continue;
                if (Array.isArray(v)) continue;
                if (v < min) min = v;
                if (v > max) max = v;
            }
        } else if (typeof data === 'object') {
            for (const k in data) extendRange(data[k], min, max);
        }
    }

    function yForPrice(price, range) {
        const { top, height } = priceArea();
        const t = (price - range.min) / (range.max - range.min);
        return top + height - t * height;
    }

    /* ============== Render ============== */

    function render() {
        if (!ctx || !state.candles.length) return;
        const w = state.width, h = state.height;

        // BG
        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, w, h);

        const visible = visibleCandles();
        if (!visible.length) return;

        const range = priceRange(visible);

        // 1. Grid
        drawGrid(range);

        // 2. Volume (lower band inside price area)
        drawVolume(visible, range);

        // 3. Candles / line / area
        drawSeries(visible, range);

        // 4. Overlay indicators
        for (const ind of state.overlayIndicators) {
            drawOverlayIndicator(ind, range);
        }

        // 5. Pane indicators
        drawPaneIndicators();

        // 6. Y axis (right)
        drawYAxis(range);

        // 7. X axis (bottom)
        drawXAxis();

        // 8. Last price line
        if (state.lastPriceLine) {
            drawLastPriceLine(range);
        }

        // 9. Crosshair
        if (state.crosshair) {
            drawCrosshair(range);
        }

        // 10. Strategy arrows (on top)
        drawStrategyArrows();
    }

    function drawGrid(range) {
        const { top, height } = priceArea();
        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 1;
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillStyle = COLORS.textDim;

        // Horizontal lines
        const ySteps = 6;
        for (let i = 0; i <= ySteps; i++) {
            const y = top + (height / ySteps) * i;
            ctx.beginPath();
            ctx.moveTo(state.paddingLeft, y);
            ctx.lineTo(state.width - state.paddingRight, y);
            ctx.stroke();
        }
    }

    function drawYAxis(range) {
        const { top, height } = priceArea();
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillStyle = COLORS.text;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const ySteps = 6;
        for (let i = 0; i <= ySteps; i++) {
            const t = i / ySteps;
            const price = range.max - (range.max - range.min) * t;
            const y = top + (height / ySteps) * i;
            ctx.fillText(formatPrice(price), state.width - state.paddingRight + 6, y);
        }
    }

    function drawXAxis() {
        const w = state.width;
        const h = state.height;
        const y = h - state.paddingBottom + 8;
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillStyle = COLORS.textDim;
        ctx.textAlign = 'center';

        const visible = visibleCandles();
        if (!visible.length) return;
        const first = visible[0].time;
        const last = visible[visible.length - 1].time;
        const steps = 6;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = state.paddingLeft + (w - state.paddingLeft - state.paddingRight) * t;
            const ts = first + (last - first) * t;
            ctx.fillText(formatTime(ts, state.candles), x, y);
        }
    }

    function drawSeries(visible, range) {
        if (state.chartType === 'line') {
            drawLine(visible, range);
        } else if (state.chartType === 'area') {
            drawArea(visible, range);
        } else {
            drawCandles(visible, range);
        }
    }

    function drawCandles(visible, range) {
        const usable = state.width - state.paddingLeft - state.paddingRight;
        const candleW = Math.max(1, (usable / state.viewCount) * 0.7);

        for (let i = 0; i < visible.length; i++) {
            const c = visible[i];
            const x = xForIndex(state.viewStart + i);
            const isUp = c.close >= c.open;
            const color = isUp ? COLORS.up : COLORS.down;
            const yO = yForPrice(c.open, range);
            const yC = yForPrice(c.close, range);
            const yH = yForPrice(c.high, range);
            const yL = yForPrice(c.low, range);

            // Wick
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, yH);
            ctx.lineTo(x, yL);
            ctx.stroke();

            // Body
            ctx.fillStyle = color;
            const bodyTop = Math.min(yO, yC);
            const bodyH = Math.max(1, Math.abs(yC - yO));
            ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
        }
    }

    function drawLine(visible, range) {
        if (!visible.length) return;
        ctx.strokeStyle = COLORS.up;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let i = 0; i < visible.length; i++) {
            const c = visible[i];
            const x = xForIndex(state.viewStart + i);
            const y = yForPrice(c.close, range);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    function drawArea(visible, range) {
        if (!visible.length) return;
        const { bottom } = priceArea();
        const grad = ctx.createLinearGradient(0, 0, 0, bottom);
        grad.addColorStop(0, 'rgba(92,200,192,0.25)');
        grad.addColorStop(1, 'rgba(92,200,192,0.02)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        for (let i = 0; i < visible.length; i++) {
            const c = visible[i];
            const x = xForIndex(state.viewStart + i);
            const y = yForPrice(c.close, range);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.lineTo(xForIndex(state.viewStart + visible.length - 1), bottom);
        ctx.lineTo(xForIndex(state.viewStart), bottom);
        ctx.closePath();
        ctx.fill();
        // contour
        ctx.strokeStyle = '#5cc8c0';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i < visible.length; i++) {
            const c = visible[i];
            const x = xForIndex(state.viewStart + i);
            const y = yForPrice(c.close, range);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    function drawVolume(visible, range) {
        if (!visible.length) return;
        const { top, height } = priceArea();
        const volHeight = height * 0.18;
        const volTop = top + height - volHeight;

        // background
        ctx.fillStyle = COLORS.paneBg;
        ctx.fillRect(state.paddingLeft, volTop, state.width - state.paddingLeft - state.paddingRight, volHeight);

        // separator
        ctx.strokeStyle = COLORS.gridStrong;
        ctx.beginPath();
        ctx.moveTo(state.paddingLeft, volTop);
        ctx.lineTo(state.width - state.paddingRight, volTop);
        ctx.stroke();

        let maxVol = 0;
        for (const c of visible) if (c.volume > maxVol) maxVol = c.volume;
        if (maxVol === 0) return;

        const usable = state.width - state.paddingLeft - state.paddingRight;
        const barW = Math.max(1, (usable / state.viewCount) * 0.7);

        for (let i = 0; i < visible.length; i++) {
            const c = visible[i];
            const x = xForIndex(state.viewStart + i);
            const h = (c.volume / maxVol) * (volHeight - 4);
            const isUp = c.close >= c.open;
            ctx.fillStyle = isUp ? COLORS.volUp : COLORS.volDown;
            ctx.fillRect(x - barW / 2, volTop + volHeight - h, barW, h);
        }

        // "Vol" label
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillStyle = COLORS.textDim;
        ctx.textAlign = 'left';
        ctx.fillText('VOL', state.paddingLeft + 4, volTop + 10);
    }

    function drawOverlayIndicator(ind, range) {
        const data = ind.data;
        const color = ind.color;

        if (ind.key === 'ichimoku') {
            drawIchimoku(data, range);
            return;
        }
        if (ind.key === 'supertrend') {
            drawSupertrend(data, range);
            return;
        }
        if (ind.key === 'psar') {
            drawPSAR(data, range);
            return;
        }
        if (ind.key === 'vprofile') {
            drawVolumeProfile(data, color, range);
            return;
        }
        if (ind.key === 'fib') {
            drawFibonacci(data, color, range);
            return;
        }
        if (ind.key === 'pivots') {
            drawPivots(data, color, range);
            return;
        }
        if (ind.key === 'bb' || ind.key === 'keltner') {
            drawBands(data, color, range);
            return;
        }

        // single line
        if (!Array.isArray(data)) return;
        drawLineArray(data, color, range, 1.2);
    }

    function drawLineArray(data, color, range, lw = 1.2) {
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < data.length; i++) {
            const idx = state.viewStart + i;
            if (idx < 0 || idx >= state.viewStart + state.viewCount) continue;
            const v = data[i];
            if (v == null || isNaN(v)) { started = false; continue; }
            const x = xForIndex(idx);
            const y = yForPrice(v, range);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    function drawBands(data, color, range) {
        const { basis, upper, lower } = data;
        if (!upper) return;

        ctx.fillStyle = hexToRgba(color, 0.08);
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < upper.length; i++) {
            const idx = state.viewStart + i;
            if (idx < 0 || idx >= state.viewStart + state.viewCount) continue;
            if (upper[i] == null) continue;
            const x = xForIndex(idx);
            const y = yForPrice(upper[i], range);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        for (let i = upper.length - 1; i >= 0; i--) {
            const idx = state.viewStart + i;
            if (idx < 0 || idx >= state.viewStart + state.viewCount) continue;
            if (lower[i] == null) continue;
            const x = xForIndex(idx);
            const y = yForPrice(lower[i], range);
            ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        let s = false;
        for (let i = 0; i < upper.length; i++) {
            const idx = state.viewStart + i;
            if (idx < 0 || idx >= state.viewStart + state.viewCount) continue;
            if (upper[i] == null) continue;
            const x = xForIndex(idx);
            const y = yForPrice(upper[i], range);
            if (!s) { ctx.moveTo(x, y); s = true; }
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.beginPath();
        s = false;
        for (let i = 0; i < lower.length; i++) {
            const idx = state.viewStart + i;
            if (idx < 0 || idx >= state.viewStart + state.viewCount) continue;
            if (lower[i] == null) continue;
            const x = xForIndex(idx);
            const y = yForPrice(lower[i], range);
            if (!s) { ctx.moveTo(x, y); s = true; }
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // basis — solid
        drawLineArray(basis, color, range, 1);
    }

    function drawIchimoku(data, range) {
        const { tenkan, kijun, senkouA, senkouB, chikou } = data;

        // senkouA vs senkouB cloud
        const startIdx = state.viewStart;
        const endIdx = state.viewStart + state.viewCount;
        // senkouA/B are shifted 26 forward, we need the absolute candle index
        for (let absI = startIdx; absI < endIdx; absI++) {
            // senkouA[absI] = (tenkan[absI - 26] + kijun[absI - 26]) / 2
            const i = absI - 26;
            if (i < 0) continue;
            const a = senkouA[absI];
            const b = senkouB[absI];
            if (a == null || b == null) continue;
            const x1 = xForIndex(absI);
            const x2 = xForIndex(absI + 1);
            const ya = yForPrice(a, range);
            const yb = yForPrice(b, range);
            ctx.fillStyle = a > b ? 'rgba(22,199,132,0.12)' : 'rgba(234,57,67,0.12)';
            ctx.fillRect(x1, Math.min(ya, yb), x2 - x1, Math.abs(ya - yb));
        }

        // Tenkan (blue) and Kijun (red) — in our palette teal and amber
        drawLineArray(senkouA, '#5cc8c0', range, 0.9);
        drawLineArray(senkouB, '#c9a857', range, 0.9);
        drawLineArray(tenkan, '#e8ecf4', range, 1);
        drawLineArray(kijun, '#ea3943', range, 1);
    }

    function drawPSAR(data, range) {
        for (let i = 0; i < data.length; i++) {
            const idx = state.viewStart + i;
            if (idx < 0 || idx >= state.viewStart + state.viewCount) continue;
            const v = data[i];
            if (v == null) continue;
            const x = xForIndex(idx);
            const y = yForPrice(v, range);
            ctx.fillStyle = COLORS.down;
            ctx.beginPath();
            ctx.arc(x, y, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* ===== Supertrend — two-color trend filter ===== */
    function drawSupertrend(data, range) {
        const { line, direction } = data;
        if (!line) return;
        const startIdx = state.viewStart;
        const endIdx = state.viewStart + state.viewCount;

        // Solid line, color changes by direction
        ctx.lineWidth = 1.4;
        let started = false;
        let prevDir = 0;
        for (let i = startIdx; i < endIdx && i < line.length; i++) {
            const v = line[i];
            if (v == null) { started = false; continue; }
            const x = xForIndex(i);
            const y = yForPrice(v, range);
            const dir = direction[i];
            if (!started || dir !== prevDir) {
                if (started) ctx.stroke();
                ctx.strokeStyle = dir === 1 ? COLORS.up : COLORS.down;
                ctx.beginPath();
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
            prevDir = dir;
        }
        if (started) ctx.stroke();

        // Reversal markers (dots at the moment direction changes)
        for (let i = startIdx + 1; i < endIdx && i < line.length; i++) {
            if (direction[i] === 0 || direction[i - 1] === 0) continue;
            if (direction[i] === direction[i - 1]) continue;
            const v = line[i];
            if (v == null) continue;
            const x = xForIndex(i);
            const y = yForPrice(v, range);
            ctx.fillStyle = direction[i] === 1 ? COLORS.up : COLORS.down;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* ===== Volume Profile — horizontal volume bars on the right ===== */
    function drawVolumeProfile(data, color, range) {
        if (!data || !data.bins || !data.bins.length || !data.maxVol) return;
        const { bins, maxVol, minPrice, maxPrice } = data;
        // If bin range is outside the visible range — skip
        if (maxPrice < range.min || minPrice > range.max) return;

        // Limit bar width — to the right edge of the price area
        const maxBarW = Math.min(80, (state.width - state.paddingRight) * 0.18);
        // Base x — right edge of the chart
        const baseX = state.width - state.paddingRight;

        ctx.save();
        // Gradient from transparent to color
        for (const b of bins) {
            if (b.price < range.min || b.price > range.max) continue;
            const y = yForPrice(b.price, range);
            const w = (b.vol / maxVol) * maxBarW;
            const alpha = 0.18 + (b.vol / maxVol) * 0.45;
            ctx.fillStyle = hexToRgba(color, alpha);
            ctx.fillRect(baseX - w, y - 1, w, 2);
        }
        // POC (Point of Control) — the "thickest" bin
        let poc = bins[0];
        for (const b of bins) if (b.vol > poc.vol) poc = b;
        if (poc && poc.vol > 0) {
            const y = yForPrice(poc.price, range);
            const w = (poc.vol / maxVol) * maxBarW;
            ctx.strokeStyle = hexToRgba(color, 0.9);
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 2]);
            ctx.beginPath();
            ctx.moveTo(baseX - w - 4, y);
            ctx.lineTo(baseX, y);
            ctx.stroke();
            ctx.setLineDash([]);
            // POC label
            ctx.fillStyle = hexToRgba(color, 0.95);
            ctx.font = '9px JetBrains Mono, monospace';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText('POC', baseX - w - 6, y);
        }
        ctx.restore();
    }

    /* ===== Fibonacci Retracement — horizontal levels ===== */
    function drawFibonacci(data, color, range) {
        if (!data || !data.levels || !data.levels.length) return;
        ctx.save();
        ctx.font = '9px JetBrains Mono, monospace';
        const xStart = state.paddingLeft;
        const xEnd = state.width - state.paddingRight;
        const fibColors = ['#5cc8c0', '#7a8a9e', '#c9a857', '#9b8ec9', '#a87a5c', '#7a8a9e', '#5cc8c0'];

        data.levels.forEach((lvl, i) => {
            if (lvl.price < range.min || lvl.price > range.max) return;
            const y = yForPrice(lvl.price, range);
            const c = fibColors[i] || color;
            ctx.strokeStyle = hexToRgba(c, lvl.ratio === 0 || lvl.ratio === 1 ? 0.35 : 0.55);
            ctx.lineWidth = lvl.ratio === 0.5 || lvl.ratio === 0.618 ? 1 : 0.8;
            ctx.setLineDash(lvl.ratio === 0.5 || lvl.ratio === 0.618 ? [] : [3, 3]);
            ctx.beginPath();
            ctx.moveTo(xStart, y);
            ctx.lineTo(xEnd, y);
            ctx.stroke();
            ctx.setLineDash([]);
            // Label
            const ratioLabel = (lvl.ratio * 100).toFixed(lvl.ratio === 0.5 ? 0 : 1) + '%';
            ctx.fillStyle = hexToRgba(c, 0.95);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const labelText = `${ratioLabel} ${formatPrice(lvl.price)}`;
            const textW = ctx.measureText(labelText).width;
            // Label background
            ctx.fillStyle = 'rgba(10, 14, 26, 0.85)';
            ctx.fillRect(xStart + 4, y - 7, textW + 8, 14);
            ctx.fillStyle = hexToRgba(c, 0.95);
            ctx.fillText(labelText, xStart + 8, y);
        });
        ctx.restore();
    }

    /* ===== Pivot Points — horizontal R/S levels ===== */
    function drawPivots(data, color, range) {
        if (!data || !data.levels || !data.levels.length) return;
        ctx.save();
        ctx.font = '9px JetBrains Mono, monospace';
        const xStart = state.paddingLeft;
        const xEnd = state.width - state.paddingRight;
        const pivotP = data.levels.find(l => l.name === 'P');

        data.levels.forEach(lvl => {
            if (lvl.price < range.min || lvl.price > range.max) return;
            const y = yForPrice(lvl.price, range);
            const isR = lvl.name.startsWith('R');
            const isP = lvl.name === 'P';
            const baseColor = isP ? '#5cc8c0' : (isR ? '#16c784' : '#ea3943');
            const alpha = isP ? 0.7 : 0.45;

            ctx.strokeStyle = hexToRgba(baseColor, alpha);
            ctx.lineWidth = isP ? 1.1 : 0.7;
            ctx.setLineDash(isP ? [] : [2, 4]);
            ctx.beginPath();
            ctx.moveTo(xStart, y);
            ctx.lineTo(xEnd, y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Label on the right
            ctx.fillStyle = hexToRgba(baseColor, 0.95);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const labelText = `${lvl.name} ${formatPrice(lvl.price)}`;
            const textW = ctx.measureText(labelText).width;
            ctx.fillStyle = 'rgba(10, 14, 26, 0.85)';
            ctx.fillRect(xEnd - textW - 12, y - 7, textW + 8, 14);
            ctx.fillStyle = hexToRgba(baseColor, 0.95);
            ctx.fillText(labelText, xEnd - textW - 8, y);
        });
        ctx.restore();
    }

    function drawPaneIndicators() {
        let y = state.height - state.paddingBottom + 16;
        for (const pane of state.paneIndicators) {
            // Pane background
            ctx.fillStyle = COLORS.paneBg;
            ctx.fillRect(state.paddingLeft, y, state.width - state.paddingLeft - state.paddingRight, pane.height);

            // Top separator
            ctx.strokeStyle = COLORS.gridStrong;
            ctx.beginPath();
            ctx.moveTo(state.paddingLeft, y);
            ctx.lineTo(state.width - state.paddingRight, y);
            ctx.stroke();

            // Min/Max accounting for indicator
            const range = paneRange(pane);

            // Levels (if set)
            if (pane.ind.levels) {
                ctx.strokeStyle = 'rgba(255,255,255,0.06)';
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 3]);
                for (const lv of pane.ind.levels) {
                    if (lv < range.min || lv > range.max) continue;
                    const ly = y + pane.height - ((lv - range.min) / (range.max - range.min)) * pane.height;
                    ctx.beginPath();
                    ctx.moveTo(state.paddingLeft, ly);
                    ctx.lineTo(state.width - state.paddingRight, ly);
                    ctx.stroke();
                    ctx.fillStyle = COLORS.textDim;
                    ctx.font = '9px JetBrains Mono, monospace';
                    ctx.textAlign = 'left';
                    ctx.fillText(lv.toFixed(lv < 10 ? 2 : 0), state.paddingLeft + 4, ly - 2);
                }
                ctx.setLineDash([]);
            }

            // Data
            if (pane.ind.key === 'macd') {
                drawMACD(pane, y, range);
            } else if (pane.ind.key === 'stoch') {
                drawStoch(pane, y, range);
            } else if (pane.ind.key === 'ao') {
                drawAO(pane, y, range);
            } else {
                drawSinglePaneLine(pane, y, range);
            }

            // Indicator label
            ctx.font = '9px JetBrains Mono, monospace';
            ctx.fillStyle = COLORS.text;
            ctx.textAlign = 'right';
            ctx.fillText(`${pane.ind.name}(${Object.values(pane.ind.params).join(',')})`,
                state.width - state.paddingRight - 4, y + 12);

            y += pane.height + 16;
        }
    }

    function paneRange(pane) {
        if (pane.ind.fixedMin !== undefined && pane.ind.fixedMax !== undefined) {
            return { min: pane.ind.fixedMin, max: pane.ind.fixedMax };
        }
        let min = Infinity, max = -Infinity;
        const data = pane.ind.data;
        extendRange(data, min, max);
        if (min === max) { min -= 1; max += 1; }
        const pad = (max - min) * 0.1 || 1;
        return { min: min - pad, max: max + pad };
    }

    function drawSinglePaneLine(pane, yOffset, range) {
        const data = pane.ind.data;
        if (!Array.isArray(data)) return;
        ctx.strokeStyle = pane.ind.color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < data.length; i++) {
            const idx = state.viewStart + i;
            if (idx < 0 || idx >= state.viewStart + state.viewCount) continue;
            const v = data[i];
            if (v == null || isNaN(v)) { started = false; continue; }
            const x = xForIndex(idx);
            const t = (v - range.min) / (range.max - range.min);
            const y = yOffset + pane.height - t * pane.height;
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    function drawMACD(pane, yOffset, range) {
        const { macd, signal, histogram } = pane.ind.data;
        // histogram
        const usable = state.width - state.paddingLeft - state.paddingRight;
        const barW = Math.max(1, (usable / state.viewCount) * 0.7);
        for (let i = 0; i < histogram.length; i++) {
            const idx = state.viewStart + i;
            if (idx < 0 || idx >= state.viewStart + state.viewCount) continue;
            const v = histogram[i];
            if (v == null) continue;
            const x = xForIndex(idx);
            const t = (v - range.min) / (range.max - range.min);
            const y = yOffset + pane.height - t * pane.height;
            const zeroT = (0 - range.min) / (range.max - range.min);
            const zeroY = yOffset + pane.height - zeroT * pane.height;
            ctx.fillStyle = v >= 0 ? 'rgba(22,199,132,0.5)' : 'rgba(234,57,67,0.5)';
            ctx.fillRect(x - barW / 2, Math.min(y, zeroY), barW, Math.abs(y - zeroY));
        }
        drawSinglePaneLine({ ...pane, ind: { ...pane.ind, data: macd, color: pane.ind.color, key: '_line' } }, yOffset, range);
        drawSinglePaneLine({ ...pane, ind: { ...pane.ind, data: signal, color: '#ea3943', key: '_line' } }, yOffset, range);
    }

    function drawStoch(pane, yOffset, range) {
        drawSinglePaneLine({ ...pane, ind: { ...pane.ind, data: pane.ind.data.k, color: pane.ind.color, key: '_line' } }, yOffset, range);
        drawSinglePaneLine({ ...pane, ind: { ...pane.ind, data: pane.ind.data.d, color: '#ea3943', key: '_line' } }, yOffset, range);
    }

    function drawAO(pane, yOffset, range) {
        const data = pane.ind.data.ao;
        const usable = state.width - state.paddingLeft - state.paddingRight;
        const barW = Math.max(1, (usable / state.viewCount) * 0.7);
        for (let i = 0; i < data.length; i++) {
            const idx = state.viewStart + i;
            if (idx < 0 || idx >= state.viewStart + state.viewCount) continue;
            const v = data[i];
            if (v == null) continue;
            const x = xForIndex(idx);
            const t = (v - range.min) / (range.max - range.min);
            const y = yOffset + pane.height - t * pane.height;
            const zeroT = (0 - range.min) / (range.max - range.min);
            const zeroY = yOffset + pane.height - zeroT * pane.height;
            ctx.fillStyle = v >= 0 ? 'rgba(22,199,132,0.55)' : 'rgba(234,57,67,0.55)';
            ctx.fillRect(x - barW / 2, Math.min(y, zeroY), barW, Math.abs(y - zeroY));
        }
    }

    function drawLastPriceLine(range) {
        const last = state.candles[state.candles.length - 1];
        if (!last) return;
        const y = yForPrice(last.close, range);
        ctx.strokeStyle = COLORS.lastPrice;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(state.paddingLeft, y);
        ctx.lineTo(state.width - state.paddingRight, y);
        ctx.stroke();
        ctx.setLineDash([]);
        // Label on the right
        ctx.fillStyle = COLORS.lastPrice;
        ctx.fillRect(state.width - state.paddingRight, y - 9, state.paddingRight - 4, 18);
        ctx.fillStyle = '#0a0e1a';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatPrice(last.close), state.width - state.paddingRight + 4, y);
    }

    /* ============== Strategy arrows ============== */
    function drawStrategyArrows() {
        if (!state.strategies.length) return;
        const startIdx = state.viewStart;
        const endIdx = state.viewStart + state.viewCount;
        const range = priceRange(visibleCandles());
        for (const strat of state.strategies) {
            if (!strat.signals) continue;
            for (const sig of strat.signals) {
                if (sig.i < startIdx || sig.i >= endIdx) continue;
                const x = xForIndex(sig.i);
                const c = state.candles[sig.i];
                if (!c) continue;
                // BUY: triangle ▲ pointing up, its BOTTOM at candle low
                // SELL: triangle ▼ pointing down, its TOP at candle high
                const yAnchor = sig.type === 'BUY'
                    ? yForPrice(c.low, range)
                    : yForPrice(c.high, range);
                drawArrow(x, yAnchor, sig.type, strat.color);
            }
        }
    }

    function drawArrow(x, y, type, color) {
        const size = 8;
        ctx.save();
        // Thin black outline for contrast against background
        ctx.strokeStyle = '#0a0e1a';
        ctx.lineWidth = 1.2;
        ctx.fillStyle = color;
        ctx.globalAlpha = 1;
        if (type === 'BUY') {
            // Triangle up ▲ — bottom at y, apex above
            ctx.beginPath();
            ctx.moveTo(x, y - size * 1.7);     // apex (top)
            ctx.lineTo(x - size * 0.85, y);    // bottom-left
            ctx.lineTo(x + size * 0.85, y);    // bottom-right
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        } else {
            // Triangle down ▼ — top at y, apex below
            ctx.beginPath();
            ctx.moveTo(x, y + size * 1.7);     // apex (bottom)
            ctx.lineTo(x - size * 0.85, y);
            ctx.lineTo(x + size * 0.85, y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawCrosshair(range) {
        const { x, y } = state.crosshair;
        ctx.strokeStyle = COLORS.crosshair;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(state.paddingLeft, y);
        ctx.lineTo(state.width - state.paddingRight, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, state.paddingTop);
        ctx.lineTo(x, state.height - state.paddingBottom);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    /* ============== Interaction ============== */

    let dragStart = null;

    function onWheel(e) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
        const oldCount = state.viewCount;
        const newCount = Math.max(20, Math.min(500, Math.round(oldCount * factor)));
        if (newCount === oldCount) return;

        const mouseX = e.offsetX;
        const usable = state.width - state.paddingLeft - state.paddingRight;
        const relX = (mouseX - state.paddingLeft) / usable;
        const idxUnderMouse = state.viewStart + relX * oldCount;
        state.viewCount = newCount;
        state.viewStart = Math.round(idxUnderMouse - relX * newCount);
        state.viewStart = Math.max(0, Math.min(state.candles.length - newCount, state.viewStart));
        render();
    }

    function onMouseDown(e) {
        dragStart = { x: e.offsetX, startView: state.viewStart };
    }

    function onMouseMove(e) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        state.crosshair = { x, y };

        if (dragStart) {
            const usable = state.width - state.paddingLeft - state.paddingRight;
            const dx = e.offsetX - dragStart.x;
            const idxShift = Math.round(-(dx / usable) * state.viewCount);
            state.viewStart = Math.max(0, Math.min(state.candles.length - state.viewCount, dragStart.startView + idxShift));
        }

        const idx = indexForX(x);
        if (idx >= 0 && idx < state.candles.length) {
            state.hoverIndex = idx;
            updateCrosshairInfo();
        } else {
            state.hoverIndex = -1;
            hideCrosshairInfo();
        }
        render();
    }

    function onMouseUp() { dragStart = null; }
    function onMouseLeave() {
        state.crosshair = null;
        state.hoverIndex = -1;
        hideCrosshairInfo();
        dragStart = null;
        render();
    }

    function updateCrosshairInfo() {
        const i = state.hoverIndex;
        if (i < 0 || i >= state.candles.length) return;
        const c = state.candles[i];
        const info = document.getElementById('crosshairInfo');
        if (!info) return;
        info.style.display = 'block';
        document.getElementById('ciO').textContent = formatPrice(c.open);
        document.getElementById('ciH').textContent = formatPrice(c.high);
        document.getElementById('ciL').textContent = formatPrice(c.low);
        document.getElementById('ciC').textContent = formatPrice(c.close);
        document.getElementById('ciV').textContent = formatVolume(c.volume);
    }

    function hideCrosshairInfo() {
        const info = document.getElementById('crosshairInfo');
        if (info) info.style.display = 'none';
    }

    /* ============== Utilities ============== */

    function formatPrice(p) {
        if (p == null) return '—';
        if (p >= 1000) return p.toFixed(2);
        if (p >= 1) return p.toFixed(4);
        if (p >= 0.01) return p.toFixed(5);
        return p.toFixed(8);
    }

    function formatVolume(v) {
        if (v == null) return '—';
        if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
        if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
        if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
        return v.toFixed(2);
    }

    function formatTime(ts, candles) {
        const d = new Date(ts);
        if (state.viewCount > 200) return `${d.getDate()}.${(d.getMonth()+1).toString().padStart(2,'0')}`;
        if (state.viewCount > 50) return `${d.getDate()}.${(d.getMonth()+1).toString().padStart(2,'0')} ${d.getHours()}:00`;
        return `${d.getDate()}.${(d.getMonth()+1).toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    }

    function hexToRgba(hex, a) {
        const v = hex.replace('#', '');
        const r = parseInt(v.slice(0, 2), 16);
        const g = parseInt(v.slice(2, 4), 16);
        const b = parseInt(v.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${a})`;
    }

    return {
        init,
        setData,
        appendCandle,
        setChartType,
        setIndicators,
        resetView,
        getState: () => state
    };
})();

window.ChartEngine = ChartEngine;