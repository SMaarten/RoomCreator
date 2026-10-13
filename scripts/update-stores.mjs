// Downloads the IKEA store list (with coordinates) for the supported
// countries and writes src/data/stores.json. IKEA's store endpoint does not
// allow browser requests, so the list is baked into the app.
// Run with: npm run update-stores
import { writeFile } from "node:fs/promises";

const COUNTRIES = { be: "nl", nl: "nl", fr: "fr", de: "de" };

const stores = [];
for (const [cc, lang] of Object.entries(COUNTRIES)) {
  const res = await fetch(`https://www.ikea.com/${cc}/${lang}/meta-data/informera/stores-detailed.json`);
  if (!res.ok) throw new Error(`${cc}: HTTP ${res.status}`);
  for (const s of await res.json()) {
    if (!s.lat || !s.lng || s.homeShoppingUnit) continue;
    stores.push({
      id: String(s.id),
      country: cc,
      name: s.displayNameAlternate || s.displayName || s.name,
      city: s.address?.city ?? "",
      lat: Number(s.lat),
      lng: Number(s.lng),
    });
  }
}
stores.sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
await writeFile(new URL("../src/data/stores.json", import.meta.url), JSON.stringify(stores, null, 1) + "\n");
console.log(`${stores.length} stores written`);
