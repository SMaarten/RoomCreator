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

## Lokaal draaien

```bash
npm install
npm run dev     # http://localhost:5173/RoomCreator/
npm run build   # typecheck + productiebuild in dist/
```

## Publiceren

Elke push naar `main` bouwt de site en zet ze op GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Eenmalig:
*Settings → Pages → Source: GitHub Actions*.

## Code

| Bestand | Rol |
| --- | --- |
| [`src/lib/claude.ts`](src/lib/claude.ts) | Foto-analyse en de ontwerp-lus met de `search_ikea`-tool |
| [`src/lib/ikea.ts`](src/lib/ikea.ts) | IKEA België zoek-API |
| [`src/lib/gemini.ts`](src/lib/gemini.ts) | "Na"-foto via Gemini-beeldbewerking |
| [`src/lib/layout.ts`](src/lib/layout.ts) | Lay-outcontrole (buiten de kamer, overlap, deuren) |
| [`src/components/FloorPlan.tsx`](src/components/FloorPlan.tsx) | Plattegrond op schaal (SVG) |
| [`src/App.tsx`](src/App.tsx) | Stappen, status en opslag |

Vite + React + TypeScript, `@anthropic-ai/sdk` in de browser.
