# CryptoTA

**Бесплатный терминал крипто-теханализа в браузере — без регистрации.**

[cryptota.duckdns.org](https://cryptota.duckdns.org)

Открыл ссылку — сразу график. Никаких аккаунтов, подписок и установки: свечи Binance, 16 индикаторов, 6 готовых стратегий с бэктестом, рисование мышкой, скриншоты одним кликом. Работает на телефоне (PWA).

## Возможности

- **Свечные графики** всех пар Binance, все таймфреймы, pinch-zoom на мобильных
- **16 индикаторов**: RSI, MACD, EMA, SMA, Bollinger Bands, Ichimoku, ATR, Stochastic, Awesome Oscillator, OBV и др.
- **6 стратегий с бэктестом прямо на графике**: EMA Cross, RSI Divergence, MACD Cross, BB Squeeze, Mean Reversion, Supertrend+RSI
- **Инструменты рисования**: трендовые линии, прямоугольники, горизонтальные уровни, Fibonacci fan
- **Watchlist** до 10 пар
- **Скриншот одним кликом** — тёмная карточка с водяным знаком и ссылкой на пару
- **Шеринг настройки графика ссылкой** `#/SYMBOL/TF` — отправь другому трейдеру свой разбор
- **Тёмная тема** (акцент `#5cc8c0`), полностью на русском и английском
- **PWA** — можно установить как приложение на телефон

## Ценообразование

Все индикаторы и стратегии — **бесплатно**. Опциональная Pro-лицензия расширяет возможности; оплата в TON. Подробности — в приложении.

## Технологии

- **Фронтенд**: vanilla JS + Canvas 2D (без фреймворков — весь терминал весит килобайты, а не мегабайты)
- **Бэкенд**: Node.js + Express + SQLite
- **Инфраструктура**: VPS за Caddy (HTTPS, same-origin API), CF Pages — CDN-зеркало
- **Платежи**: TON blockchain

```
Фронтенд:  index.html + js/ + css/      (статика, чистый vanilla JS)
Бэкенд:    server/src/                  (Express + SQLite)
Деплой:    файлы в git на VPS + Caddy
```

## Запуск локально

```bash
git clone https://github.com/hacikanprofessor035-prog/cryptota.git
cd cryptota
python3 dev-server.py        # фронтенд на :8000
cd server && npm ci && npm start   # API на :3001
```

## Структура

```
├── index.html          # SPA-точка входа
├── js/                 # фронтенд-модули (app, chart, drawing, indicators...)
├── css/
├── server/             # Express-бэкенд
│   ├── src/
│   │   ├── routes/     # auth, payments, admin, password-reset
│   │   ├── lib/        # db, rate-limit
│   │   └── admin.html  # операторская панель /admin
│   └── test/           # 36 integration-тестов
├── docs/               # BILLING.md, CLOUDFLARE_MIGRATION.md
└── og-image.png        # социальная карточка
```

## Тесты

```bash
cd server && npm test   # 36/36
```

## Лицензия

MIT
