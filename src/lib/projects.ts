// Several named projects, each stored under its own key, plus a small index
// for the project list. Export/import moves a project between browsers.

import { t } from "./i18n";
import { migrateRoom } from "./layout";
import { load, remove, save } from "./storage";
import { PURPOSES, type Design, type Preferences, type Project } from "./types";

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  itemCount: number;
  total: number;
  hasDesign: boolean;
}

const INDEX = "projects";
const CURRENT = "currentProject";
const key = (id: string) => `project:${id}`;

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function emptyProject(name = t("project.defaultName")): Project {
  const now = Date.now();
  return {
    id: newId(),
    name,
    createdAt: now,
    updatedAt: now,
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
    prefs: { purpose: "woonkamer", styleId: "scandinavisch", budget: 1500, budgetNote: "", wishes: "" },
    session: null,
    design: null,
    chat: [],
    afterImage: null,
    storeId: null,
  };
}

function metaOf(p: Project): ProjectMeta {
  const items = p.design?.items.filter((i) => !i.removed) ?? [];
  return {
    id: p.id,
    name: p.name,
    updatedAt: p.updatedAt,
    itemCount: items.length,
    total: items.reduce((s, i) => s + i.product.price * i.quantity, 0),
    hasDesign: !!p.design,
  };
}

// Earlier versions stored purposes as Dutch labels and had no budget note.
function migratePrefs(p: Partial<Preferences> & Record<string, any>): Preferences {
  const base = emptyProject().prefs;
  let purpose = String(p.purpose ?? base.purpose);
  if (!(PURPOSES as readonly string[]).includes(purpose)) {
    const lower = purpose.toLowerCase();
    purpose = PURPOSES.find((id) => lower.startsWith(id.slice(0, 5))) ?? "woonkamer";
  }
  return { ...base, ...p, purpose, budgetNote: p.budgetNote ?? "" };
}

function migrateDesign(d: Design): Design {
  return { ...d, items: d.items.map((i) => ({ ...i, alternatives: i.alternatives ?? [] })) };
}

export function normalize(raw: any): Project {
  const base = emptyProject();
  return {
    ...base,
    ...raw,
    id: raw.id ?? base.id,
    name: raw.name || base.name,
    room: migrateRoom(raw.room ?? base.room),
    prefs: migratePrefs(raw.prefs ?? {}),
    design: raw.design ? migrateDesign(raw.design) : null,
  };
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const index = (await load<ProjectMeta[]>(INDEX)) ?? [];
  return [...index].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const raw = await load<any>(key(id));
  return raw ? normalize(raw) : undefined;
}

export async function saveProject(p: Project): Promise<void> {
  await save(key(p.id), p);
  const index = (await load<ProjectMeta[]>(INDEX)) ?? [];
  await save(INDEX, [...index.filter((m) => m.id !== p.id), metaOf(p)]);
}

export async function deleteProject(id: string): Promise<void> {
  await remove(key(id));
  const index = (await load<ProjectMeta[]>(INDEX)) ?? [];
  await save(INDEX, index.filter((m) => m.id !== id));
}

export async function currentProjectId(): Promise<string | undefined> {
  return load<string>(CURRENT);
}

export function setCurrentProjectId(id: string) {
  return save(CURRENT, id);
}

/**
 * Open the last project. Before projects existed there was a single
 * "project" key; that becomes the first named project.
 */
export async function openInitialProject(): Promise<Project> {
  const id = await currentProjectId();
  if (id) {
    const p = await loadProject(id);
    if (p) return p;
  }
  const legacy = await load<any>("project");
  if (legacy) {
    const p = normalize({ ...legacy, id: newId(), name: t("project.defaultName"), createdAt: Date.now(), updatedAt: Date.now() });
    await saveProject(p);
    await setCurrentProjectId(p.id);
    await remove("project");
    return p;
  }
  const latest = (await listProjects())[0];
  if (latest) {
    const p = await loadProject(latest.id);
    if (p) return p;
  }
  return emptyProject();
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

const FILE_FORMAT = "roomkreator-project";

export function exportProject(p: Project) {
  const blob = new Blob([JSON.stringify({ format: FILE_FORMAT, version: 1, project: p })], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${p.name.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "project"}.roomkreator.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Reads an exported file; the project gets a new id so it never overwrites one. */
export async function importProject(file: File): Promise<Project> {
  let data: any;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error(t("projects.importError"));
  }
  if (data?.format !== FILE_FORMAT || !data.project?.room) throw new Error(t("projects.importError"));
  const p = normalize({ ...data.project, id: newId(), updatedAt: Date.now() });
  await saveProject(p);
  return p;
}
