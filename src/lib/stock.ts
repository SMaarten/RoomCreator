// Stock and pick locations per IKEA store, from the same availability service
// ikea.com uses on its product pages. It is not an official public API: the
// client id below is the one embedded in ikea.com, and the response shape may
// change. Everything here degrades to "location unknown" rather than failing.

import { searchIkea } from "./ikea";

const AVAILABILITY_URL = "https://api.ingka.ikea.com/cia/availabilities/sto";
const CLIENT_ID = "b6c117e5-ae61-4ef5-b4cc-e0b1e37f0631";

export const BE_STORES = [
  { id: "482", name: "Anderlecht" },
  { id: "483", name: "Arlon" },
  { id: "169", name: "Gent" },
  { id: "452", name: "Hasselt" },
  { id: "375", name: "Liège" },
  { id: "423", name: "Mons" },
  { id: "179", name: "Wilrijk" },
  { id: "376", name: "Zaventem" },
];

export type Area = "markthal" | "zelfbediening" | "personeel" | "onbekend";

export interface PickLocation {
  area: Area;
  /** e.g. "Gang 12, vak 04" or "Textiel". */
  label: string;
  aisle?: string;
  bin?: string;
}

export interface PickPart {
  itemNo: string;
  name: string;
  location: PickLocation;
  stock: number | null;
}

export interface StockInfo {
  location: PickLocation;
  stock: number | null;
  /** Parts of a combination product, each with its own location. */
  parts: PickPart[];
}

const UNKNOWN: PickLocation = { area: "onbekend", label: "Locatie onbekend" };

function toLocation(locs: any[] | undefined): PickLocation {
  if (!Array.isArray(locs) || locs.length === 0) return UNKNOWN;
  const best = [...locs].sort((a, b) => (a.recommendationRank ?? 99) - (b.recommendationRank ?? 99))[0];
  if (best.type === "AISLE_AND_BIN" && best.aisleAndBin) {
    const { aisle, bin } = best.aisleAndBin;
    return { area: "zelfbediening", label: `Gang ${aisle}, vak ${bin}`, aisle, bin };
  }
  if (best.type === "DEPARTMENT") {
    const names: any[] = best.department?.names ?? [];
    const name = names.find((n) => n.languageCode === "nl")?.name ?? names[0]?.name ?? "Afdeling";
    return { area: best.division === "SELF_SERVE" ? "zelfbediening" : "markthal", label: name };
  }
  if (best.type === "CONTACT_STAFF") {
    return { area: "personeel", label: "Vraag het personeel (afhaling magazijn)" };
  }
  return UNKNOWN;
}

function quantity(av: any): number | null {
  const q = av?.buyingOption?.cashCarry?.availability?.quantity;
  return typeof q === "number" ? q : null;
}

/** Locations and stock for these articles in one store, keyed by itemNo. */
export async function fetchStock(storeId: string, itemNos: string[]): Promise<Record<string, StockInfo>> {
  if (itemNos.length === 0) return {};
  const url = `${AVAILABILITY_URL}/${storeId}?itemNos=${itemNos.join(",")}&expand=SalesLocations,ChildItems`;
  const res = await fetch(url, {
    headers: { "X-Client-ID": CLIENT_ID, Accept: "application/json;version=2" },
  });
  if (!res.ok) throw new Error(`IKEA-voorraad niet beschikbaar (${res.status})`);
  const data = await res.json();

  const stockByItem = new Map<string, number | null>();
  for (const av of data.availabilities ?? []) {
    stockByItem.set(av.itemKey?.itemNo, quantity(av));
    for (const child of av.childAvailabilities ?? []) stockByItem.set(child.itemKey?.itemNo, quantity(child));
  }

  const result: Record<string, StockInfo> = {};
  const childNos = new Set<string>();
  for (const entry of data.salesLocations ?? []) {
    const itemNo = entry.itemKey?.itemNo;
    if (!itemNo) continue;
    const parts: PickPart[] = (entry.childItems ?? []).map((c: any) => {
      childNos.add(c.itemKey.itemNo);
      return {
        itemNo: c.itemKey.itemNo,
        name: c.itemKey.itemNo,
        location: toLocation(c.salesLocations),
        stock: stockByItem.get(c.itemKey.itemNo) ?? null,
      };
    });
    result[itemNo] = {
      location: parts.length ? { area: "onbekend", label: "Zie onderdelen" } : toLocation(entry.salesLocations),
      stock: stockByItem.get(itemNo) ?? null,
      parts,
    };
  }
  for (const itemNo of itemNos) {
    if (!result[itemNo]) result[itemNo] = { location: UNKNOWN, stock: stockByItem.get(itemNo) ?? null, parts: [] };
  }

  // Parts only come with an article number; look up their names.
  const names = new Map<string, string>();
  await Promise.all(
    [...childNos].map(async (no) => {
      try {
        const hit = (await searchIkea(no, 3)).find((p) => p.itemNo === no);
        if (hit) names.set(no, `${hit.name} ${hit.typeName}`.trim());
      } catch {
        // keep the article number as the name
      }
    }),
  );
  for (const info of Object.values(result)) {
    for (const part of info.parts) part.name = names.get(part.itemNo) ?? `Artikel ${part.itemNo}`;
  }
  return result;
}

/** Walking order in a store: Markthal first, then the self-serve aisles. */
export function pickOrder(loc: PickLocation): number {
  switch (loc.area) {
    case "markthal": return 0;
    case "zelfbediening": return 1000 + (Number(loc.aisle) || 0) * 100 + (Number(loc.bin) || 0);
    case "personeel": return 20000;
    default: return 30000;
  }
}

export const AREA_LABELS: Record<Area, string> = {
  markthal: "Markthal",
  zelfbediening: "Zelfbedieningsmagazijn",
  personeel: "Afhaling via personeel",
  onbekend: "Locatie onbekend",
};
