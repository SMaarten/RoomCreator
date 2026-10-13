import { useState } from "react";
import { t } from "../lib/i18n";
import { formatEuro } from "../lib/ikea";
import type { ChatTurn, Design } from "../lib/types";

interface Props {
  design: Design;
  budget: number;
  issues: string[];
  /** Shown when the design's products come from another country than the chosen store. */
  catalogNote: string | null;
  highlight: string | null;
  onHighlight: (key: string | null) => void;
  chat: ChatTurn[];
  busy: boolean;
  onFeedback: (text: string) => void;
  onChooseAlternative: (itemIdx: number, altIdx: number) => void;
  onToggleRemoved: (itemIdx: number) => void;
  onConfirm: () => void;
  canRender: boolean;
  rendering: boolean;
  afterImage: string | null;
  onRender: () => void;
}

export function Results(props: Props) {
  const { design, budget, issues, catalogNote, highlight, onHighlight, onChooseAlternative, onToggleRemoved, onConfirm, busy } = props;
  const active = design.items.map((item, idx) => ({ item, idx })).filter(({ item }) => !item.removed);
  const removed = design.items.map((item, idx) => ({ item, idx })).filter(({ item }) => item.removed);
  const total = active.reduce((sum, { item }) => sum + item.product.price * item.quantity, 0);
  const over = total > budget;
  const pct = Math.min(100, (total / Math.max(1, budget)) * 100);

  return (
    <div className="step-body results">
      <p className="lead">{design.summary}</p>

      <div className={`budget ${over ? "over" : ""}`}>
        <div className="budget-line">
          <strong>{formatEuro(total)}</strong>
          <span className="muted">{t("results.ofBudget", { budget: formatEuro(budget) })}</span>
        </div>
        <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={total} aria-label={t("results.meterAria")}>
          <span style={{ width: `${pct}%` }} />
        </div>
        {over && <p className="error">{t("results.over", { amount: formatEuro(total - budget) })}</p>}
      </div>

      {catalogNote && <div className="notice">{catalogNote}</div>}

      {(issues.length > 0 || design.dropped.length > 0) && (
        <div className="notice">
          <strong>{t("results.check")}</strong>
          <ul>
            {issues.map((i) => <li key={i}>{i}</li>)}
            {design.dropped.map((d) => <li key={d}>{t("results.dropped", { item: d })}</li>)}
          </ul>
        </div>
      )}

      <ul className="products">
        {active.map(({ item, idx }) => {
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
                {!item.placement && <span className="muted small">{t("results.notOnPlan")}</span>}
                <button className="link-btn" disabled={busy} onClick={() => onToggleRemoved(idx)} title={t("results.notNeededTitle")}>
                  {t("results.notNeeded")}
                </button>
              </div>
              {item.alternatives.length > 0 && (
                <details className="alts">
                  <summary>
                    {item.alternatives.length === 1 ? t("results.alt") : t("results.alts", { n: item.alternatives.length })}
                    <span className="alts-range">
                      {formatEuro(Math.min(...item.alternatives.map((a) => a.product.price)))}–{formatEuro(Math.max(...item.alternatives.map((a) => a.product.price)))}
                    </span>
                  </summary>
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
                              {diff === 0 ? t("results.samePrice") : `${diff > 0 ? "+" : "−"}${formatEuro(Math.abs(diff))}`}
                            </span>
                            <button className="btn ghost small" disabled={busy} onClick={() => onChooseAlternative(idx, altIdx)}>
                              {t("results.choose")}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>

      {removed.length > 0 && (
        <div className="removed">
          <h3>{t("results.removed")}</h3>
          <ul>
            {removed.map(({ item, idx }) => (
              <li key={item.itemNo}>
                <span>
                  <span className="muted">{item.role}:</span> {item.product.name} {item.product.typeName}
                  <span className="muted"> ({formatEuro(item.product.price * item.quantity)})</span>
                </span>
                <button className="link-btn" disabled={busy} onClick={() => onToggleRemoved(idx)}>{t("results.restore")}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="confirm">
        <button className="btn" disabled={busy || active.length === 0} onClick={onConfirm}>
          {t("results.confirm")}
        </button>
        <span className="muted small">{t("results.confirmHint")}</span>
      </div>

      {design.tips.length > 0 && (
        <>
          <h3>{t("results.tips")}</h3>
          <ul className="tips">
            {design.tips.map((tip) => <li key={tip}>{tip}</li>)}
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
    return <p className="muted small">{t("after.needKey")}</p>;
  }
  return (
    <section className="after">
      <h3>{t("after.title")}</h3>
      {afterImage && (
        <figure>
          <img src={afterImage} alt={t("after.alt")} />
          <figcaption className="muted small">
            {t("after.caption")} <a href={afterImage} download="roomkreator.png">{t("after.save")}</a>
          </figcaption>
        </figure>
      )}
      {canRender && (
        <button className="btn ghost" disabled={rendering} onClick={onRender}>
          {rendering ? <><span className="spinner" /> {t("after.making")}</> : afterImage ? t("after.new") : t("after.make")}
        </button>
      )}
    </section>
  );
}

function Chat({ chat, busy, onFeedback }: Props) {
  const [text, setText] = useState("");
  return (
    <section className="chat">
      <h3>{t("chat.title")}</h3>
      {chat.length > 0 && (
        <ol className="turns">
          {chat.map((turn, i) => (
            <li key={i} className={turn.role}>{turn.text}</li>
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
          placeholder={t("chat.placeholder")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button className="btn" disabled={busy || !text.trim()}>{t("chat.send")}</button>
      </form>
    </section>
  );
}
