/* Light / dark theme switch.
 *
 * Approach: all UI colors are CSS custom properties on :root, so a light
 * theme is just an override block scoped to html.theme-light. The chart is
 * canvas-based and reads its own palette from ChartEngine — we expose
 * Theme.getColors() and patch ChartEngine's COLORS on toggle, then ask for
 * a repaint. Preference persists in localStorage and respects the
 * OS-level prefers-color-scheme on first visit.
 */
window.Theme = (() => {
    const LS_KEY = 'cryptota.theme';
    let current = 'dark';

    const DARK = {
        bg0: '#0a0e1a', bg1: '#11151f', bg2: '#181d2a', bg3: '#1f2533',
        bgHover: '#252b3b',
        text0: '#e8ecf4', text1: '#9ba4b8', text2: '#6b7488', textDim: '#4a5167',
        line: 'rgba(255,255,255,0.06)', lineStrong: 'rgba(255,255,255,0.10)',
        up: '#16c784', down: '#ea3943',
        // chart engine palette
        chart: {
            up: '#16c784', down: '#ea3943', wickUp: '#16c784', wickDown: '#ea3943',
            grid: 'rgba(255,255,255,0.04)', gridStrong: 'rgba(255,255,255,0.08)',
            text: '#9ba4b8', textDim: '#6b7488', textBright: '#e8ecf4',
            bg: '#0a0e1a',
            volUp: 'rgba(22,199,132,0.45)', volDown: 'rgba(234,57,67,0.45)',
            crosshair: 'rgba(255,255,255,0.25)', lastPrice: 'rgba(92,200,192,0.85)',
            paneBg: 'rgba(255,255,255,0.02)'
        }
    };

    const LIGHT = {
        bg0: '#f7f9fc', bg1: '#ffffff', bg2: '#f0f3f8', bg3: '#e6eaf2',
        bgHover: '#dde3ec',
        text0: '#141a26', text1: '#4a5568', text2: '#77839a', textDim: '#9aa5b8',
        line: 'rgba(20,26,38,0.08)', lineStrong: 'rgba(20,26,38,0.14)',
        up: '#0e9f6e', down: '#d62839',
        chart: {
            up: '#0e9f6e', down: '#d62839', wickUp: '#0e9f6e', wickDown: '#d62839',
            grid: 'rgba(20,26,38,0.06)', gridStrong: 'rgba(20,26,38,0.12)',
            text: '#5a6472', textDim: '#8a94a3', textBright: '#141a26',
            bg: '#ffffff',
            volUp: 'rgba(14,159,110,0.30)', volDown: 'rgba(214,40,57,0.28)',
            crosshair: 'rgba(20,26,38,0.35)', lastPrice: 'rgba(14,120,115,0.9)',
            paneBg: 'rgba(20,26,38,0.025)'
        }
    };

    function load() {
        try { current = localStorage.getItem(LS_KEY) || 'dark'; }
        catch (_) { current = 'dark'; }
        if (current !== 'dark' && current !== 'light') {
            current = (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches)
                ? 'light' : 'dark';
        }
    }

    function persist() {
        try { localStorage.setItem(LS_KEY, current); } catch (_) {}
    }

    /* Apply CSS variables for the active palette. */
    function applyCss() {
        const p = current === 'light' ? LIGHT : DARK;
        const r = document.documentElement;
        r.style.setProperty('--bg-0', p.bg0);
        r.style.setProperty('--bg-1', p.bg1);
        r.style.setProperty('--bg-2', p.bg2);
        r.style.setProperty('--bg-3', p.bg3);
        r.style.setProperty('--bg-hover', p.bgHover);
        r.style.setProperty('--text-0', p.text0);
        r.style.setProperty('--text-1', p.text1);
        r.style.setProperty('--text-2', p.text2);
        r.style.setProperty('--text-dim', p.textDim);
        r.style.setProperty('--up', p.up);
        r.style.setProperty('--down', p.down);
        r.style.setProperty('--line', p.line);
        r.style.setProperty('--line-strong', p.lineStrong);
        r.classList.toggle('theme-light', current === 'light');
    }

    /* Patch the chart engine's color constants and repaint. */
    function applyChart() {
        const p = (current === 'light' ? LIGHT : DARK).chart;
        const ce = window.ChartEngine;
        if (!ce || !ce.setColors) return;
        ce.setColors(p);
        if (ce.render) ce.render();
    }

    /* Keep the topbar button icon in sync, no matter what changed the theme. */
    function syncButton() {
        const b = document.getElementById('themeButton');
        if (b) b.innerHTML = current === 'light' ? '☀' : '☾';
    }

    function applyAll() {
        applyCss();
        applyChart();
        syncButton();
    }

    function toggle() {
        current = current === 'light' ? 'dark' : 'light';
        persist();
        applyAll();
        if (window.appShowToast) appShowToast(current === 'light' ? 'Light theme' : 'Dark theme', 1400);
    }

    function set(v) {
        if (v !== 'light' && v !== 'dark') return;
        if (v === current) return;
        current = v; persist(); applyAll();
    }

    function get() { return current; }

    function init() {
        load();
        applyCss();      // CSS is instant; chart needs its DOM ready
        requestAnimationFrame(() => applyChart());
    }

    return { init, toggle, set, get, getColors: () => (current === 'light' ? LIGHT : DARK).chart };
})();
