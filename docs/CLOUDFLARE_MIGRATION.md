# CryptoTA → Cloudflare Pages Migration

## Step 1 — Cloudflare account
If you don't have one: https://dash.cloudflare.com/sign-up (free tier, no card).

## Step 2 — Connect GitHub repo
1. https://dash.cloudflare.com/ → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
2. Select `hacikanprofessor035-prog/cryptota`
3. **Build settings**:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `/` (project root — `wrangler.toml` has `pages_build_output_dir = "."`)
4. Click **Save and Deploy**

The first deploy will start automatically. Within ~2 minutes you'll get a URL like:
`https://cryptota.pages.dev`

## Step 3 — Verify volumes appear
Open `https://cryptota.pages.dev` — the sidebar should show:
- New "24h Vol" column header
- Compact volume like `1.23B`, `45.6M` next to each pair
- Subtle horizontal bar (faint up-tint for green change, faint down-tint for red, gray for flat)

## Step 4 — Set up the API tunnel (optional but recommended)
The static site works without API (UI loads, prices stream, charts work — Binance APIs are public).
For auth/payments/admin to work, we need the Cloudflare Tunnel:

### 4a — Install cloudflared on VPS
```bash
ssh tofo@185.192.22.193
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
cloudflared --version
```

### 4b — Login and create tunnel
```bash
cloudflared tunnel login      # opens browser, pick your domain (or add one free)
cloudflared tunnel create cryptota-api
cloudflared tunnel route dns cryptota-api cryptota-api.YOUR-DOMAIN.com
```

### 4c — Configure tunnel
```bash
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml <<EOF
tunnel: cryptota-api
credentials-file: /home/tofo/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: cryptota-api.YOUR-DOMAIN.com
    service: http://localhost:3000
  - service: http_status:404
EOF
```

### 4d — Run as systemd service
```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
sudo systemctl status cloudflared
```

### 4e — Update js/config.js apiBase
Edit `js/config.js`, change:
```js
apiBase: '',
```
to:
```js
apiBase: 'https://cryptota-api.YOUR-DOMAIN.com',
```

Commit & push → Cloudflare Pages auto-redeploys in ~30 sec.

## Cost
- Cloudflare Pages: **$0** (500k requests/day free)
- Cloudflare Tunnel: **$0** (unlimited)
- VPS stays as-is (no Nginx/Caddy changes, no certs needed — tunnel handles TLS)