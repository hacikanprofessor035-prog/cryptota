/* Keyboard shortcuts.
 *
 * Design: a single document-level keydown listener that ignores events while
 * the user is typing in an input/textarea/contenteditable or while a modal
 * is open. Shortcuts are grouped: navigation (pairs/TF), panels, drawing,
 * tools. A "?" cheat-sheet popover shows the full list.
 *
 * Shortcuts:
 *   1..6          timeframe 1m/15m/1h/4h/1d/1w
 *   B / E         switch to BTC / ETH (quick pair jump)
 *   /             focus the pair search box
 *   S             technical summary panel
 *   H             market heatmap
 *   D             order book (depth)
 *   M             multi-timeframe panel
 *   R             risk calculator
 *   T             cycle light/dark theme
 *   P             download chart PNG
 *   A             alerts panel
 *   G             toggle drawing mode (last used tool)
 *   Esc           close panels / cancel
 *   ?             shortcut cheat-sheet
 */
window.Hotkeys = (() => {
    const TF_SLOTS = ['1m', '15m', '1h', '4h', '1d', '1w'];
    let sheetEl = null, buttonEl = null;
    let bound = false;

    const SHORTCUTS = [
        ['1 – 6', 'Timeframe 1m / 15m / 1h / 4h / 1d / 1w'],
        ['B / E', 'Switch to BTCUSDT / ETHUSDT'],
        ['/', 'Focus pair search'],
        ['A', 'Price alerts'],
        ['S', 'Technical summary'],
        ['H', 'Market heatmap'],
        ['D', 'Order book'],
        ['M', 'Multi-timeframe'],
        ['R', 'Risk calculator'],
        ['G', 'Toggle drawing mode'],
        ['T', 'Light / dark theme'],
        ['P', 'Save chart as PNG'],
        ['Esc', 'Close panels / cancel'],
    ];

    function typing(e) {
        const t = e.target;
        if (!t) return false;
        const tag = (t.tagName || '').toLowerCase();
        // synthetic events (target == document) fall back to activeElement
        const real = (t === document || t === document.body) ? document.activeElement : t;
        if (!real) return false;
        const rtag = (real.tagName || '').toLowerCase();
        if (rtag === 'input' || rtag === 'textarea' || rtag === 'select') return true;
        if (real.isContentEditable) return true;
        return false;
    }

    function modalOpen() {
        // any visible overlay counts as modal context
        const m = document.getElementById('indicatorModal');
        if (m && m.style.display !== 'none') return true;
        const s = document.getElementById('strategyModal');
        if (s && s.style.display !== 'none') return true;
        if (document.getElementById('heatmapModal')?.style.display === 'flex') return true;
        return false;
    }

    function closeAllPanels() {
        const ids = ['summaryPanel', 'bookPanel', 'mtfPanel', 'riskPanel'];
        let closed = false;
        for (const id of ids) {
            const el = document.getElementById(id);
            if (el && el.style.display !== 'none') { el.style.display = 'none'; closed = true; }
        }
        // mirror the toggle buttons' active state
        ['summaryButton', 'bookButton', 'mtfButton', 'riskButton'].forEach(id => {
            document.getElementById(id)?.classList.remove('active');
        });
        return closed;
    }

    function onKeydown(e) {
        if (typing(e)) {
            if (e.key === 'Escape') {
                const si = document.getElementById('searchInput');
                if (si) { si.value = ''; si.dispatchEvent(new Event('input', { bubbles: true })); si.blur(); }
            }
            return;
        }

        const k = e.key.toLowerCase();

        // Timeframes 1-6
        const slot = parseInt(e.key, 10);
        if (slot >= 1 && slot <= 6 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const tf = TF_SLOTS[slot - 1];
            const btn = document.querySelector(`.tf-btn[data-tf="${tf}"]`);
            if (btn) { e.preventDefault(); btn.click(); return; }
        }

        // Single-char shortcuts (ignore with modifiers — leave those to the browser)
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        switch (k) {
            case 'escape':
                if (closeAllPanels()) { e.preventDefault(); return; }
                hideSheet();
                return;
            case '?':
                e.preventDefault();
                toggleSheet();
                return;
            case 'b':
                e.preventDefault();
                document.querySelector('.pair-row[data-symbol="BTCUSDT"]')?.click();
                return;
            case 'e':
                e.preventDefault();
                document.querySelector('.pair-row[data-symbol="ETHUSDT"]')?.click();
                return;
            case '/':
                e.preventDefault();
                document.getElementById('searchInput')?.focus();
                return;
            case 's':
                e.preventDefault();
                document.getElementById('summaryButton')?.click();
                return;
            case 'h':
                e.preventDefault();
                document.getElementById('heatmapButton')?.click();
                return;
            case 'd':
                e.preventDefault();
                document.getElementById('bookButton')?.click();
                return;
            case 'm':
                e.preventDefault();
                document.getElementById('mtfButton')?.click();
                return;
            case 'r':
                e.preventDefault();
                document.getElementById('riskButton')?.click();
                return;
            case 'a':
                e.preventDefault();
                document.getElementById('alertsBell')?.click();
                return;
            case 'p':
                e.preventDefault();
                document.getElementById('screenshotButton')?.click();
                return;
            case 't':
                e.preventDefault();
                window.Theme && window.Theme.toggle ? window.Theme.toggle()
                    : document.documentElement.classList.toggle('theme-light');
                return;
            case 'g':
                e.preventDefault();
                document.getElementById('drawToggle')?.click();
                return;
        }
    }

    /* ---------- cheat sheet ---------- */
    function toggleSheet() {
        if (!sheetEl) buildSheet();
        const open = sheetEl.style.display !== 'none';
        if (open) hideSheet();
        else {
            sheetEl.style.display = 'block';
            sheetEl.animate?.([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1 }], { duration: 120 });
        }
    }
    function hideSheet() { if (sheetEl) sheetEl.style.display = 'none'; }

    function buildSheet() {
        sheetEl = document.createElement('div');
        sheetEl.id = 'hotkeySheet';
        sheetEl.className = 'hotkey-sheet';
        sheetEl.style.display = 'none';
        sheetEl.innerHTML = `
            <div class="hk-title">Keyboard shortcuts <span class="hk-hint">press ? again to close</span></div>
            ${SHORTCUTS.map(([key, desc]) => `
                <div class="hk-row"><kbd>${key}</kbd><span>${desc}</span></div>`).join('')}
            <div class="hk-foot">Shortcuts are ignored while typing in inputs.</div>`;
        document.body.appendChild(sheetEl);
        sheetEl.addEventListener('click', e => { if (e.target === sheetEl) hideSheet(); });
    }

    function init() {
        if (bound) return;
        bound = true;
        document.addEventListener('keydown', onKeydown);
    }

    return { init, toggleSheet, hideSheet };
})();
