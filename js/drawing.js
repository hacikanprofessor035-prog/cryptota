/* === CryptoTA — Chart Drawing Layer (trend lines + levels + zones + fib fan) ===
 * Objects are stored in DATA coordinates (candle time + price) so they
 * survive zoom / pan / timeframe switches and page reloads.
 * Storage: localStorage, keyed per symbol ("cryptota.draw.BTCUSDT").
 *  - trend line: {id, time1, price1, time2, price2}          (no type field)
 *  - horizontal: {id, type: 'hline', price}
 *  - rect zone:  {id, type: 'rect', time1, price1, time2, price2}
 *  - fib fan:    {id, type: 'fib', time1, price1, time2, price2}
 *
 * Integration:
 *  - Drawing.setChartAPI({xForIndex, indexForX, yForPrice, getCandles,
 *    priceArea, chartEdges, formatPrice}, symbol) — after ChartEngine.init().
 *  - ChartEngine.render() calls Drawing.render(ctx, range) (step 7.5).
 *  - ChartEngine mouse handlers call Drawing.onMouseDown/Move/Up first;
 *    if they return true, the event is consumed (no pan).
 */

const Drawing = (() => {
    const LS_PREFIX = 'cryptota.draw.';
    const LINE_COLOR = '#c9a857';        // amber — matches indicator palette
    const HLINE_COLOR = '#7a8a9e';       // muted slate — distinct from segments
    const RECT_COLOR = '#c9a857';        // amber border, faint amber fill
    const FIB_COLOR = '#9b8ec9';         // violet — from indicator palette
    const FIB_LEVELS = [0.382, 0.5, 0.618, 0.786];
    const LINE_WIDTH = 1.2;
    const LINE_ALPHA = 0.85;
    const HANDLE_ALPHA = 0.9;

    let api = null;              // {xForIndex, indexForX, yForPrice, getCandles, priceArea, chartEdges, formatPrice}
    let lines = [];              // mixed: segments + hlines
    let tool = 'off';            // 'off' | 'line' | 'hline'
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

    /* ===== Share: export/import objects ===== */
    function getObjects() {
        return JSON.parse(JSON.stringify(lines));
    }

    function setObjects(objs) {
        if (!Array.isArray(objs)) return;
        // re-id to avoid collisions
        lines = objs.map(o => {
            const copy = { ...o };
            const prefix = copy.type === 'hline' ? 'H' : copy.type === 'rect' ? 'R' : copy.type === 'fib' ? 'F' : 'L';
            copy.id = prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            return copy;
        });
        save();
    }

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

        // Saved objects
        for (const line of lines) {
            if (line.type === 'hline') {
                renderHLine(ctx, line, range);
            } else if (line.type === 'rect') {
                renderRect(ctx, line, range);
            } else if (line.type === 'fib') {
                renderFib(ctx, line, range);
            } else {
                renderSegment(ctx, line, range);
            }
        }

        // Preview while drawing
        if (drawing && currentLine && cursorPos) {
            if (currentLine.type === 'hline') {
                // horizontal: full-width dotted line at cursor price
                const y = api.yForPrice(currentLine.price1, range);
                const edges = api.chartEdges();
                ctx.strokeStyle = rgba(HLINE_COLOR, 0.5);
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(edges.left, y);
                ctx.lineTo(edges.right, y);
                ctx.stroke();
                ctx.setLineDash([]);
            } else if (currentLine.type === 'rect') {
                // rect zone: from anchor to cursor
                const a = endPoint(currentLine, 1, range);
                const bx = api.xForIndex(timeToIndex(timeAt(cursorPos.x)) || 0);
                const by = api.yForPrice(priceAt(cursorPos.y, range), range);
                if (a) {
                    const x = Math.min(a.x, bx), y = Math.min(a.y, by);
                    const w = Math.abs(bx - a.x), h = Math.abs(by - a.y);
                    ctx.fillStyle = rgba(RECT_COLOR, 0.08);
                    ctx.fillRect(x, y, w, h);
                    ctx.strokeStyle = rgba(RECT_COLOR, 0.5);
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 4]);
                    ctx.strokeRect(x, y, w, h);
                    ctx.setLineDash([]);
                }
            } else if (currentLine.type === 'fib') {
                // fib fan preview: base + rays from anchor to cursor
                const preview = { time1: currentLine.time1, price1: currentLine.price1, time2: timeAt(cursorPos.x), price2: priceAt(cursorPos.y, range) };
                drawFibFan(ctx, preview, range, true);
            } else {
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
        }
        ctx.restore();
    }

    function renderSegment(ctx, line, range) {
        const a = endPoint(line, 1, range);
        const b = endPoint(line, 2, range);
        if (!a || !b) return;
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

    function renderHLine(ctx, line, range) {
        if (line.price < range.min || line.price > range.max) return; // off-screen
        const y = api.yForPrice(line.price, range);
        const edges = api.chartEdges();
        const active = hoverLineId === line.id || dragLineId === line.id;

        // full-width solid line, slightly subtler than segments
        ctx.strokeStyle = rgba(HLINE_COLOR, active ? 0.95 : 0.55);
        ctx.lineWidth = active ? 1.4 : 1;
        ctx.setLineDash(active ? [] : [6, 4]);
        ctx.beginPath();
        ctx.moveTo(edges.left, y);
        ctx.lineTo(edges.right, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // price pill on the right axis (like the last-price label)
        const text = api.formatPrice(line.price);
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textBaseline = 'middle';
        const textW = ctx.measureText(text).width;
        const padX = 5;
        const boxX = edges.right + 1;
        const boxW = textW + padX * 2;
        ctx.fillStyle = rgba(HLINE_COLOR, active ? 0.95 : 0.75);
        ctx.fillRect(boxX, y - 7, boxW, 14);
        ctx.fillStyle = '#0a0e1a';
        ctx.textAlign = 'left';
        ctx.fillText(text, boxX + padX, y + 0.5);
        ctx.textBaseline = 'alphabetic';

        // drag handle dot on the line (visible on hover/drag)
        if (active) {
            drawHandle(ctx, edges.left + 14, y);
        }
    }

    function renderRect(ctx, line, range) {
        const a = endPoint(line, 1, range);
        const b = endPoint(line, 2, range);
        if (!a || !b) return;
        const active = hoverLineId === line.id || dragLineId === line.id;

        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
        if (w < 1 || h < 1) return;

        // faint fill + amber border
        ctx.fillStyle = rgba(RECT_COLOR, active ? 0.14 : 0.07);
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = rgba(RECT_COLOR, active ? 0.95 : 0.6);
        ctx.lineWidth = active ? 1.4 : LINE_WIDTH;
        ctx.setLineDash(active ? [] : [6, 4]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);

        // corner handles — only when active (SUBTLE)
        if (active) {
            drawHandle(ctx, a.x, a.y);
            drawHandle(ctx, b.x, b.y);
            drawHandle(ctx, a.x, b.y);
            drawHandle(ctx, b.x, a.y);
        }
    }

    /* Fib fan: base trendline A→B; rays from A through the fib retracement
     * levels of the AB move, extended to the right chart edge. */
    function drawFibFan(ctx, line, range, preview) {
        const a = endPoint(line, 1, range);
        const b = endPoint(line, 2, range);
        if (!a || !b) return;
        const edges = api.chartEdges();

        // base line (dashed, subdued)
        ctx.strokeStyle = rgba(FIB_COLOR, preview ? 0.4 : 0.45);
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // rays from A through fib levels of AB, to the right edge
        const endX = edges.right + 2;
        for (const lvl of FIB_LEVELS) {
            // point on AB at fraction lvl (from B back toward A):
            //   full fib retracement means price returns to A's level at 100%,
            //   so the ray target is A.y + (B.y - A.y) * (1 - lvl) → but that
            //   collapses; standard fan: target = B.y + (A.y - B.y) * lvl,
            //   i.e. lvl-share of the way back from B to A, at B.x.
            const ty = b.y + (a.y - b.y) * lvl;
            ctx.strokeStyle = rgba(FIB_COLOR, preview ? 0.35 : 0.5);
            ctx.lineWidth = lvl === 0.618 ? 1.2 : 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(endX, a.y + (ty - a.y) * ((endX - a.x) / Math.max(b.x - a.x, 1)));
            ctx.stroke();
        }

        // tiny level label at each ray end (SUBTLE)
        if (!preview) {
            ctx.font = '9px JetBrains Mono, monospace';
            ctx.fillStyle = rgba(FIB_COLOR, 0.7);
            ctx.textAlign = 'right';
            for (const lvl of FIB_LEVELS) {
                const ty = b.y + (a.y - b.y) * lvl;
                const ex = endX;
                const ey = a.y + (ty - a.y) * ((ex - a.x) / Math.max(b.x - a.x, 1));
                ctx.fillText(lvl.toFixed(3).slice(1), ex - 4, ey - 3);
            }
            ctx.textAlign = 'left';
        }
    }

    function renderFib(ctx, line, range) {
        const active = hoverLineId === line.id || dragLineId === line.id;
        drawFibFan(ctx, line, range, false);
        // handles on A and B — only when active (SUBTLE)
        if (active) {
            const a = endPoint(line, 1, range);
            const b = endPoint(line, 2, range);
            if (a && b) {
                drawHandle(ctx, a.x, a.y);
                drawHandle(ctx, b.x, b.y);
            }
        }
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

        // Edit existing: handles or body of a hovered object
        const hit = hitTest(pos, range);
        if (hit) {
            dragLineId = hit.id;
            if (hit.obj.type === 'hline') {
                // whole-line vertical move: keep the price offset from cursor
                dragOffset = {
                    handle: 0,
                    dPrice1: hit.obj.price - priceAt(pos.y, range)
                };
            } else if (hit.handle) {
                dragOffset = { handle: hit.handle };
            } else {
                // whole-line move: keep offsets from cursor
                dragOffset = {
                    handle: 0,
                    dTime1: hit.obj.time1 - timeAt(pos.x),
                    dPrice1: hit.obj.price1 - priceAt(pos.y, range),
                    dTime2: hit.obj.time2 - timeAt(pos.x),
                    dPrice2: hit.obj.price2 - priceAt(pos.y, range)
                };
            }
            return true;
        }

        // Start a new object
        drawing = true;
        if (tool === 'hline') {
            currentLine = {
                type: 'hline',
                price: priceAt(pos.y, range)
            };
        } else if (tool === 'rect' || tool === 'fib') {
            currentLine = {
                type: tool,
                time1: timeAt(pos.x),
                price1: priceAt(pos.y, range),
                time2: null,
                price2: null
            };
        } else {
            currentLine = {
                time1: timeAt(pos.x),
                price1: priceAt(pos.y, range),
                time2: null,
                price2: null
            };
        }
        return true;
    }

    function onMouseMove(pos, range) {
        cursorPos = pos;
        if (tool === 'off' || !api) return false;

        if (drawing) return true;   // consume: no pan while drawing

        if (dragLineId != null) {
            const line = lines.find(l => l.id === dragLineId);
            if (line) {
                if (line.type === 'hline') {
                    line.price = priceAt(pos.y, range) + dragOffset.dPrice1;
                } else if (dragOffset.handle === 0) {
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
                if (currentLine.type === 'hline') {
                    // final price = wherever the cursor ended up
                    currentLine.price = priceAt(pos.y, range);
                    currentLine.id = 'H' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                    lines.push(currentLine);
                    save();
                } else {
                    currentLine.time2 = timeAt(pos.x);
                    currentLine.price2 = priceAt(pos.y, range);
                    // keep only if it is a real shape, not a stray click
                    const dx = Math.abs(currentLine.time2 - currentLine.time1);
                    const dy = Math.abs(currentLine.price2 - currentLine.price1);
                    if (dx > 0 || dy > 0) {
                        const prefix = currentLine.type === 'rect' ? 'R' : currentLine.type === 'fib' ? 'F' : 'L';
                        currentLine.id = prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                        lines.push(currentLine);
                        save();
                    }
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

    /* hit test; returns {id, handle (1|2|0), obj} or null */
    function hitTest(pos, range) {
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (line.type === 'hline') {
                if (line.price < range.min || line.price > range.max) continue;
                const y = api.yForPrice(line.price, range);
                if (Math.abs(pos.y - y) <= 5) return { id: line.id, handle: 0, obj: line };
                continue;
            }
            const a = endPoint(line, 1, range);
            const b = endPoint(line, 2, range);
            if (!a || !b) continue;
            if (line.type === 'rect') {
                // corners (diagonal pair 1/2 drags the whole rect shape)
                if (dist(pos, a) <= 7) return { id: line.id, handle: 1, obj: line };
                if (dist(pos, b) <= 7) return { id: line.id, handle: 2, obj: line };
                // edges or body → move whole rect
                const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
                const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
                const nearEdge =
                    pos.x >= x0 - 5 && pos.x <= x1 + 5 &&
                    pos.y >= y0 - 5 && pos.y <= y1 + 5;
                if (nearEdge) return { id: line.id, handle: 0, obj: line };
                continue;
            }
            if (dist(pos, a) <= 7) return { id: line.id, handle: 1, obj: line };
            if (dist(pos, b) <= 7) return { id: line.id, handle: 2, obj: line };
            if (pointNearLine(pos, a, b, 6)) return { id: line.id, handle: 0, obj: line };
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
        getTool, getLineCount, getObjects, setObjects,
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
