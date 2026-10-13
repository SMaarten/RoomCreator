import { useEffect, useMemo, useState } from "react";
import { t } from "../lib/i18n";
import { formatEuro } from "../lib/ikea";
import { STORES, type CatalogLocale } from "../lib/locale";
import { areaLabel, fetchStock, pickOrder, type Area, type PickLocation, type StockInfo } from "../lib/stock";
import type { DesignItem } from "../lib/types";

interface Props {
  items: DesignItem[];
  /** IKEA site the products came from; only its stores carry these articles. */
  locale: CatalogLocale;
  storeId: string | null;
  onStoreChange: (id: string) => void;
}

/** IKEA prints article numbers as 802.758.87. */
export const formatItemNo = (no: string) => no.replace(/^(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3");

interface PickRow {
  key: string;
  itemNo: string;
  name: string;
  /** For parts: the product they belong to. */
  partOf?: string;
  quantity: number;
  location: PickLocation;
  stock: number | null;
  url: string;
  /** Unit price; parts of a combination have none of their own. */
  price?: number;
}

export function ShoppingList({ items, locale, storeId, onStoreChange }: Props) {
  const [stock, setStock] = useState<Record<string, StockInfo> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = items.reduce((s, i) => s + i.product.price * i.quantity, 0);
  const itemNos = useMemo(() => [...new Set(items.map((i) => i.itemNo))], [items]);
  const stores = useMemo(() => STORES.filter((s) => s.country === locale.country), [locale.country]);
  const store = stores.find((s) => s.id === storeId);

  useEffect(() => {
    if (!store || itemNos.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStock(store.id, itemNos, locale)
      .then((s) => !cancelled && setStock(s))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : t("stock.failed")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [store, itemNos, locale]);

  const rows: PickRow[] = useMemo(() => {
    if (!stock) return [];
    const out: PickRow[] = [];
    for (const item of items) {
      const info = stock[item.itemNo];
      const name = `${item.product.name} ${item.product.typeName}`;
      if (info?.parts.length) {
        for (const part of info.parts) {
          out.push({
            key: `${item.itemNo}-${part.itemNo}`,
            itemNo: part.itemNo,
            name: part.name,
            partOf: name,
            quantity: item.quantity,
            location: part.location,
            stock: part.stock,
            url: item.product.url,
          });
        }
      } else {
        out.push({
          key: item.itemNo,
          itemNo: item.itemNo,
          name,
          quantity: item.quantity,
          location: info?.location ?? { area: "onbekend", label: t("loc.unknown") },
          stock: info?.stock ?? null,
          url: item.product.url,
          price: item.product.price,
        });
      }
    }
    return out.sort((a, b) => pickOrder(a.location) - pickOrder(b.location));
  }, [items, stock]);

  const groups = useMemo(() => {
    const map = new Map<Area, PickRow[]>();
    for (const r of rows) map.set(r.location.area, [...(map.get(r.location.area) ?? []), r]);
    return [...map.entries()];
  }, [rows]);

  function downloadCsv() {
    const header = (["csv.order", "csv.zone", "csv.location", "csv.aisle", "csv.bin", "csv.article", "csv.partOf", "csv.itemNo", "csv.qty", "csv.unitPrice", "csv.total", "csv.stock", "csv.link"] as const).map((k) => t(k));
    const money = (n?: number) => (n == null ? "" : n.toFixed(2).replace(".", ","));
    const priceRows = items.map((i) => [
      "",
      "",
      "",
      "",
      "",
      `${i.product.name} ${i.product.typeName}`,
      "",
      formatItemNo(i.itemNo),
      String(i.quantity),
      money(i.product.price),
      money(i.product.price * i.quantity),
      "",
      i.product.url,
    ]);
    const body = rows.length
      ? rows.map((r, idx) => [
          String(idx + 1),
          areaLabel(r.location.area),
          r.location.label,
          r.location.aisle ?? "",
          r.location.bin ?? "",
          r.name,
          r.partOf ?? "",
          formatItemNo(r.itemNo),
          String(r.quantity),
          money(r.price),
          money(r.price == null ? undefined : r.price * r.quantity),
          r.stock == null ? "" : String(r.stock),
          r.url,
        ])
      : priceRows;
    // Semicolons and a BOM so Excel with Belgian settings opens it correctly.
    const csv = "﻿" + [header, ...body].map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${t("list.fileName")}${store ? `-${store.name.replace(/^IKEA\s*/, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="step-body shopping">
      <p className="lead no-print">{t("list.lead")}</p>

      <h3>{t("list.overview")}</h3>
      <div className="table-wrap">
      <table className="list">
        <thead>
          <tr>
            <th className="num-col">{t("list.qty")}</th>
            <th>{t("list.article")}</th>
            <th className="mono-ish">{t("list.itemNo")}</th>
            <th className="num-col">{t("list.price")}</th>
            <th className="num-col">{t("list.total")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.itemNo}>
              <td className="num-col">{i.quantity}</td>
              <td>
                <a href={i.product.url} target="_blank" rel="noreferrer">
                  <strong>{i.product.name}</strong> {i.product.typeName}
                </a>
                {i.product.measure && <span className="measure"> {i.product.measure}</span>}
              </td>
              <td className="mono-ish">{formatItemNo(i.itemNo)}</td>
              <td className="num-col">{formatEuro(i.product.price)}</td>
              <td className="num-col">{formatEuro(i.product.price * i.quantity)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>{t("list.total")}</td>
            <td className="mono-ish" />
            <td />
            <td className="num-col">{formatEuro(total)}</td>
          </tr>
        </tfoot>
      </table>
      </div>

      <h3>{t("list.route")}</h3>
      <label className="num no-print">
        <span>{t("list.store")}</span>
        <select value={store?.id ?? ""} onChange={(e) => onStoreChange(e.target.value)}>
          <option value="" disabled>{t("list.chooseStore")}</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      {store && <p className="print-only">{store.name}</p>}

      {!store && <p className="muted">{t("list.chooseStoreHint")}</p>}
      {loading && <p className="muted"><span className="spinner" /> {t("list.loading", { store: store?.name ?? "" })}</p>}
      {error && <p className="error">{error} {t("list.errorSuffix")}</p>}

      {!loading && groups.map(([area, list]) => (
        <section key={area} className="pick-group">
          <h4>{areaLabel(area)}</h4>
          <div className="table-wrap">
          <table className="list pick">
            <thead>
              <tr>
                <th>{t("list.where")}</th>
                <th>{t("list.article")}</th>
                <th className="mono-ish">{t("list.itemNo")}</th>
                <th className="num-col">{t("list.qty")}</th>
                <th className="num-col">{t("list.inStock")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.key}>
                  <td className="where">{r.location.label}</td>
                  <td>
                    {r.name}
                    {r.partOf && <span className="muted small"> {t("list.partOf", { name: r.partOf })}</span>}
                  </td>
                  <td className="mono-ish">{formatItemNo(r.itemNo)}</td>
                  <td className="num-col">{r.partOf ? `${r.quantity}×?` : r.quantity}</td>
                  <td className={`num-col ${r.stock != null && r.stock < r.quantity ? "short" : ""}`}>
                    {r.stock == null ? "?" : r.stock}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      ))}

      {rows.some((r) => r.partOf) && (
        <p className="muted small">{t("list.partsNote")}</p>
      )}
      {rows.length > 0 && (
        <p className="muted small">{t("list.liveNote")}</p>
      )}

      <div className="row wrap no-print actions">
        <button className="btn" onClick={downloadCsv}>{t("list.csv")}</button>
        <button className="btn ghost" onClick={() => window.print()}>{t("list.print")}</button>
      </div>
    </div>
  );
}
