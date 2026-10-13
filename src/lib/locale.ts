// Which IKEA site products come from: the country of the chosen store, in
// the interface language when that site offers it.

import storeData from "../data/stores.json";
import type { Lang } from "./i18n";

export type Country = "be" | "nl" | "fr" | "de";

export interface Store {
  id: string;
  country: Country;
  name: string;
  city: string;
  lat: number;
  lng: number;
}

export interface CatalogLocale {
  country: Country;
  /** Language of product names and search terms on that IKEA site. */
  lang: string;
}

export const STORES = storeData as Store[];
export const COUNTRIES: Country[] = ["be", "nl", "fr", "de"];

/** Languages each IKEA site offers, in order of preference as a fallback. */
const SITE_LANGS: Record<Country, string[]> = {
  be: ["nl", "fr", "en"],
  nl: ["nl", "en"],
  fr: ["fr"],
  de: ["de", "en"],
};

export const DEFAULT_LOCALE: CatalogLocale = { country: "be", lang: "nl" };

export function findStore(id: string | null | undefined): Store | undefined {
  return id ? STORES.find((s) => s.id === id) : undefined;
}

export function catalogLocale(storeId: string | null | undefined, ui: Lang): CatalogLocale {
  const country = findStore(storeId)?.country ?? "be";
  const langs = SITE_LANGS[country];
  const lang = langs.includes(ui) ? ui : langs.includes("en") ? "en" : langs[0];
  return { country, lang };
}

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function nearestStore(lat: number, lng: number): { store: Store; km: number } {
  let best = STORES[0];
  let bestKm = Infinity;
  for (const s of STORES) {
    const km = distanceKm(lat, lng, s.lat, s.lng);
    if (km < bestKm) {
      best = s;
      bestKm = km;
    }
  }
  return { store: best, km: bestKm };
}

export function currentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("no geolocation"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      reject,
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 },
    );
  });
}
