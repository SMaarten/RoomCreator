# RoomCreator

Take or upload a photo of a room, pick a decorating style, and get IKEA
furnishing recommendations tailored to your space. Room analysis is done by
Claude vision; product data comes from a [parse.bot](https://parse.bot) IKEA
API (with a built-in mock catalog so the app works before you connect one).

## How it works

1. You upload/snap a room photo and choose a style (Scandinavian, Japandi, …).
2. The photo + style go to `POST /api/design`.
3. Claude (`claude-opus-4-8`, vision + structured outputs) reads the room —
   room type, palette, existing pieces — and proposes 5–8 IKEA items with a
   generic search term and a one-line rationale each.
4. Each search term is looked up against your parse.bot IKEA API.
5. The client renders a design board: room analysis, recommended pieces with
   matching products, and an estimated total.

```
Browser ──photo+style──▶ /api/design ──▶ lib/anthropic (Claude vision)
                                     └──▶ lib/ikea (parse.bot or mock)
```

## Setup

```bash
npm install
cp .env.example .env
# fill in ANTHROPIC_API_KEY (required) and parse.bot details (optional)
npm run dev
```

Open http://localhost:3000.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | Claude vision room analysis |
| `PARSE_BOT_API_KEY` | no | parse.bot key (`pmx_…`); omit to use mock IKEA data |
| `PARSE_BOT_SCRAPER_ID` | no | Your parse.bot scraper id |
| `PARSE_BOT_SEARCH_ENDPOINT` | no | Search endpoint name (default `search_products`) |
| `PARSE_BOT_QUERY_PARAM` | no | JSON field your endpoint expects the term in (default `query`) |

Without parse.bot credentials the app runs fully on a curated mock catalog and
shows a "sample products" banner.

## Connecting parse.bot

1. At [parse.bot](https://parse.bot), build an API over IKEA's product search —
   one endpoint that takes a search term and returns product rows.
2. Note the scraper id, endpoint name, and your `pmx_` key; put them in `.env`.
3. The endpoint is called as:
   `POST https://api.parse.bot/scraper/{SCRAPER_ID}/{ENDPOINT}` with header
   `X-API-Key` and body `{ "<query param>": "<search term>" }`.
4. parse.bot response fields are mapped to products in
   [`lib/ikea.ts`](lib/ikea.ts) → `normalizeProducts`. It tries common field
   names (`name`/`title`, `price`, `image`/`imageUrl`, `url`/`link`); tweak it
   to match your endpoint's exact output.

## Tech

- Next.js 15 (App Router) + TypeScript
- `@anthropic-ai/sdk` — Claude vision, adaptive thinking, structured outputs
- API keys stay server-side in the route handler; nothing secret reaches the browser.
