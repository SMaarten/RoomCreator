import { useRef, useState } from "react";
import { t } from "../lib/i18n";
import { resizeToJpeg } from "../lib/image";
import { buildGeometry, checkRoom, isAxisAligned, PRESETS, validateOpening } from "../lib/layout";
import {
  openingLabel,
  PURPOSES,
  purposeLabel,
  STYLE_IDS,
  styleDescription,
  styleLabel,
  wallLabel,
  type Opening,
  type OpeningKind,
  type Photo,
  type Preferences,
  type Room,
  type RoomAnalysis,
} from "../lib/types";

const uid = () => Math.random().toString(36).slice(2, 9);

// ---------------------------------------------------------------------------

export function PhotosStep({ photos, wallIds, onChange }: { photos: Photo[]; wallIds: string[]; onChange: (p: Photo[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(false);
    try {
      const added: Photo[] = [];
      for (const f of Array.from(files).slice(0, 6 - photos.length)) {
        if (!f.type.startsWith("image/")) continue;
        added.push({ id: uid(), dataUrl: await resizeToJpeg(f) });
      }
      onChange([...photos, ...added]);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="step-body">
      <p className="lead">{t("photos.lead")}</p>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
      <div
        className="dropzone"
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          add(e.dataTransfer.files);
        }}
      >
        {busy ? t("photos.resizing") : photos.length ? t("photos.addMore") : t("photos.choose")}
      </div>
      <p className="privacy">{t("privacy.photos")}</p>
      {error && <p className="error">{t("photos.error")}</p>}
      {photos.length > 0 && (
        <ul className="photos">
          {photos.map((p) => (
            <li key={p.id}>
              <img src={p.dataUrl} alt="" />
              <select
                aria-label={t("photos.facingAria")}
                value={p.facing ?? ""}
                onChange={(e) => onChange(photos.map((x) => (x.id === p.id ? { ...x, facing: e.target.value || undefined } : x)))}
              >
                <option value="">{t("photos.facing")}</option>
                {wallIds.map((w) => (
                  <option key={w} value={w}>{wallLabel(w)}</option>
                ))}
              </select>
              <button className="icon" aria-label={t("photos.remove")} onClick={() => onChange(photos.filter((x) => x.id !== p.id))}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Num({ label, value, onChange, min = 0, suffix = "cm" }: { label: string; value: number; onChange: (n: number) => void; min?: number; suffix?: string }) {
  return (
    <label className="num">
      <span>{label}</span>
      <span className="num-input">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
        />
        <em>{suffix}</em>
      </span>
    </label>
  );
}

const ADDABLE: OpeningKind[] = ["deur", "raam", "radiator", "doorgang"];
const DEFAULT_SIZE: Record<OpeningKind, number> = { deur: 83, raam: 120, radiator: 100, doorgang: 90, anders: 60 };

const DIRECTIONS = [
  { angle: 0, key: "dir.right" },
  { angle: 90, key: "dir.down" },
  { angle: 180, key: "dir.left" },
  { angle: 270, key: "dir.up" },
] as const;
const isStraight = (a: number) => DIRECTIONS.some((d) => d.angle === a);

export function RoomStep({ room, onChange }: { room: Room; onChange: (r: Room) => void }) {
  const set = (patch: Partial<Room>) => onChange({ ...room, ...patch });
  const setWall = (id: string, patch: Partial<Room["walls"][number]>) =>
    set({ walls: room.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const setOpening = (id: string, patch: Partial<Opening>) =>
    set({ openings: room.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)) });

  const g = buildGeometry(room);
  const shapeError = checkRoom(room, g);
  const closing = g.walls.find((w) => w.closing);

  return (
    <div className="step-body">
      <p className="lead">{t("room.lead")}</p>

      <div className="row wrap">
        <span className="muted small">{t("room.startWith")}</span>
        {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((key) => (
          <button
            key={key}
            className="btn ghost small"
            onClick={() => set({ walls: PRESETS[key].walls.map((w) => ({ ...w, id: uid() })) })}
          >
            {t(`preset.${key}`)}
          </button>
        ))}
      </div>

      <ol className="walls">
        {room.walls.map((w, i) => (
          <li key={w.id}>
            <span className="wall-name">{wallLabel(g.walls[i]?.id ?? String.fromCharCode(65 + i))}</span>
            <Num label={t("room.length")} value={w.length} onChange={(length) => setWall(w.id, { length })} />
            <label className="num">
              <span>{t("room.direction")}</span>
              <select
                value={isStraight(w.angle) ? String(w.angle) : "schuin"}
                onChange={(e) => setWall(w.id, { angle: e.target.value === "schuin" ? 45 : Number(e.target.value) })}
              >
                {DIRECTIONS.map((d) => (
                  <option key={d.angle} value={d.angle}>{t(d.key)}</option>
                ))}
                <option value="schuin">{t("dir.slanted")}</option>
              </select>
            </label>
            {!isStraight(w.angle) && (
              <Num label={t("room.angle")} suffix="°" value={w.angle} onChange={(angle) => setWall(w.id, { angle: ((angle % 360) + 360) % 360 })} />
            )}
            <button
              className="icon"
              aria-label={t("room.removeWall", { id: g.walls[i]?.id ?? "" })}
              disabled={room.walls.length <= 2}
              onClick={() => set({ walls: room.walls.filter((x) => x.id !== w.id) })}
            >
              ×
            </button>
          </li>
        ))}
        {closing && (
          <li className="closing">
            <span className="wall-name">{wallLabel(closing.id)}</span>
            <span>
              {t("room.closes")} <strong>{closing.length} cm</strong>
              {!isAxisAligned(closing) && <span className="muted"> {t("room.closesSlanted")}</span>}
            </span>
          </li>
        )}
      </ol>
      <div className="row wrap">
        <button className="btn ghost small" onClick={() => set({ walls: [...room.walls, { id: uid(), length: 100, angle: 90 }] })}>
          {t("room.addWall")}
        </button>
        <span className="muted small">{t("room.angleHint")}</span>
      </div>
      {shapeError && <p className="error">{shapeError}</p>}

      <div className="dims">
        <Num label={t("room.height")} value={room.height} onChange={(height) => set({ height })} />
        <p className="muted small area">{t("room.area", { area: g.area.toFixed(1) })}</p>
      </div>

      <h3>{t("room.openingsTitle")}</h3>
      <p className="muted">{t("room.openingsHint")}</p>

      {room.openings.map((o) => {
        const err = validateOpening(g, o);
        return (
          <fieldset key={o.id} className="opening">
            <legend>{openingLabel(o.kind)}</legend>
            <label className="num">
              <span>{t("opening.wall")}</span>
              <select value={o.wall} onChange={(e) => setOpening(o.id, { wall: e.target.value })}>
                {g.walls.map((w) => (
                  <option key={w.id} value={w.id}>{wallLabel(w.id)} ({w.length} cm)</option>
                ))}
              </select>
            </label>
            <Num label={t("opening.offset")} value={o.offset} onChange={(offset) => setOpening(o.id, { offset })} />
            <Num label={t("opening.width")} value={o.size} onChange={(size) => setOpening(o.id, { size })} />
            {o.kind === "raam" && (
              <Num label={t("opening.sill")} value={o.sillHeight ?? NaN} onChange={(sillHeight) => setOpening(o.id, { sillHeight: Number.isFinite(sillHeight) ? sillHeight : undefined })} />
            )}
            {o.kind === "deur" && (
              <>
                <label className="num">
                  <span>{t("opening.hinge")}</span>
                  <select value={o.hinge ?? "links"} onChange={(e) => setOpening(o.id, { hinge: e.target.value as Opening["hinge"] })}>
                    <option value="links">{t("hinge.links")}</option>
                    <option value="rechts">{t("hinge.rechts")}</option>
                  </select>
                </label>
                <label className="num">
                  <span>{t("opening.swing")}</span>
                  <select value={o.swing ?? "binnen"} onChange={(e) => setOpening(o.id, { swing: e.target.value as Opening["swing"] })}>
                    <option value="binnen">{t("swing.binnen")}</option>
                    <option value="buiten">{t("swing.buiten")}</option>
                  </select>
                </label>
              </>
            )}
            <button className="icon" aria-label={t("opening.remove", { kind: openingLabel(o.kind) })} onClick={() => set({ openings: room.openings.filter((x) => x.id !== o.id) })}>×</button>
            {err && <p className="error full">{err}</p>}
          </fieldset>
        );
      })}

      <div className="row wrap">
        {ADDABLE.map((k) => (
          <button
            key={k}
            className="btn ghost small"
            onClick={() =>
              set({
                openings: [
                  ...room.openings,
                  {
                    id: uid(),
                    kind: k,
                    wall: "A",
                    offset: 20,
                    size: DEFAULT_SIZE[k],
                    sillHeight: k === "raam" ? 90 : undefined,
                    hinge: k === "deur" ? "links" : undefined,
                    swing: k === "deur" ? "binnen" : undefined,
                  },
                ],
              })
            }
          >
            + {openingLabel(k)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ExistingStep({
  analysis,
  busy,
  canAnalyze,
  onAnalyze,
  onChange,
}: {
  analysis: RoomAnalysis | null;
  busy: boolean;
  canAnalyze: boolean;
  onAnalyze: () => void;
  onChange: (a: RoomAnalysis) => void;
}) {
  if (!analysis) {
    return (
      <div className="step-body">
        <p className="lead">{t("existing.lead")}</p>
        <button className="btn" disabled={!canAnalyze || busy} onClick={onAnalyze}>
          {busy ? <><span className="spinner" /> {t("existing.analyzing")}</> : t("existing.analyze")}
        </button>
      </div>
    );
  }
  return (
    <div className="step-body">
      <p className="lead"><strong>{analysis.roomType}.</strong> {analysis.description}</p>
      <p className="muted">{analysis.light}</p>
      {analysis.palette.length > 0 && (
        <ul className="palette" aria-label={t("existing.paletteAria")}>
          {analysis.palette.map((c) => (
            <li key={c} style={{ background: c }} title={c} />
          ))}
        </ul>
      )}
      <h3>{t("existing.keepTitle")}</h3>
      {analysis.existing.length === 0 && <p className="muted">{t("existing.none")}</p>}
      <ul className="existing">
        {analysis.existing.map((e) => (
          <li key={e.id}>
            <div>
              <strong>{e.name}</strong>
              <span className="muted">, {t("existing.approx", { w: e.widthCm, d: e.depthCm })}</span>
              <p className="muted small">{e.description}</p>
            </div>
            <div className="toggle" role="group" aria-label={t("existing.toggleAria", { name: e.name })}>
              {[true, false].map((keep) => (
                <button
                  key={String(keep)}
                  aria-pressed={e.keep === keep}
                  onClick={() => onChange({ ...analysis, existing: analysis.existing.map((x) => (x.id === e.id ? { ...x, keep } : x)) })}
                >
                  {keep ? t("existing.keep") : t("existing.replace")}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <button className="btn ghost small" disabled={busy} onClick={onAnalyze}>
        {busy ? t("existing.reanalyzing") : t("existing.reanalyze")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

const BUDGETS = [500, 1000, 2000, 4000];

export function PrefsStep({ prefs, onChange }: { prefs: Preferences; onChange: (p: Preferences) => void }) {
  const set = (patch: Partial<Preferences>) => onChange({ ...prefs, ...patch });
  const isPreset = BUDGETS.includes(prefs.budget);
  const [custom, setCustom] = useState(!isPreset);
  const amountRef = useRef<HTMLInputElement>(null);
  const showAmount = custom || !isPreset;

  return (
    <div className="step-body">
      <h3>{t("prefs.purposeTitle")}</h3>
      <div className="chips">
        {PURPOSES.map((p) => (
          <button key={p} aria-pressed={prefs.purpose === p} onClick={() => set({ purpose: p })}>{purposeLabel(p)}</button>
        ))}
      </div>

      <h3>{t("prefs.styleTitle")}</h3>
      <div className="styles">
        {STYLE_IDS.map((id) => (
          <button key={id} aria-pressed={prefs.styleId === id} onClick={() => set({ styleId: id })}>
            <strong>{styleLabel(id)}</strong>
            <span>{styleDescription(id)}</span>
          </button>
        ))}
      </div>

      <h3>{t("prefs.budgetTitle")}</h3>
      <div className="chips">
        {BUDGETS.map((b) => (
          <button
            key={b}
            aria-pressed={!custom && prefs.budget === b}
            onClick={() => {
              setCustom(false);
              set({ budget: b });
            }}
          >
            € {b}
          </button>
        ))}
        <button
          aria-pressed={showAmount}
          onClick={() => {
            setCustom(true);
            requestAnimationFrame(() => amountRef.current?.focus());
          }}
        >
          {t("budget.other")}
        </button>
      </div>
      {showAmount && (
        <label className="num budget-amount">
          <span>{t("budget.amount")}</span>
          <span className="num-input">
            <em className="pre">€</em>
            <input
              ref={amountRef}
              type="number"
              inputMode="numeric"
              min={50}
              step={50}
              value={Number.isFinite(prefs.budget) ? prefs.budget : ""}
              onChange={(e) => set({ budget: e.target.value === "" ? NaN : Number(e.target.value) })}
            />
          </span>
        </label>
      )}
      <label className="field">
        <span>{t("budget.note")}</span>
        <input
          type="text"
          placeholder={t("budget.notePlaceholder")}
          value={prefs.budgetNote}
          onChange={(e) => set({ budgetNote: e.target.value })}
        />
      </label>

      <label className="field">
        <span>{t("prefs.wishes")}</span>
        <textarea
          rows={3}
          placeholder={t("prefs.wishesPlaceholder")}
          value={prefs.wishes}
          onChange={(e) => set({ wishes: e.target.value })}
        />
      </label>
    </div>
  );
}
