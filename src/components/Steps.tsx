import { useRef, useState } from "react";
import { resizeToJpeg } from "../lib/image";
import { buildGeometry, checkRoom, isAxisAligned, PRESETS, validateOpening } from "../lib/layout";
import {
  OPENING_LABELS,
  PURPOSES,
  STYLES,
  type Opening,
  type OpeningKind,
  type Photo,
  type Preferences,
  type Room,
  type RoomAnalysis,
  wallLabel,
} from "../lib/types";

const uid = () => Math.random().toString(36).slice(2, 9);

// ---------------------------------------------------------------------------

export function PhotosStep({ photos, wallIds, onChange }: { photos: Photo[]; wallIds: string[]; onChange: (p: Photo[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const added: Photo[] = [];
      for (const f of Array.from(files).slice(0, 6 - photos.length)) {
        if (!f.type.startsWith("image/")) continue;
        added.push({ id: uid(), dataUrl: await resizeToJpeg(f) });
      }
      onChange([...photos, ...added]);
    } catch {
      setError("Deze foto kon niet gelezen worden. Probeer JPG of PNG; HEIC werkt niet in elke browser.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="step-body">
      <p className="lead">Fotografeer de kamer vanuit de hoeken, zodat elke wand minstens één keer in beeld is. Maximaal zes foto's.</p>
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
        {busy ? "Foto's verkleinen…" : photos.length ? "Nog foto's toevoegen" : "Kies foto's of sleep ze hierheen"}
      </div>
      {error && <p className="error">{error}</p>}
      {photos.length > 0 && (
        <ul className="photos">
          {photos.map((p) => (
            <li key={p.id}>
              <img src={p.dataUrl} alt="" />
              <select
                aria-label="Welke wand staat op deze foto?"
                value={p.facing ?? ""}
                onChange={(e) => onChange(photos.map((x) => (x.id === p.id ? { ...x, facing: e.target.value || undefined } : x)))}
              >
                <option value="">Kijkt naar…</option>
                {wallIds.map((w) => (
                  <option key={w} value={w}>{wallLabel(w)}</option>
                ))}
              </select>
              <button className="icon" aria-label="Foto verwijderen" onClick={() => onChange(photos.filter((x) => x.id !== p.id))}>×</button>
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
  { angle: 0, label: "→ naar rechts" },
  { angle: 90, label: "↓ naar beneden" },
  { angle: 180, label: "← naar links" },
  { angle: 270, label: "↑ naar boven" },
];
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
      <p className="lead">
        Loop in gedachten langs de muren, met de klok mee. Begin in de hoek linksboven en ga eerst naar rechts.
        De laatste wand terug naar het begin rekenen we zelf uit.
      </p>

      <div className="row wrap">
        <span className="muted small">Begin met:</span>
        {Object.entries(PRESETS).map(([key, p]) => (
          <button
            key={key}
            className="btn ghost small"
            onClick={() => set({ walls: p.walls.map((w) => ({ ...w, id: uid() })) })}
          >
            {p.label}
          </button>
        ))}
      </div>

      <ol className="walls">
        {room.walls.map((w, i) => (
          <li key={w.id}>
            <span className="wall-name">{wallLabel(g.walls[i]?.id ?? String.fromCharCode(65 + i))}</span>
            <Num label="Lengte" value={w.length} onChange={(length) => setWall(w.id, { length })} />
            <label className="num">
              <span>Richting</span>
              <select
                value={isStraight(w.angle) ? String(w.angle) : "schuin"}
                onChange={(e) => setWall(w.id, { angle: e.target.value === "schuin" ? 45 : Number(e.target.value) })}
              >
                {DIRECTIONS.map((d) => (
                  <option key={d.angle} value={d.angle}>{d.label}</option>
                ))}
                <option value="schuin">↘ schuin…</option>
              </select>
            </label>
            {!isStraight(w.angle) && (
              <Num label="Hoek" suffix="°" value={w.angle} onChange={(angle) => setWall(w.id, { angle: ((angle % 360) + 360) % 360 })} />
            )}
            <button
              className="icon"
              aria-label={`Wand ${g.walls[i]?.id} verwijderen`}
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
              sluit automatisch: <strong>{closing.length} cm</strong>
              {!isAxisAligned(closing) && <span className="muted"> (loopt schuin; klopt dat?)</span>}
            </span>
          </li>
        )}
      </ol>
      <div className="row wrap">
        <button className="btn ghost small" onClick={() => set({ walls: [...room.walls, { id: uid(), length: 100, angle: 90 }] })}>
          + Wand
        </button>
        <span className="muted small">
          Hoek: 0° is naar rechts, 90° naar beneden. Eén schuine muur? Laat die als laatste wand, dan klopt ze vanzelf.
        </span>
      </div>
      {shapeError && <p className="error">{shapeError}</p>}

      <div className="dims">
        <Num label="Plafondhoogte" value={room.height} onChange={(height) => set({ height })} />
        <p className="muted small area">Vloeroppervlak: {g.area.toFixed(1)} m²</p>
      </div>

      <h3>Deuren, ramen en radiatoren</h3>
      <p className="muted">Kijk vanuit de kamer naar de wand: de afstand meet je vanaf de linkerhoek.</p>

      {room.openings.map((o) => {
        const err = validateOpening(g, o);
        return (
          <fieldset key={o.id} className="opening">
            <legend>{OPENING_LABELS[o.kind]}</legend>
            <label className="num">
              <span>Wand</span>
              <select value={o.wall} onChange={(e) => setOpening(o.id, { wall: e.target.value })}>
                {g.walls.map((w) => (
                  <option key={w.id} value={w.id}>{wallLabel(w.id)} ({w.length} cm)</option>
                ))}
              </select>
            </label>
            <Num label="Afstand" value={o.offset} onChange={(offset) => setOpening(o.id, { offset })} />
            <Num label="Breedte" value={o.size} onChange={(size) => setOpening(o.id, { size })} />
            {o.kind === "raam" && (
              <Num label="Vensterbank" value={o.sillHeight ?? NaN} onChange={(sillHeight) => setOpening(o.id, { sillHeight: Number.isFinite(sillHeight) ? sillHeight : undefined })} />
            )}
            {o.kind === "deur" && (
              <>
                <label className="num">
                  <span>Scharnier</span>
                  <select value={o.hinge ?? "links"} onChange={(e) => setOpening(o.id, { hinge: e.target.value as Opening["hinge"] })}>
                    <option value="links">Links</option>
                    <option value="rechts">Rechts</option>
                  </select>
                </label>
                <label className="num">
                  <span>Draait</span>
                  <select value={o.swing ?? "binnen"} onChange={(e) => setOpening(o.id, { swing: e.target.value as Opening["swing"] })}>
                    <option value="binnen">Naar binnen</option>
                    <option value="buiten">Naar buiten</option>
                  </select>
                </label>
              </>
            )}
            <button className="icon" aria-label={`${OPENING_LABELS[o.kind]} verwijderen`} onClick={() => set({ openings: room.openings.filter((x) => x.id !== o.id) })}>×</button>
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
            + {OPENING_LABELS[k]}
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
        <p className="lead">Claude bekijkt je foto's en maakt een lijst van wat er nu in de kamer staat. Daarna kies je wat blijft.</p>
        <button className="btn" disabled={!canAnalyze || busy} onClick={onAnalyze}>
          {busy ? <><span className="spinner" /> Foto's bekijken…</> : "Bekijk mijn foto's"}
        </button>
      </div>
    );
  }
  return (
    <div className="step-body">
      <p className="lead"><strong>{analysis.roomType}.</strong> {analysis.description}</p>
      <p className="muted">{analysis.light}</p>
      {analysis.palette.length > 0 && (
        <ul className="palette" aria-label="Kleuren in de kamer">
          {analysis.palette.map((c) => (
            <li key={c} style={{ background: c }} title={c} />
          ))}
        </ul>
      )}
      <h3>Wat blijft staan?</h3>
      {analysis.existing.length === 0 && <p className="muted">Er staan geen meubels op de foto's.</p>}
      <ul className="existing">
        {analysis.existing.map((e) => (
          <li key={e.id}>
            <div>
              <strong>{e.name}</strong>
              <span className="muted"> · ca. {e.widthCm} × {e.depthCm} cm</span>
              <p className="muted small">{e.description}</p>
            </div>
            <div className="toggle" role="group" aria-label={`${e.name}: houden of vervangen`}>
              {[true, false].map((keep) => (
                <button
                  key={String(keep)}
                  aria-pressed={e.keep === keep}
                  onClick={() => onChange({ ...analysis, existing: analysis.existing.map((x) => (x.id === e.id ? { ...x, keep } : x)) })}
                >
                  {keep ? "Houden" : "Vervangen"}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <button className="btn ghost small" disabled={busy} onClick={onAnalyze}>
        {busy ? "Opnieuw bekijken…" : "Foto's opnieuw bekijken"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

const BUDGETS = [500, 1000, 2000, 4000];

export function PrefsStep({ prefs, onChange }: { prefs: Preferences; onChange: (p: Preferences) => void }) {
  const set = (patch: Partial<Preferences>) => onChange({ ...prefs, ...patch });
  return (
    <div className="step-body">
      <h3>Wat wordt het?</h3>
      <div className="chips">
        {PURPOSES.map((p) => (
          <button key={p} aria-pressed={prefs.purpose === p} onClick={() => set({ purpose: p })}>{p}</button>
        ))}
      </div>

      <h3>Stijl</h3>
      <div className="styles">
        {STYLES.map((s) => (
          <button key={s.id} aria-pressed={prefs.styleId === s.id} onClick={() => set({ styleId: s.id })}>
            <strong>{s.label}</strong>
            <span>{s.description}</span>
          </button>
        ))}
      </div>

      <h3>Budget</h3>
      <div className="row wrap bottom">
        <Num label="Maximaal" value={prefs.budget} min={50} suffix="€" onChange={(budget) => set({ budget })} />
        <div className="chips">
          {BUDGETS.map((b) => (
            <button key={b} aria-pressed={prefs.budget === b} onClick={() => set({ budget: b })}>€ {b}</button>
          ))}
        </div>
      </div>

      <label className="field">
        <span>Nog iets dat we moeten weten?</span>
        <textarea
          rows={3}
          placeholder="Bv. veel opbergruimte voor boeken, plaats voor een bureau van 120 cm, kat die aan alles krabt…"
          value={prefs.wishes}
          onChange={(e) => set({ wishes: e.target.value })}
        />
      </label>
    </div>
  );
}
