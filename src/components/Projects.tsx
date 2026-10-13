import { useEffect, useRef, useState } from "react";
import { getLang, INTL_LOCALE, t } from "../lib/i18n";
import { formatEuro } from "../lib/ikea";
import { listProjects, type ProjectMeta } from "../lib/projects";

interface Props {
  open: boolean;
  currentId: string;
  onClose: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onSaveCopy: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  /** Bumped by the parent whenever the list may have changed. */
  version: number;
}

export function ProjectsDialog(props: Props) {
  const { open, currentId, onClose, onOpen, onNew, onSaveCopy, onRename, onDelete, onExport, onImport, version } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [list, setList] = useState<ProjectMeta[]>([]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (open) listProjects().then(setList);
  }, [open, version]);

  const date = (ms: number) =>
    new Intl.DateTimeFormat(INTL_LOCALE[getLang()], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(ms);

  return (
    <dialog ref={ref} className="settings projects" onClose={onClose}>
      <h2>{t("projects.title")}</h2>

      <div className="row wrap">
        <button className="btn small" onClick={onNew}>{t("projects.new")}</button>
        <button className="btn ghost small" onClick={onSaveCopy}>{t("projects.saveCopy")}</button>
      </div>

      {list.length === 0 && <p className="muted">{t("projects.empty")}</p>}
      <ul className="project-list">
        {list.map((p) => {
          const current = p.id === currentId;
          return (
            <li key={p.id} className={current ? "current" : ""}>
              <div className="project-info">
                <strong>{p.name}</strong>
                {current && <span className="badge">{t("projects.current")}</span>}
                <span className="muted small">
                  {t("projects.updated", { date: date(p.updatedAt) })}.{" "}
                  {p.hasDesign ? t("projects.summary", { n: p.itemCount, total: formatEuro(p.total) }) : t("projects.noDesign")}
                </span>
              </div>
              <div className="project-actions">
                {!current && (
                  <button className="btn ghost small" onClick={() => onOpen(p.id)}>{t("projects.open")}</button>
                )}
                <button
                  className="link-btn"
                  onClick={() => {
                    const name = prompt(t("projects.renamePrompt"), p.name)?.trim();
                    if (name) onRename(p.id, name);
                  }}
                >
                  {t("projects.rename")}
                </button>
                <button
                  className="link-btn danger"
                  onClick={() => confirm(t("projects.confirmDelete", { name: p.name })) && onDelete(p.id)}
                >
                  {t("projects.delete")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="muted small">{t("projects.storageNote")}</p>
      <div className="row wrap">
        <button className="btn ghost small" onClick={onExport}>{t("projects.export")}</button>
        <button className="btn ghost small" onClick={() => fileRef.current?.click()}>{t("projects.import")}</button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="row end">
        <button className="btn ghost" onClick={onClose}>{t("projects.close")}</button>
      </div>
    </dialog>
  );
}
