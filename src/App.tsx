import { useEffect, useMemo, useRef, useState } from "react";
import { FloorPlan } from "./components/FloorPlan";
import { Hero, HowItWorks, SiteFooter } from "./components/Landing";
import { ProjectsDialog } from "./components/Projects";
import { Results } from "./components/Results";
import { SettingsDialog } from "./components/Settings";
import { ShoppingList } from "./components/ShoppingList";
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
import { browserLang, LANGS, setLang, t, type Key, type Lang } from "./lib/i18n";
import { buildGeometry, checkLayout, checkRoom, validateOpening, type PlanPiece } from "./lib/layout";
import { catalogLocale, DEFAULT_LOCALE, findStore } from "./lib/locale";
import {
  deleteProject,
  emptyProject,
  exportProject,
  importProject,
  listProjects,
  loadProject,
  newId,
  openInitialProject,
  saveProject,
  setCurrentProjectId,
} from "./lib/projects";
import { load, save } from "./lib/storage";
import type { UsageKind } from "./lib/usage";
import { styleLabel, type ChatTurn, type Project, type Settings } from "./lib/types";

const DEFAULT_SETTINGS: Settings = {
  anthropicKey: "",
  geminiKey: "",
  geminiModel: DEFAULT_GEMINI_MODEL,
  lang: "nl",
  storeId: null,
};

const STEPS: { title: Key; hint: Key; heading?: Key }[] = [
  { title: "step.photos", hint: "step.photos.hint" },
  { title: "step.room", hint: "step.room.hint" },
  { title: "step.existing", hint: "step.existing.hint" },
  { title: "step.prefs", hint: "step.prefs.hint" },
  { title: "step.design", hint: "step.design.hint" },
  { title: "step.list", hint: "step.list.hint", heading: "step.list.heading" },
];

const startStep = (p: Project) => (p.design ? 4 : 0);

export default function App() {
  const [project, setProject] = useState<Project>(() => emptyProject());
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projectsVersion, setProjectsVersion] = useState(0);
  const [busy, setBusy] = useState<null | "analyze" | "design" | "render">(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [renderPhotoId, setRenderPhotoId] = useState<string | null>(null);
  const [pastHero, setPastHero] = useState(false);
  const studioRef = useRef<HTMLDivElement>(null);
  const firstStep = useRef(true);

  // The translation module reads this on every t() call during render.
  setLang(settings.lang);

  // Restore settings and the last open project.
  useEffect(() => {
    Promise.all([load<Settings>("settings"), openInitialProject()]).then(([s, p]) => {
      const merged = { ...DEFAULT_SETTINGS, lang: browserLang(), ...s };
      setLang(merged.lang);
      setSettings(merged);
      setProject(p);
      setStep(startStep(p));
      setCurrentProjectId(p.id);
      setLoaded(true);
    });
  }, []);

  // The header sits on the blue hero first, then turns solid once the hero is behind it.
  useEffect(() => {
    const hero = document.getElementById("top");
    if (!hero) return;
    const io = new IntersectionObserver(([e]) => setPastHero(!e.isIntersecting), { rootMargin: "-64px 0px 0px 0px" });
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  // Moving to another step brings the top of the studio back into view.
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    const el = studioRef.current;
    if (!el || el.getBoundingClientRect().top >= 0) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  }, [step]);

  // Auto-save the open project.
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => saveProject(project).then(() => setProjectsVersion((v) => v + 1)), 400);
    return () => clearTimeout(timer);
  }, [project, loaded]);

  const update = (patch: Partial<Project>) => setProject((p) => ({ ...p, ...patch, updatedAt: Date.now() }));
  const saveSettings = (s: Settings) => {
    setSettings(s);
    save("settings", s);
  };
  const { photos, room, analysis, prefs, design } = project;

  const geometry = useMemo(() => buildGeometry(room), [room]);
  const roomValid =
    !checkRoom(room, geometry) && room.height >= 150 && room.openings.every((o) => !validateOpening(geometry, o));
  const unlocked = [true, photos.length > 0, photos.length > 0 && roomValid, !!analysis, !!design || busy === "design", !!design && busy !== "design"];

  const pieces: PlanPiece[] = useMemo(() => {
    if (!design) return [];
    const names = new Map(analysis?.existing.map((e) => [e.id, e.name]));
    return [
      ...design.kept.map((k) => ({ key: `k${k.existingId}`, label: names.get(k.existingId) ?? t("existing.fallback"), placement: k.placement, kind: "kept" as const })),
      ...design.items.flatMap((i, idx) => (i.placement && !i.removed ? [{ key: `n${idx}`, label: i.role, placement: i.placement, kind: "new" as const }] : [])),
    ];
  }, [design, analysis, settings.lang]);
  const issues = useMemo(() => checkLayout(geometry, room, pieces), [geometry, room, pieces, settings.lang]);

  const currentLocale = catalogLocale(settings.storeId, settings.lang);
  const designLocale = design?.locale ?? DEFAULT_LOCALE;
  const catalogNote =
    design && designLocale.country !== currentLocale.country
      ? t("catalog.otherCountry", { country: t(`country.${designLocale.country}`) })
      : null;
  // Pick-route store: the project's choice, else the preferred store if it sells these products.
  const preferred = findStore(settings.storeId);
  const listStoreId = project.storeId ?? (preferred?.country === designLocale.country ? preferred.id : null);

  const usageMeta = (kind: UsageKind) => ({ projectId: project.id, projectName: project.name, kind, runId: newId() });

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
      const a = await analyzeRoom(settings.anthropicKey, photos, room, settings.lang, usageMeta("analyse"));
      update({ analysis: a });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  function onProgress(p: Progress) {
    const line = t("log.search", { q: p.kind === "thinking" ? "" : p.query });
    if (p.kind === "search") setLog((l) => [...l, line]);
    if (p.kind === "found") setLog((l) => l.map((x) => (x === line ? `${x}: ${t("log.found", { n: p.count })}` : x)));
  }

  async function design_(session: DesignSession, chat: ChatTurn[]) {
    if (!requireKey()) return;
    setBusy("design");
    setError(null);
    setLog([]);
    setStep(4);
    try {
      const res = await runDesign(settings.anthropicKey, session, onProgress, usageMeta(chat.length ? "bijsturen" : "ontwerp"));
      const assistant: ChatTurn | null = chat.length ? { role: "assistant", text: t("chat.adjusted", { summary: res.design.summary }) } : null;
      update({ session: res.session, design: res.design, chat: assistant ? [...chat, assistant] : chat, afterImage: null });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  function startDesign() {
    if (!analysis) return;
    design_(
      {
        messages: startDesignMessages(photos, room, analysis, prefs),
        catalog: {},
        lang: settings.lang,
        locale: currentLocale,
      },
      [],
    );
  }

  function feedback(text: string) {
    if (!project.session || !design) return;
    const chat: ChatTurn[] = [...project.chat, { role: "user", text }];
    update({ chat });
    design_(addFeedback(project.session, text, design, settings.lang), chat);
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

  function toggleRemoved(itemIdx: number) {
    if (!design) return;
    const items = design.items.map((item, i) => (i === itemIdx ? { ...item, removed: !item.removed } : item));
    update({ design: { ...design, items }, afterImage: null });
  }

  // Base photo for the impression: the chosen one, else the first that has a direction.
  const renderPhoto = photos.find((p) => p.id === renderPhotoId) ?? photos.find((p) => p.facing) ?? photos[0];

  async function render() {
    if (!design || !renderPhoto) return;
    setBusy("render");
    setError(null);
    try {
      const img = await renderAfterImage(
        settings.geminiKey,
        settings.geminiModel || DEFAULT_GEMINI_MODEL,
        { photo: renderPhoto, design, room, analysis, styleLabel: styleLabel(prefs.styleId) },
        usageMeta("impressie"),
      );
      update({ afterImage: img });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("after.failed"));
    } finally {
      setBusy(null);
    }
  }

  // ---- projects ----

  async function switchTo(p: Project) {
    await saveProject(project);
    setProject(p);
    setStep(startStep(p));
    setLog([]);
    setError(null);
    setHighlight(null);
    await setCurrentProjectId(p.id);
    setProjectsVersion((v) => v + 1);
  }

  async function openProject(id: string) {
    const p = await loadProject(id);
    if (p) {
      await switchTo(p);
      setProjectsOpen(false);
    }
  }

  async function newProject() {
    const p = emptyProject();
    await saveProject(p);
    await switchTo(p);
    setProjectsOpen(false);
  }

  async function saveCopy() {
    const now = Date.now();
    const copy: Project = { ...project, id: newId(), name: t("project.copyName", { name: project.name }), createdAt: now, updatedAt: now };
    await saveProject(copy);
    await switchTo(copy);
  }

  async function renameProject(id: string, name: string) {
    if (id === project.id) {
      update({ name });
      return;
    }
    const p = await loadProject(id);
    if (p) {
      await saveProject({ ...p, name, updatedAt: Date.now() });
      setProjectsVersion((v) => v + 1);
    }
  }

  async function removeProject(id: string) {
    await deleteProject(id);
    if (id === project.id) {
      const next = (await listProjects())[0];
      const p = (next && (await loadProject(next.id))) || emptyProject();
      setProject(p);
      setStep(startStep(p));
      await setCurrentProjectId(p.id);
    }
    setProjectsVersion((v) => v + 1);
  }

  async function importFile(file: File) {
    try {
      const p = await importProject(file);
      await switchTo(p);
      setProjectsOpen(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : t("projects.importError"));
    }
  }

  // Moving forward from step 3 (wishes) starts the design.
  function next() {
    if (step === 3) return startDesign();
    setStep(step + 1);
  }

  const canNext = busy === null && (step === 3 ? !!analysis : step < 4 && unlocked[step + 1]);

  return (
    <div className="app">
      <header className="top" data-over={pastHero ? "page" : "hero"}>
        <a className="brand" href="#top">
          <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="26" height="26" /><path d="M3 20h12v9" /></svg>
          <span>RoomKreator</span>
        </a>
        <nav className="site-nav" aria-label="RoomKreator">
          <a href="#how">{t("nav.how")}</a>
          <a href="#studio">{t("nav.studio")}</a>
        </nav>
        <div className="row tools">
          <div className="lang-switch" role="group" aria-label={t("nav.language")}>
            {LANGS.map((l: Lang) => (
              <button
                key={l}
                aria-pressed={settings.lang === l}
                lang={l}
                onClick={() => saveSettings({ ...settings, lang: l })}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button className="btn ghost small" onClick={() => setProjectsOpen(true)}>{t("nav.projects")}</button>
          <button className="btn ghost small" onClick={() => setSettingsOpen(true)}>{t("nav.settings")}</button>
        </div>
      </header>

      <main>
        <Hero hasProject={photos.length > 0 || !!design} />
        <HowItWorks />

        <section className="studio" id="studio" aria-labelledby="studio-title">
          <div className="studio-head" ref={studioRef}>
            <h2 id="studio-title" className="studio-title">{t("studio.title")}</h2>
            <div className="project-bar">
              <label className="project-name">
                <span className="sr-only">{t("project.nameLabel")}</span>
                <input
                  value={project.name}
                  aria-label={t("project.nameLabel")}
                  onChange={(e) => update({ name: e.target.value })}
                  onBlur={() => !project.name.trim() && update({ name: t("project.defaultName") })}
                />
              </label>
              <span className="muted small">{t("project.saved")}</span>
            </div>
          </div>

          <div className="stepper-bar">
            <ol className="stepper">
              {STEPS.map((s, i) => (
                <li key={s.title} className={i === step ? "current" : i < step ? "done" : ""}>
                  <button disabled={!unlocked[i] || busy !== null} onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}>
                    <span className="n">{i + 1}</span>
                    <span className="t">{t(s.title)}<small>{t(s.hint)}</small></span>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <div className="layout">
        <section className="wizard">
          <div className="panel">
            <h2 className="panel-title">{t(STEPS[step].heading ?? STEPS[step].title)}</h2>
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
            {step === 3 && <PrefsStep key={project.id} prefs={prefs} onChange={(p) => update({ prefs: p })} />}
            {step === 4 && busy === "design" && (
              <div className="step-body working" aria-live="polite">
                <p className="lead"><span className="spinner" /> {t("working.lead")}</p>
                <ul className="log">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </div>
            )}
            {step === 4 && design && busy !== "design" && (
              <Results
                design={design}
                budget={prefs.budget}
                issues={issues}
                catalogNote={catalogNote}
                highlight={highlight}
                onHighlight={setHighlight}
                chat={project.chat}
                busy={busy !== null}
                onFeedback={feedback}
                onChooseAlternative={chooseAlternative}
                onToggleRemoved={toggleRemoved}
                onConfirm={() => setStep(5)}
                canRender={!!settings.geminiKey}
                rendering={busy === "render"}
                afterImage={project.afterImage}
                onRender={render}
                photos={photos}
                wallIds={geometry.walls.map((w) => w.id)}
                renderPhotoId={renderPhoto?.id ?? null}
                onPickPhoto={setRenderPhotoId}
                onSetFacing={(id, facing) => update({ photos: photos.map((p) => (p.id === id ? { ...p, facing } : p)) })}
              />
            )}

            {step === 5 && design && (
              <ShoppingList
                items={design.items.filter((i) => !i.removed)}
                locale={designLocale}
                storeId={listStoreId}
                onStoreChange={(storeId) => update({ storeId })}
              />
            )}

            {error && <p className="error" role="alert">{error}</p>}

            {step === 5 && (
              <div className="row end nav no-print">
                <button className="btn ghost" onClick={() => setStep(4)}>{t("nav.backToDesign")}</button>
              </div>
            )}

            {step < 4 && (
              <div className="row end nav">
                {step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}>{t("nav.back")}</button>}
                <button className="btn" disabled={!canNext} onClick={next}>
                  {step === 3 ? (design ? t("nav.makeNewDesign") : t("nav.makeDesign")) : t("nav.next")}
                </button>
              </div>
            )}
          </div>
        </section>

        <aside className="drawing" aria-label={t("plan.label")}>
          <FloorPlan room={room} pieces={step >= 4 ? pieces : []} highlight={highlight} onSelect={setHighlight} />
          <p className="legend">
            {step >= 4 && design ? (
              <>
                <span className="sw new" /> {t("legend.new")} <span className="sw kept" /> {t("legend.kept")}
              </>
            ) : (
              <>{t("legend.scale")}</>
            )}
          </p>
        </aside>
          </div>
        </section>
      </main>

      <SiteFooter />

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={(s) => {
          saveSettings(s);
          setSettingsOpen(false);
        }}
      />
      <ProjectsDialog
        open={projectsOpen}
        currentId={project.id}
        version={projectsVersion}
        onClose={() => setProjectsOpen(false)}
        onOpen={openProject}
        onNew={newProject}
        onSaveCopy={saveCopy}
        onRename={renameProject}
        onDelete={removeProject}
        onExport={() => exportProject(project)}
        onImport={importFile}
      />
    </div>
  );
}
