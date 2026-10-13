import { useEffect, useMemo, useState } from "react";
import { load, save } from "../lib/storage";
import {
  clearUsage,
  costOf,
  DEFAULT_PRICES,
  listUsage,
  loadPrices,
  savePrices,
  type Price,
  type UsageEntry,
  type UsageKind,
} from "../lib/usage";

// Usage and cost overview for the owner. Dutch only, reads the local log.

const KIND_LABEL: Record<UsageKind, string> = {
  analyse: "Foto-analyse",
  ontwerp: "Ontwerp",
  bijsturen: "Bijsturen",
  impressie: "Na-foto",
};

const int = new Intl.NumberFormat("nl-BE");
const usd = (n: number) => `$ ${n.toLocaleString("nl-BE", { minimumFractionDigits: n > 0 && n < 0.1 ? 3 : 2, maximumFractionDigits: n > 0 && n < 0.1 ? 3 : 2 })}`;
const eur = (n: number) => new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(n);
const when = (ms: number) =>
  new Intl.DateTimeFormat("nl-BE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(ms);

interface Totals {
  claude: number;
  gemini: number;
  calls: number;
  runs: Set<string>;
}

const emptyTotals = (): Totals => ({ claude: 0, gemini: 0, calls: 0, runs: new Set() });

export function Admin() {
  const [log, setLog] = useState<UsageEntry[]>([]);
  const [prices, setPrices] = useState<Record<string, Price>>(DEFAULT_PRICES);
  const [rate, setRate] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    Promise.all([listUsage(), loadPrices(), load<number>("usdToEur")]).then(([l, p, r]) => {
      setLog(l);
      setPrices(p);
      setRate(typeof r === "number" ? r : null);
    });
  }, []);

  // Costs are recalculated with the current price table, so editing a price
  // updates every figure on the page.
  // Newest first; the log is in append order, so reverse before the (stable) sort.
  const rows = useMemo(() => log.map((e) => ({ ...e, cost: costOf(e, prices) })).reverse().sort((a, b) => b.at - a.at), [log, prices]);

  const periods = useMemo(() => {
    const now = new Date();
    const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const p = { vandaag: emptyTotals(), maand: emptyTotals(), totaal: emptyTotals() };
    for (const r of rows) {
      const buckets = [p.totaal, ...(r.at >= startMonth ? [p.maand] : []), ...(r.at >= startDay ? [p.vandaag] : [])];
      for (const b of buckets) {
        if (r.provider === "anthropic") b.claude += r.cost;
        else b.gemini += r.cost;
        b.calls += 1;
        if (r.kind === "ontwerp" || r.kind === "bijsturen") b.runs.add(r.runId);
      }
    }
    return p;
  }, [rows]);

  const perProject = useMemo(() => {
    const map = new Map<string, { name: string; designs: Set<string>; refines: Set<string>; images: number; tokens: number; cost: number; last: number }>();
    for (const r of rows) {
      const p = map.get(r.projectId) ?? { name: r.projectName, designs: new Set(), refines: new Set(), images: 0, tokens: 0, cost: 0, last: 0 };
      if (r.kind === "ontwerp") p.designs.add(r.runId);
      if (r.kind === "bijsturen") p.refines.add(r.runId);
      p.images += r.images;
      p.tokens += r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens + r.outputTokens;
      p.cost += r.cost;
      if (r.at > p.last) {
        p.last = r.at;
        p.name = r.projectName;
      }
      map.set(r.projectId, p);
    }
    return [...map.values()].sort((a, b) => b.last - a.last);
  }, [rows]);

  const perKind = useMemo(() => {
    const map = new Map<UsageKind, { runs: Set<string>; cost: number }>();
    for (const r of rows) {
      const k = map.get(r.kind) ?? { runs: new Set(), cost: 0 };
      k.runs.add(r.runId);
      k.cost += r.cost;
      map.set(r.kind, k);
    }
    return map;
  }, [rows]);

  const cacheShare = useMemo(() => {
    const claude = rows.filter((r) => r.provider === "anthropic");
    const input = claude.reduce((s, r) => s + r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens, 0);
    const read = claude.reduce((s, r) => s + r.cacheReadTokens, 0);
    return input ? read / input : 0;
  }, [rows]);

  const money = (n: number) => (rate ? `${usd(n)} (${eur(n * rate)})` : usd(n));

  function exportCsv() {
    const header = ["Tijd", "Project", "Soort", "Dienst", "Model", "Input", "Cache gelezen", "Cache geschreven", "Output", "Afbeeldingen", "Kost USD"];
    const body = rows.map((r) => [
      new Date(r.at).toISOString(),
      r.projectName,
      KIND_LABEL[r.kind],
      r.provider === "anthropic" ? "Claude" : "Gemini",
      r.model,
      r.inputTokens,
      r.cacheReadTokens,
      r.cacheWriteTokens,
      r.outputTokens,
      r.images,
      r.cost.toFixed(4).replace(".", ","),
    ]);
    const csv = "﻿" + [header, ...body].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "roomkreator-verbruik.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function setPrice(model: string, field: keyof Price, value: number) {
    const next = { ...prices, [model]: { ...prices[model], [field]: Number.isFinite(value) ? value : 0 } };
    setPrices(next);
    savePrices(next);
  }

  const designAvg = (() => {
    const k = perKind.get("ontwerp");
    return k && k.runs.size ? k.cost / k.runs.size : null;
  })();
  const visible = showAll ? rows : rows.slice(0, 50);

  return (
    <div className="app admin">
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="26" height="26" /><path d="M3 20h12v9" /></svg>
          <span>RoomKreator</span>
        </div>
        <nav className="row">
          <a className="btn ghost small" href="./">Naar de app</a>
        </nav>
      </header>

      <main className="admin-main">
        <h1>Verbruik en kosten</h1>
        <p className="lead">
          Elke oproep naar Claude en Gemini vanuit deze browser, met de tokens die de API teruggaf en een berekende kost.
          Dit is een schatting; de officiële factuur staat bij Anthropic en Google.
        </p>

        <table className="list periods">
          <thead>
            <tr>
              <th>Periode</th>
              <th className="num-col">Claude</th>
              <th className="num-col">Gemini</th>
              <th className="num-col">Totaal</th>
              <th className="num-col">Oproepen</th>
              <th className="num-col">Ontwerpruns</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Vandaag", periods.vandaag],
                ["Deze maand", periods.maand],
                ["Sinds het begin", periods.totaal],
              ] as const
            ).map(([label, p]) => (
              <tr key={label}>
                <td><strong>{label}</strong></td>
                <td className="num-col">{usd(p.claude)}</td>
                <td className="num-col">{usd(p.gemini)}</td>
                <td className="num-col total-cell">{money(p.claude + p.gemini)}</td>
                <td className="num-col">{int.format(p.calls)}</td>
                <td className="num-col">{int.format(p.runs.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="facts">
          <p>
            Gemiddeld per ontwerp: <strong>{designAvg == null ? "nog geen ontwerp" : money(designAvg)}</strong>
          </p>
          <p>
            Uit de cache gelezen: <strong>{Math.round(cacheShare * 100)}%</strong> van de Claude-input
            <span className="muted"> (hoe hoger, hoe goedkoper)</span>
          </p>
          <label className="num rate">
            <span>Omrekenkoers $ naar €</span>
            <span className="num-input">
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="bv. 0,86"
                value={rate ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  setRate(v);
                  save("usdToEur", v);
                }}
              />
            </span>
          </label>
        </div>

        <section className="official">
          <h2>Officiële cijfers</h2>
          <div className="official-grid">
            <div>
              <h3>Anthropic (Claude)</h3>
              <ul>
                <li><a href="https://platform.claude.com/cost" target="_blank" rel="noreferrer">Kosten</a>: bedragen per dag, te groeperen per API-sleutel</li>
                <li><a href="https://platform.claude.com/usage" target="_blank" rel="noreferrer">Verbruik</a>: tokens per model en per sleutel</li>
                <li><a href="https://platform.claude.com/settings/limits" target="_blank" rel="noreferrer">Limieten</a>: stel een maandelijks maximum in</li>
              </ul>
              <p className="muted small">Tip: maak een aparte API-sleutel "RoomKreator", dan zie je het verbruik van deze app los van de rest.</p>
            </div>
            <div>
              <h3>Google (Gemini)</h3>
              <ul>
                <li><a href="https://aistudio.google.com/usage" target="_blank" rel="noreferrer">Verbruik</a> in Google AI Studio</li>
                <li><a href="https://aistudio.google.com/spend" target="_blank" rel="noreferrer">Uitgaven</a>: kosten en maandelijks maximum</li>
              </ul>
              <p className="muted small">Gemini rekent hier enkel de na-foto's aan; zonder Gemini-sleutel blijft dit op nul.</p>
            </div>
          </div>
        </section>

        <h2>Per project</h2>
        {perProject.length === 0 ? (
          <p className="muted">Nog geen verbruik. Zodra je in de app foto's laat bekijken of een ontwerp maakt, verschijnt het hier.</p>
        ) : (
          <div className="table-wrap">
            <table className="list">
              <thead>
                <tr>
                  <th>Project</th>
                  <th className="num-col">Ontwerpen</th>
                  <th className="num-col">Bijsturingen</th>
                  <th className="num-col">Na-foto's</th>
                  <th className="num-col">Tokens</th>
                  <th className="num-col">Kost</th>
                  <th className="num-col">Laatst</th>
                </tr>
              </thead>
              <tbody>
                {perProject.map((p) => (
                  <tr key={p.name + p.last}>
                    <td><strong>{p.name}</strong></td>
                    <td className="num-col">{p.designs.size}</td>
                    <td className="num-col">{p.refines.size}</td>
                    <td className="num-col">{p.images}</td>
                    <td className="num-col">{int.format(p.tokens)}</td>
                    <td className="num-col">{money(p.cost)}</td>
                    <td className="num-col">{when(p.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2>Alle oproepen</h2>
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="list log-table">
              <thead>
                <tr>
                  <th>Tijd</th>
                  <th>Project</th>
                  <th>Soort</th>
                  <th>Model</th>
                  <th className="num-col">Input</th>
                  <th className="num-col">Cache gelezen</th>
                  <th className="num-col">Cache geschreven</th>
                  <th className="num-col">Output</th>
                  <th className="num-col">Kost</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td className="num-col">{when(r.at)}</td>
                    <td>{r.projectName}</td>
                    <td>{KIND_LABEL[r.kind]}</td>
                    <td className="small">{r.model}</td>
                    <td className="num-col">{int.format(r.inputTokens)}</td>
                    <td className="num-col">{int.format(r.cacheReadTokens)}</td>
                    <td className="num-col">{int.format(r.cacheWriteTokens)}</td>
                    <td className="num-col">{r.images ? `${r.images} afb.` : int.format(r.outputTokens)}</td>
                    <td className="num-col">{usd(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 50 && (
          <button className="link-btn" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Toon enkel de laatste 50" : `Toon alle ${rows.length} oproepen`}
          </button>
        )}

        <h2>Tarieven</h2>
        <p className="muted small">
          In dollar per miljoen tokens (na-foto's: per afbeelding). Pas aan als de prijzen wijzigen; alle bedragen hierboven rekenen meteen mee.
          Ontwerpen gebruiken thinking: die tokens zitten in Output.
        </p>
        <div className="table-wrap">
          <table className="list prices">
            <thead>
              <tr>
                <th>Model</th>
                <th className="num-col">Input</th>
                <th className="num-col">Output</th>
                <th className="num-col">Cache lezen</th>
                <th className="num-col">Cache schrijven</th>
                <th className="num-col">Per afbeelding</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(prices).map(([model, p]) => (
                <tr key={model}>
                  <td className="small">{model}</td>
                  {(["input", "output", "cacheRead", "cacheWrite", "perImage"] as const).map((f) => (
                    <td key={f} className="num-col">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        aria-label={`${model} ${f}`}
                        value={p[f] ?? 0}
                        onChange={(e) => setPrice(model, f, Number(e.target.value))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          className="link-btn"
          onClick={() => {
            setPrices(DEFAULT_PRICES);
            savePrices({});
          }}
        >
          Standaardtarieven terugzetten
        </button>

        <div className="row wrap actions">
          <button className="btn" disabled={rows.length === 0} onClick={exportCsv}>Download logboek als CSV</button>
          <button
            className="btn ghost"
            disabled={rows.length === 0}
            onClick={async () => {
              if (!confirm("Het volledige verbruikslogboek wissen? De cijfers bij Anthropic en Google blijven bestaan.")) return;
              await clearUsage();
              setLog([]);
            }}
          >
            Logboek wissen
          </button>
        </div>
        <p className="muted small">
          Dit logboek staat in deze browser. Gebruik je de app op een ander toestel, dan telt dat hier niet mee; de officiële
          pagina's hierboven tonen alles.
        </p>
      </main>
    </div>
  );
}
