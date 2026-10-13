import { useEffect, useMemo, useState } from "react";
import { FloorPlan } from "./components/FloorPlan";
import { Results } from "./components/Results";
import { SettingsDialog } from "./components/Settings";
import { ExistingStep, PhotosStep, PrefsStep, RoomStep } from "./components/Steps";
import {
  addFeedback,
  analyzeRoom,
  friendlyError,
  runDesign,
  startDesignMessages,
  type DesignSession,
  type Progress,
} from "./lib/claude";
import { DEFAULT_GEMINI_MODEL, renderAfterImage } from "./lib/gemini";
import { buildGeometry, checkLayout, checkRoom, migrateRoom, validateOpening, type PlanPiece } from "./lib/layout";
import { load, remove, save } from "./lib/storage";
import { STYLES, type ChatTurn, type Design, type Photo, type Preferences, type Room, type RoomAnalysis, type Settings } from "./lib/types";

interface Project {
  photos: Photo[];
  room: Room;
  analysis: RoomAnalysis | null;
  prefs: Preferences;
  session: DesignSession | null;
  design: Design | null;
  chat: ChatTurn[];
  afterImage: string | null;
}

const EMPTY: Project = {
  photos: [],
  room: {
    name: "",
    height: 260,
    walls: [
      { id: "w1", length: 400, angle: 0 },
      { id: "w2", length: 350, angle: 90 },
      { id: "w3", length: 400, angle: 180 },
    ],
    openings: [],
  },
  analysis: null,
  prefs: { purpose: "Woonkamer", styleId: "scandinavisch", budget: 1500, wishes: "" },
  session: null,
  design: null,
  chat: [],
  afterImage: null,
};

// Designs saved before alternatives existed.
function migrateDesign(d: Design): Design {
  return { ...d, items: d.items.map((i) => ({ ...i, alternatives: i.alternatives ?? [] })) };
}

const DEFAULT_SETTINGS: Settings = { anthropicKey: "", geminiKey: "", geminiModel: DEFAULT_GEMINI_MODEL };

const STEPS = [
  { title: "Foto's", hint: "Hoe ziet de kamer eruit?" },
  { title: "Afmetingen", hint: "Maten, deuren en ramen" },
  { title: "Wat staat er nu", hint: "Houden of vervangen" },
  { title: "Wensen", hint: "Gebruik, stijl en budget" },
  { title: "Ontwerp", hint: "Plan en boodschappenlijst" },
];

export default function App() {
  const [project, setProject] = useState<Project>(EMPTY);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState<null | "analyze" | "design" | "render">(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [highlight, setHighlight] = useState<string | null>(null);

  // Restore the last project and keys.
  useEffect(() => {
    Promise.all([load<Project>("project"), load<Settings>("settings"), load<number>("step")]).then(([p, s, st]) => {
      if (p) setProject({ ...EMPTY, ...p, room: migrateRoom(p.room), design: p.design && migrateDesign(p.design) });
      if (s) setSettings({ ...DEFAULT_SETTINGS, ...s });
      if (typeof st === "number") setStep(st);
      if (!s?.anthropicKey) setSettingsOpen(true);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => save("project", project), 400);
    return () => clearTimeout(t);
  }, [project, loaded]);
  useEffect(() => {
    if (loaded) save("step", step);
  }, [step, loaded]);

  const update = (patch: Partial<Project>) => setProject((p) => ({ ...p, ...patch }));
  const { photos, room, analysis, prefs, design } = project;

  const geometry = useMemo(() => buildGeometry(room), [room]);
  const roomValid =
    !checkRoom(room, geometry) && room.height >= 150 && room.openings.every((o) => !validateOpening(geometry, o));
  const unlocked = [true, photos.length > 0, photos.length > 0 && roomValid, !!analysis, !!design || busy === "design"];

  const pieces: PlanPiece[] = useMemo(() => {
    if (!design) return [];
    const names = new Map(analysis?.existing.map((e) => [e.id, e.name]));
    return [
      ...design.kept.map((k) => ({ key: `k${k.existingId}`, label: names.get(k.existingId) ?? "Bestaand", placement: k.placement, kind: "kept" as const })),
      ...design.items.flatMap((i, idx) => (i.placement ? [{ key: `n${idx}`, label: i.role, placement: i.placement, kind: "new" as const }] : [])),
    ];
  }, [design, analysis]);
  const issues = useMemo(() => checkLayout(geometry, room, pieces), [geometry, room, pieces]);

  function requireKey(): boolean {
    if (settings.anthropicKey) return true;
    setSettingsOpen(true);
    return false;
  }

  async function analyze() {
    if (!requireKey()) return;
    setBusy("analyze");
    setError(null);
    try {
      const a = await analyzeRoom(settings.anthropicKey, photos, room);
      update({ analysis: a });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  function onProgress(p: Progress) {
    if (p.kind === "search") setLog((l) => [...l, `Zoekt in IKEA: “${p.query}”`]);
    if (p.kind === "found") setLog((l) => l.map((line) => (line === `Zoekt in IKEA: “${p.query}”` ? `${line}: ${p.count} resultaten` : line)));
  }

  async function design_(session: DesignSession, chat: ChatTurn[]) {
    if (!requireKey()) return;
    setBusy("design");
    setError(null);
    setLog([]);
    setStep(4);
    try {
      const res = await runDesign(settings.anthropicKey, session, onProgress);
      const assistant: ChatTurn | null = chat.length ? { role: "assistant", text: `Aangepast: ${res.design.summary}` } : null;
      update({ session: res.session, design: res.design, chat: assistant ? [...chat, assistant] : chat, afterImage: null });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  function startDesign() {
    if (!analysis) return;
    design_({ messages: startDesignMessages(photos, room, analysis, prefs), catalog: {} }, []);
  }

  function feedback(text: string) {
    if (!project.session || !design) return;
    const chat: ChatTurn[] = [...project.chat, { role: "user", text }];
    update({ chat });
    design_(addFeedback(project.session, text, design), chat);
  }

  // Swap an alternative in as the main choice; the old main becomes an alternative.
  function chooseAlternative(itemIdx: number, altIdx: number) {
    if (!design) return;
    const items = design.items.map((item, i) => {
      if (i !== itemIdx) return item;
      const alt = item.alternatives[altIdx];
      const previous = {
        product: item.product,
        note: item.reason,
        width: item.placement?.width ?? 0,
        depth: item.placement?.depth ?? 0,
      };
      return {
        ...item,
        itemNo: alt.product.itemNo,
        product: alt.product,
        reason: alt.note,
        placement: item.placement && {
          ...item.placement,
          width: alt.width > 0 ? alt.width : item.placement.width,
          depth: alt.depth > 0 ? alt.depth : item.placement.depth,
        },
        alternatives: item.alternatives.map((a, j) => (j === altIdx ? previous : a)),
      };
    });
    update({ design: { ...design, items }, afterImage: null });
  }

  async function render() {
    if (!design || !photos[0]) return;
    setBusy("render");
    setError(null);
    try {
      const style = STYLES.find((s) => s.id === prefs.styleId)?.label ?? prefs.styleId;
      const img = await renderAfterImage(settings.geminiKey, settings.geminiModel || DEFAULT_GEMINI_MODEL, photos[0].dataUrl, design, style);
      update({ afterImage: img });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impressie maken mislukt.");
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    if (!confirm("Een nieuwe kamer beginnen? Foto's, maten en het huidige ontwerp worden gewist.")) return;
    setProject(EMPTY);
    setStep(0);
    setLog([]);
    setError(null);
    remove("project");
  }

  // Moving forward from step 3 (wishes) starts the design.
  function next() {
    if (step === 3) return startDesign();
    setStep(step + 1);
  }

  const canNext = busy === null && (step === 3 ? !!analysis : step < 4 && unlocked[step + 1]);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="26" height="26" /><path d="M3 20h12v9" /></svg>
          <span>RoomKreator</span>
        </div>
        <nav className="row">
          <button className="btn ghost small" onClick={reset}>Nieuwe kamer</button>
          <button className="btn ghost small" onClick={() => setSettingsOpen(true)}>Instellingen</button>
        </nav>
      </header>

      <main className="layout">
        <section className="wizard">
          <ol className="stepper">
            {STEPS.map((s, i) => (
              <li key={s.title} className={i === step ? "current" : i < step ? "done" : ""}>
                <button disabled={!unlocked[i] || busy !== null} onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}>
                  <span className="n">{i + 1}</span>
                  <span className="t">{s.title}<small>{s.hint}</small></span>
                </button>
              </li>
            ))}
          </ol>

          <div className="panel">
            <h1>{STEPS[step].title}</h1>
            {step === 0 && <PhotosStep photos={photos} wallIds={geometry.walls.map((w) => w.id)} onChange={(p) => update({ photos: p })} />}
            {step === 1 && <RoomStep room={room} onChange={(r) => update({ room: r })} />}
            {step === 2 && (
              <ExistingStep
                analysis={analysis}
                busy={busy === "analyze"}
                canAnalyze={photos.length > 0 && roomValid}
                onAnalyze={analyze}
                onChange={(a) => update({ analysis: a })}
              />
            )}
            {step === 3 && <PrefsStep prefs={prefs} onChange={(p) => update({ prefs: p })} />}
            {step === 4 && busy === "design" && (
              <div className="step-body working" aria-live="polite">
                <p className="lead"><span className="spinner" /> Claude ontwerpt je kamer en zoekt passende producten. Dit duurt één à drie minuten.</p>
                <ul className="log">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </div>
            )}
            {step === 4 && design && busy !== "design" && (
              <Results
                design={design}
                budget={prefs.budget}
                issues={issues}
                highlight={highlight}
                onHighlight={setHighlight}
                chat={project.chat}
                busy={busy !== null}
                onFeedback={feedback}
                onChooseAlternative={chooseAlternative}
                canRender={!!settings.geminiKey}
                rendering={busy === "render"}
                afterImage={project.afterImage}
                onRender={render}
              />
            )}

            {error && <p className="error" role="alert">{error}</p>}

            {step < 4 && (
              <div className="row end nav">
                {step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}>Terug</button>}
                <button className="btn" disabled={!canNext} onClick={next}>
                  {step === 3 ? (design ? "Maak een nieuw ontwerp" : "Maak mijn ontwerp") : "Volgende"}
                </button>
              </div>
            )}
          </div>
        </section>

        <aside className="drawing" aria-label="Plattegrond">
          <FloorPlan room={room} pieces={step === 4 ? pieces : []} highlight={highlight} onSelect={setHighlight} />
          <p className="legend">
            {step === 4 && design ? (
              <>
                <span className="sw new" /> Nieuw van IKEA <span className="sw kept" /> Bestaand
              </>
            ) : (
              <>Schaal: elk vakje is 50 × 50 cm</>
            )}
          </p>
        </aside>
      </main>

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={(s) => {
          setSettings(s);
          save("settings", s);
          setSettingsOpen(false);
        }}
      />
    </div>
  );
}
