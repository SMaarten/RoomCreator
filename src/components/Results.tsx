import { useState } from "react";
import { formatEuro } from "../lib/ikea";
import type { ChatTurn, Design } from "../lib/types";

interface Props {
  design: Design;
  budget: number;
  issues: string[];
  highlight: string | null;
  onHighlight: (key: string | null) => void;
  chat: ChatTurn[];
  busy: boolean;
  onFeedback: (text: string) => void;
  onChooseAlternative: (itemIdx: number, altIdx: number) => void;
  canRender: boolean;
  rendering: boolean;
  afterImage: string | null;
  onRender: () => void;
}

export function Results(props: Props) {
  const { design, budget, issues, highlight, onHighlight, onChooseAlternative, busy } = props;
  const total = design.items.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
  const over = total > budget;
  const pct = Math.min(100, (total / Math.max(1, budget)) * 100);

  return (
    <div className="step-body results">
      <p className="lead">{design.summary}</p>

      <div className={`budget ${over ? "over" : ""}`}>
        <div className="budget-line">
          <strong>{formatEuro(total)}</strong>
          <span className="muted">van {formatEuro(budget)} budget</span>
        </div>
        <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={total} aria-label="Totaal tegenover budget">
          <span style={{ width: `${pct}%` }} />
        </div>
        {over && <p className="error">Dit ontwerp gaat {formatEuro(total - budget)} over je budget. Vraag hieronder om goedkopere keuzes.</p>}
      </div>

      {(issues.length > 0 || design.dropped.length > 0) && (
        <div className="notice">
          <strong>Controleer even</strong>
          <ul>
            {issues.map((i) => <li key={i}>{i}</li>)}
            {design.dropped.map((d) => <li key={d}>{d} werd weggelaten: dat product kwam niet uit de IKEA-catalogus.</li>)}
          </ul>
        </div>
      )}

      <ul className="products">
        {design.items.map((item, idx) => {
          const key = `n${idx}`;
          return (
            <li
              key={key}
              className={highlight === key ? "active" : ""}
              onMouseEnter={() => item.placement && onHighlight(key)}
              onMouseLeave={() => onHighlight(null)}
            >
              {item.product.imageUrl ? <img src={item.product.imageUrl} alt="" loading="lazy" /> : <span className="noimg" aria-hidden="true" />}
              <div className="product-body">
                <span className="role">{item.role}</span>
                <a href={item.product.url} target="_blank" rel="noreferrer" className="pname">
                  {item.product.name} <span>{item.product.typeName}</span>
                </a>
                {item.product.measure && <span className="measure">{item.product.measure}</span>}
                <p className="small">{item.reason}</p>
              </div>
              <div className="price">
                {item.quantity > 1 && <span className="muted">{item.quantity} × {formatEuro(item.product.price)}</span>}
                <strong>{formatEuro(item.product.price * item.quantity)}</strong>
                {!item.placement && <span className="muted small">niet op plan</span>}
              </div>
              {item.alternatives.length > 0 && (
                <div className="alts">
                  <span className="alts-title">{item.alternatives.length === 1 ? "Alternatief" : "Alternatieven"}</span>
                  <ul>
                    {item.alternatives.map((alt, altIdx) => {
                      const diff = (alt.product.price - item.product.price) * item.quantity;
                      return (
                        <li key={alt.product.itemNo}>
                          {alt.product.imageUrl ? <img src={alt.product.imageUrl} alt="" loading="lazy" /> : <span className="noimg" aria-hidden="true" />}
                          <div>
                            <a href={alt.product.url} target="_blank" rel="noreferrer" className="pname">
                              {alt.product.name} <span>{alt.product.typeName}</span>
                            </a>
                            {alt.product.measure && <span className="measure"> {alt.product.measure}</span>}
                            <p className="small muted">{alt.note}</p>
                          </div>
                          <div className="alt-side">
                            <strong>{formatEuro(alt.product.price)}</strong>
                            <span className={`small ${diff > 0 ? "more" : "less"}`}>
                              {diff === 0 ? "zelfde prijs" : `${diff > 0 ? "+" : "−"}${formatEuro(Math.abs(diff))}`}
                            </span>
                            <button className="btn ghost small" disabled={busy} onClick={() => onChooseAlternative(idx, altIdx)}>
                              Kies dit
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {design.tips.length > 0 && (
        <>
          <h3>Tips</h3>
          <ul className="tips">
            {design.tips.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </>
      )}

      <AfterImage {...props} />
      <Chat {...props} />
    </div>
  );
}

function AfterImage({ canRender, rendering, afterImage, onRender }: Props) {
  if (!canRender && !afterImage) {
    return <p className="muted small">Voeg een Gemini-sleutel toe bij Instellingen om een "na"-foto van je kamer te laten maken.</p>;
  }
  return (
    <section className="after">
      <h3>Zo kan het eruitzien</h3>
      {afterImage && (
        <figure>
          <img src={afterImage} alt="Impressie van de ingerichte kamer" />
          <figcaption className="muted small">
            Een AI-impressie: kleuren en verhoudingen kloppen niet altijd exact.{" "}
            <a href={afterImage} download="roomkreator-impressie.png">Opslaan</a>
          </figcaption>
        </figure>
      )}
      {canRender && (
        <button className="btn ghost" disabled={rendering} onClick={onRender}>
          {rendering ? <><span className="spinner" /> Foto maken…</> : afterImage ? "Maak een nieuwe impressie" : "Maak een impressie"}
        </button>
      )}
    </section>
  );
}

function Chat({ chat, busy, onFeedback }: Props) {
  const [text, setText] = useState("");
  return (
    <section className="chat">
      <h3>Bijsturen</h3>
      {chat.length > 0 && (
        <ol className="turns">
          {chat.map((t, i) => (
            <li key={i} className={t.role}>{t.text}</li>
          ))}
        </ol>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim() || busy) return;
          onFeedback(text.trim());
          setText("");
        }}
      >
        <textarea
          rows={2}
          value={text}
          placeholder="Bv. goedkopere zitbank, meer opbergruimte, het bed liever onder het raam…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button className="btn" disabled={busy || !text.trim()}>Pas ontwerp aan</button>
      </form>
    </section>
  );
}
