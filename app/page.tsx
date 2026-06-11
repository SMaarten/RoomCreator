"use client";

import { useRef, useState } from "react";
import { STYLE_OPTIONS, type DesignResult } from "@/lib/types";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [styleId, setStyleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DesignResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
  }

  async function onSubmit() {
    if (!file || !styleId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("style", styleId);

      const res = await fetch("/api/design", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Something went wrong.");
      }
      setResult(data as DesignResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = !!file && !!styleId && !loading;

  return (
    <main className="wrap">
      <div className="masthead">
        <h1>RoomCreator</h1>
        <span className="badge">IKEA × AI</span>
      </div>
      <p className="tagline">
        Take or upload a photo of your room, pick a style, and get IKEA
        furnishing ideas tailored to your space.
      </p>

      <div className="stack">
        {/* Step 1 — photo */}
        <section className="card">
          <p className="step-label">1 · Your room</p>
          <input
            ref={fileInputRef}
            className="hidden-input"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPickFile}
          />
          {previewUrl ? (
            <div className="preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Your room" />
              <button
                className="change"
                onClick={() => fileInputRef.current?.click()}
              >
                Change photo
              </button>
            </div>
          ) : (
            <div
              className="dropzone"
              onClick={() => fileInputRef.current?.click()}
            >
              <strong>Tap to take a photo or upload</strong>
              <p>JPG, PNG or WebP · up to 8&nbsp;MB</p>
            </div>
          )}
        </section>

        {/* Step 2 — style */}
        <section className="card">
          <p className="step-label">2 · Preferred style</p>
          <div className="style-grid">
            {STYLE_OPTIONS.map((s) => (
              <button
                key={s.id}
                className={`style-chip${styleId === s.id ? " selected" : ""}`}
                onClick={() => setStyleId(s.id)}
              >
                <strong>{s.label}</strong>
                <span>{s.description}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Step 3 — generate */}
        <section>
          <button className="btn" disabled={!canSubmit} onClick={onSubmit}>
            {loading ? (
              <>
                <span className="spinner" /> Designing your room…
              </>
            ) : (
              "Design my room"
            )}
          </button>
        </section>

        {error && <div className="error">{error}</div>}

        {result && <Results result={result} />}
      </div>

      <p className="footer">
        Built with Next.js · room analysis by Claude · products via parse.bot
      </p>
    </main>
  );
}

function Results({ result }: { result: DesignResult }) {
  const { analysis, items, totalEstimate, currency, usingMockData } = result;

  return (
    <div className="stack">
      {usingMockData && (
        <div className="notice">
          Showing sample IKEA products — connect your parse.bot API in{" "}
          <code>.env</code> for live results.
        </div>
      )}

      {/* Room read */}
      <section className="card">
        <p className="step-label">Room analysis</p>
        <div className="analysis">
          <div>
            <strong>{analysis.roomType}</strong>
            <p className="rationale">{analysis.description}</p>
          </div>
          {analysis.palette.length > 0 && (
            <div className="meta-row">
              {analysis.palette.map((c, i) => (
                <span key={i} className="pill swatch">
                  <i style={{ background: cssColor(c) }} /> {c}
                </span>
              ))}
            </div>
          )}
          {analysis.existingItems.length > 0 && (
            <div className="meta-row">
              {analysis.existingItems.map((it, i) => (
                <span key={i} className="pill">
                  {it}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Cost summary */}
      <div className="summary-bar">
        <span>
          {items.length} recommended {items.length === 1 ? "piece" : "pieces"}
        </span>
        <span className="total">
          ~{formatMoney(totalEstimate, currency)}
        </span>
      </div>

      {/* Recommendations */}
      <section className="card">
        <p className="step-label">Shopping the look</p>
        {items.map((item, i) => (
          <div className="item" key={i}>
            <div className="item-head">
              <h3>{item.category}</h3>
              <span className="q">“{item.searchQuery}”</span>
            </div>
            <p className="rationale">{item.rationale}</p>
            {item.products.length > 0 ? (
              <div className="products">
                {item.products.map((p) => (
                  <a
                    key={p.id}
                    className="product"
                    href={p.productUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="thumb" src={p.imageUrl} alt={p.name} />
                    <div className="body">
                      <div className="name">{p.name}</div>
                      <div className="price">
                        {formatMoney(p.price, p.currency)}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <p className="rationale">No matching products found.</p>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

// Map a free-text color name/hex to something CSS can render as a swatch.
function cssColor(c: string): string {
  const t = c.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(t)) return t;
  // Strip qualifiers like "warm", "soft", "light/dark" then try as a CSS color.
  const base = t.replace(/\b(warm|cool|soft|muted|pale|deep|dark|light|bright)\b/g, "").trim();
  return base || "#cccccc";
}
