/* === CryptoTA — Chart Drawing Layer (trend lines) ===
 * Lines are stored in DATA coordinates (candle time + price) so they
 * survive zoom / pan / timeframe switches and page reloads.
 * Storage: localStorage, keyed per symbol ("cryptota.draw.BTCUSDT").
 *
 * Integration:
 *  - Drawing.setChartAPI({xForIndex, indexForX, yForPrice, getCandles,
 *    priceArea}, symbol) is called after ChartEngine.init().
 *  - ChartEngine.render() calls Drawing.render(ctx, range) (step 4.5).
 *  - ChartEngine mouse handlers call Drawing.onMouseDown/Move/Up first;
 *    if they return true, the event is consumed (no pan).
 */

const Drawing = (() => {
    const LS_PREFIX = 'cryptota.draw.';
    const LINE_COLOR = '#c9a857';        // amber — matches indicator palette
    const LINE_WIDTH = 1.2;
    const LINE_ALPHA = 0.85;
    const HANDLE_ALPHA = 0.9;

    let api = null;              // {xForIndex, indexForX, yForPrice, getCandles, priceArea}
    let lines = [];              // [{id, time1, price1, time2, price2}]
    let tool = 'off';            // 'off' | 'line'
    let drawing = false;
    let currentLine = null;      // line being drawn
    let hoverLineId = null;      // line under cursor
    let dragLineId = null;       // line being dragged
    let dragOffset = null;       // {handle, ...offsets}
    let sym = null;              // current symbol (storage key)
    let onModeChange = null;
    let cursorPos = null;        // last mouse position (pixels)

    function setChartAPI(chartApi, symbol, modeChangeCb) {
        api = chartApi;
        sym = symbol;
        onModeChange = modeChangeCb || null;
        load();
    }

    function setSymbol(symbol) {
        if (sym === symbol) return;
        sym = symbol;
        load();
    }

    function load() {
        if (!sym) { lines = []; return; }
        try {
            lines = JSON.parse(localStorage.getItem(LS_PREFIX + sym) || '[]');
        } catch (e) {
            lines = [];
        }
    }

    function save() {
        if (!sym) return;
        try {
            localStorage.setItem(LS_PREFIX + sym, JSON.stringify(lines));
        } catch (e) { /* storage full — ignore */ }
    }

    function setTool(t) {
        tool = t;
        drawing = false;
        currentLine = null;
        dragLineId = null;
        if (onModeChange) onModeChange(tool);
    }

    function clearAll() {
        lines = [];
        save();
    }

    function getTool() { return tool; }
    function getLineCount() { return lines.length; }

    /* ===== time ↔ candle index (fractional, for smooth rendering) ===== */
    function timeToIndex(t) {
        if (!api) return null;
        const candles = api.getCandles();
        if (!candles || !candles.length) return null;
        if (t <= candles[0].time) return 0;
        const last = candles[candles.length - 1].time;
        if (t >= last) return candles.length - 1;
        let lo = 0, hi = candles.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (candles[mid].time <= t) lo = mid;
            else hi = mid - 1;
        }
        const ct = candles[lo];
        const nt = candles[lo + 1];
        if (nt && nt.time > ct.time) {
            return lo + (t - ct.time) / (nt.time - ct.time);
        }
        return lo;
    }

    function indexToTime(idx) {
        const candles = api ? api.getCandles() : null;
        if (!candles || !candles.length) return null;
        const i = Math.max(0, Math.min(candles.length - 1, Math.round(idx)));
        return candles[i].time;
    }

    /* endpoint of a line in pixels; null if not computable */
    function endPoint(line, which, range) {
        const t = which === 1 ? line.time1 : line.time2;
        const p = which === 1 ? line.price1 : line.price2;
        if (t == null || p == null) return null;
        const idx = timeToIndex(t);
        if (idx == null) return null;
        return { x: api.xForIndex(idx), y: api.yForPrice(p, range) };
    }

    /* ===== Rendering (called from ChartEngine.render) ===== */
    function render(ctx, range) {
        if (!api) return;
        ctx.save();

        // Saved lines
        for (const line of lines) {
            const a = endPoint(line, 1, range);
            const b = endPoint(line, 2, range);
            if (!a || !b) continue;
            const active = hoverLineId === line.id || dragLineId === line.id;

            ctx.strokeStyle = rgba(LINE_COLOR, active ? 0.95 : LINE_ALPHA);
            ctx.lineWidth = active ? 1.4 : LINE_WIDTH;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();

            // endpoint handles — only when active (SUBTLE)
            if (active) {
                drawHandle(ctx, a.x, a.y);
                drawHandle(ctx, b.x, b.y);
            }
        }

        // Preview while drawing
        if (drawing && currentLine && cursorPos) {
            const a = endPoint(currentLine, 1, range);
            const preview = {
                time1: currentLine.time1,
                price1: currentLine.price1,
                time2: timeAt(cursorPos.x),
                price2: priceAt(cursorPos.y, range)
            };
            const b = endPoint(preview, 2, range);
            if (a && b) {
                ctx.strokeStyle = rgba(LINE_COLOR, 0.5);
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
        ctx.restore();
    }

    function drawHandle(ctx, x, y) {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = rgba(LINE_COLOR, HANDLE_ALPHA);
        ctx.fill();
        ctx.strokeStyle = '#0a0e1a';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    /* ===== Mouse handling (called by ChartEngine first) ===== */
    function onMouseDown(pos, range) {
        if (tool === 'off' || !api) return false;

        // Edit existing: handles or body of a hovered line
        const hit = hitTest(pos, range);
        if (hit) {
            dragLineId = hit.id;
            if (hit.handle) {
                dragOffset = { handle: hit.handle };
            } else {
                // whole-line move: keep offsets from cursor
                dragOffset = {
                    handle: 0,
                    dTime1: hit.line.time1 - timeAt(pos.x),
                    dPrice1: hit.line.price1 - priceAt(pos.y, range),
                    dTime2: hit.line.time2 - timeAt(pos.x),
                    dPrice2: hit.line.price2 - priceAt(pos.y, range)
                };
            }
            return true;
        }

        // Start a new line
        drawing = true;
        currentLine = {
            time1: timeAt(pos.x),
            price1: priceAt(pos.y, range),
            time2: null,
            price2: null
        };
        return true;
    }

    function onMouseMove(pos, range) {
        cursorPos = pos;
        if (tool === 'off' || !api) return false;

        if (drawing) return true;   // consume: no pan while drawing

        if (dragLineId != null) {
            const line = lines.find(l => l.id === dragLineId);
            if (line) {
                if (dragOffset.handle === 0) {
                    line.time1 = timeAt(pos.x) + dragOffset.dTime1;
                    line.price1 = priceAt(pos.y, range) + dragOffset.dPrice1;
                    line.time2 = timeAt(pos.x) + dragOffset.dTime2;
                    line.price2 = priceAt(pos.y, range) + dragOffset.dPrice2;
                } else {
                    const h = dragOffset.handle;
                    line['time' + h] = timeAt(pos.x);
                    line['price' + h] = priceAt(pos.y, range);
                }
            }
            return true;
        }

        // hover detection
        const hit = hitTest(pos, range);
        hoverLineId = hit ? hit.id : null;
        return false;
    }

    function onMouseUp(pos, range) {
        if (dragLineId != null) {
            save();
            dragLineId = null;
            dragOffset = null;
            return true;
        }
        if (drawing) {
            if (currentLine) {
                currentLine.time2 = timeAt(pos.x);
                currentLine.price2 = priceAt(pos.y, range);
                // keep only if it is a real line, not a stray click
                const dx = Math.abs(currentLine.time2 - currentLine.time1);
                const dy = Math.abs(currentLine.price2 - currentLine.price1);
                if (dx > 0 || dy > 0) {
                    currentLine.id = 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                    lines.push(currentLine);
                    save();
                }
            }
            drawing = false;
            currentLine = null;
            return true;
        }
        return false;
    }

    function onMouseLeave() {
        hoverLineId = null;
        cursorPos = null;
        // keep in-progress drawing alive if mouse returns, but stop preview
    }

    /* handle/body hit test; returns {id, handle (1|2|0), line} or null */
    function hitTest(pos, range) {
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            const a = endPoint(line, 1, range);
            const b = endPoint(line, 2, range);
            if (!a || !b) continue;
            if (dist(pos, a) <= 7) return { id: line.id, handle: 1, line };
            if (dist(pos, b) <= 7) return { id: line.id, handle: 2, line };
            if (pointNearLine(pos, a, b, 6)) return { id: line.id, handle: 0, line };
        }
        return null;
    }

    /* ===== pixel → data coords ===== */
    function timeAt(x) {
        const idx = api.indexForX(x);
        if (idx == null) return null;
        return indexToTime(idx);
    }

    function priceAt(y, range) {
        const area = api.priceArea();
        const clampedY = Math.max(area.top + 1, Math.min(area.top + area.height - 1, y));
        const t = (area.top + area.height - clampedY) / area.height;
        return range.min + t * (range.max - range.min);
    }

    /* ===== Geometry ===== */
    function dist(p, q) {
        return Math.hypot(p.x - q.x, p.y - q.y);
    }

    function pointNearLine(p, a, b, tol) {
        const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        if (L2 === 0) return dist(p, a) <= tol;
        let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / L2;
        t = Math.max(0, Math.min(1, t));
        const px = a.x + t * (b.x - a.x);
        const py = a.y + t * (b.y - a.y);
        return Math.hypot(p.x - px, p.y - py) <= tol;
    }

    function rgba(hex, a) {
        const v = hex.replace('#', '');
        const r = parseInt(v.slice(0, 2), 16);
        const g = parseInt(v.slice(2, 4), 16);
        const b = parseInt(v.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${a})`;
    }

    return {
        setChartAPI, setSymbol, setTool, clearAll,
        render, onMouseDown, onMouseMove, onMouseUp, onMouseLeave,
        getTool, getLineCount,
        onKeyDown
    };

    /* Delete hovered line — hook from UI (Delete/Backspace) */
    function onKeyDown(e) {
        if (tool === 'off') return false;
        if ((e.key === 'Delete' || e.key === 'Backspace') && hoverLineId) {
            lines = lines.filter(l => l.id !== hoverLineId);
            hoverLineId = null;
            save();
            return true;
        }
        if (e.key === 'Escape') {
            drawing = false;
            currentLine = null;
            dragLineId = null;
            return true;
        }
        return false;
    }
})();
window.Drawing = Drawing;
