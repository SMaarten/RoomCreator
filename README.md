# RoomKreator

Richt een kamer in met IKEA-meubels die echt passen. Je uploadt foto's,
geeft de maten, deuren en ramen op, en krijgt een ontwerp op schaal met een
boodschappenlijst van IKEA België, binnen je budget.

**Live:** https://smaarten.github.io/RoomCreator/

## Hoe het werkt

1. **Foto's**: tot zes foto's van de kamer, verkleind in de browser.
2. **Afmetingen**: breedte, diepte en hoogte, plus deuren, ramen, radiatoren
   en doorgangen per wand. De plattegrond tekent live mee.
3. **Wat staat er nu**: Claude bekijkt de foto's en lijst de bestaande meubels
   op. Per stuk kies je *houden* of *vervangen*.
4. **Wensen**: gebruik van de kamer, stijl, budget en vrije opmerkingen.
5. **Ontwerp**: Claude zoekt zelf in de actuele IKEA-catalogus (be/nl),
   controleert afmetingen en budget, en plaatst alles op de plattegrond.
   Daarna kan je bijsturen in gewone taal ("goedkopere zetel", "meer
   opbergruimte") en optioneel een fotorealistische impressie laten maken
   met Gemini.

```
Browser ──foto's + maten──▶ Claude (claude-opus-5-5, vision + tool use)
                               │  search_ikea("zitbank 3-zits")
                               ▼
                         IKEA zoek-API (be/nl, echte prijzen en maten)
                               │
                               ▼
              JSON-ontwerp ──▶ plattegrond op schaal + productlijst
                               └──▶ Gemini (optioneel) → "na"-foto
```

Verder:

- **Projecten** met een eigen naam, automatisch bewaard in de browser. Openen,
  hernoemen, kopiëren, verwijderen, en exporteren/importeren als bestand.
- **Alternatieven**: per artikel 1–2 andere producten die ook passen; één klik
  wisselt. Artikelen die je al hebt haal je weg met *Niet nodig*.
- **Boodschappenlijst** met links, artikelnummers, totaal en een ophaalroute
  (Markthal-afdeling of gang/vak in het zelfbedieningsmagazijn, met
  voorraad) voor de gekozen winkel. Export als CSV of PDF.
- **Taal**: Nederlands, Frans of Engels, ook voor de teksten van Claude.
- **Dichtstbijzijnde IKEA** via je locatie of uit de lijst (België, Nederland,
  Frankrijk, Duitsland). De winkel bepaalt van welke IKEA-site producten en
  prijzen komen, in jouw taal als die site ze aanbiedt, anders Engels of de
  landstaal.
- **Onregelmatige kamers** (L-vorm, nis, schuine wand) en deuren met
  scharnierkant en draairichting.

Waarborgen:

- Claude mag enkel producten kiezen die uit een IKEA-zoekopdracht kwamen.
  Naam, prijs, foto en link komen uit IKEA's data, niet uit de tekst van het
  model; verzonnen artikelnummers worden weggelaten en gemeld.
- Een lay-outcontrole markeert meubels die buiten de kamer vallen, elkaar
  overlappen of in de draaicirkel van een deur staan.

## Sleutels en kosten

De app is een statische site zonder server. Je vult je eigen sleutels in bij
**Instellingen**; ze worden alleen in je browser bewaard (IndexedDB) en gaan
rechtstreeks naar Anthropic en Google.

| Sleutel | Nodig | Waar |
| --- | --- | --- |
| Anthropic API | ja | https://console.anthropic.com/settings/keys |
| Gemini API | nee, enkel voor de "na"-foto | https://aistudio.google.com/apikey |

Een volledig ontwerp kost doorgaans enkele tientallen eurocent aan
Anthropic-tegoed (foto's + een tiental zoekopdrachten).

## Verbruik en kosten

`admin.html` (op de site: https://smaarten.github.io/RoomCreator/admin.html, of
via *Instellingen → Verbruik en kosten bekijken*) toont wat de app in deze
browser verbruikt heeft: kost per dag, maand en project, gemiddelde kost per
ontwerp, cachegebruik en elke oproep met haar tokens. De kost wordt berekend
uit de tokens die de API teruggeeft en een aanpasbare tarieventabel. De
officiële cijfers staan bij [Anthropic](https://platform.claude.com/cost) en
[Google AI Studio](https://aistudio.google.com/spend).

## Lokaal draaien

```bash
npm install
npm run dev     # http://localhost:5173/RoomCreator/
npm run build   # typecheck + productiebuild in dist/
```

De winkellijst (met coördinaten) staat in `src/data/stores.json`. IKEA's
winkel-API laat geen oproepen vanuit de browser toe, dus de lijst zit in de
app. Vernieuwen met `npm run update-stores`.

## Publiceren

Elke push naar `main` bouwt de site en zet ze op GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Eenmalig:
*Settings → Pages → Source: GitHub Actions*.

## Gedeelde toegang (proxy)

Standaard vult elke bezoeker zijn eigen sleutels in. Wil je dat bezoekers
zonder sleutel kunnen werken, dan zet je de proxy in [`proxy/`](proxy/) op
Cloudflare Workers (gratis plan volstaat). Die bewaart jouw sleutels als
geheimen en stuurt alleen de oproepen door die de app doet.

```
Browser ──zonder eigen sleutel──▶ Worker (jouw sleutels) ──▶ Anthropic / Google
Browser ──met eigen sleutel─────────────────────────────────▶ Anthropic / Google
```

Beveiliging, in te stellen in [`proxy/wrangler.toml`](proxy/wrangler.toml):

- alleen verzoeken van `ALLOWED_ORIGINS` (je GitHub Pages-adres en localhost);
- alleen de modellen in `CLAUDE_MODELS` en `GEMINI_MODELS`;
- daglimieten per bezoeker en in totaal (een ontwerp is ongeveer 10–25
  Claude-verzoeken, een impressie 1–2 Gemini-verzoeken);
- optioneel een toegangscode die bezoekers invullen bij *Instellingen*.

Stel daarnaast een uitgavenlimiet in bij
[Anthropic](https://console.anthropic.com/settings/limits) en
[Google](https://aistudio.google.com/spend). Dat is de enige harde grens op
wat de proxy je kan kosten.

Eenmalig opzetten:

```bash
cd proxy
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GEMINI_API_KEY      # weglaten = geen gedeelde impressies
npx wrangler secret put ACCESS_CODE         # optioneel
npm run deploy                              # toont https://roomkreator-proxy.<jij>.workers.dev
```

Zet dat adres daarna in GitHub als repository-variabele `PROXY_URL`
(*Settings → Secrets and variables → Actions → Variables*) en push opnieuw.
Zonder die variabele werkt de site zoals voordien, met eigen sleutels.

Lokaal testen: zet de sleutels in `proxy/.dev.vars` (`ANTHROPIC_API_KEY=…`),
start `npm run dev` in `proxy/`, en start de site met
`VITE_PROXY_URL=http://localhost:8787 npm run dev`.

## Code

| Bestand | Rol |
| --- | --- |
| [`src/lib/claude.ts`](src/lib/claude.ts) | Foto-analyse en de ontwerp-lus met de `search_ikea`-tool |
| [`src/lib/ikea.ts`](src/lib/ikea.ts) | IKEA België zoek-API |
| [`src/lib/gemini.ts`](src/lib/gemini.ts) | "Na"-foto via Gemini-beeldbewerking |
| [`src/lib/layout.ts`](src/lib/layout.ts) | Lay-outcontrole (buiten de kamer, overlap, deuren) |
| [`src/components/FloorPlan.tsx`](src/components/FloorPlan.tsx) | Plattegrond op schaal (SVG) |
| [`src/lib/stock.ts`](src/lib/stock.ts) | Voorraad en ophaallocaties per winkel |
| [`src/lib/locale.ts`](src/lib/locale.ts) | Winkels, dichtstbijzijnde winkel, IKEA-site en taal |
| [`src/lib/projects.ts`](src/lib/projects.ts) | Projecten bewaren, openen, export/import |
| [`src/lib/i18n.ts`](src/lib/i18n.ts) | Vertalingen NL/FR/EN |
| [`src/lib/usage.ts`](src/lib/usage.ts) | Verbruikslogboek en kostberekening |
| [`src/admin/Admin.tsx`](src/admin/Admin.tsx) | Verbruikspagina (admin.html) |
| [`src/lib/proxy.ts`](src/lib/proxy.ts) | Gedeelde toegang via de proxy |
| [`proxy/src/index.ts`](proxy/src/index.ts) | De proxy zelf (Cloudflare Worker) |
| [`src/App.tsx`](src/App.tsx) | Stappen, status en opslag |

Vite + React + TypeScript, `@anthropic-ai/sdk` in de browser.
