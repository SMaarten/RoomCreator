import { useEffect, useRef, useState } from "react";
import { DEFAULT_GEMINI_MODEL } from "../lib/gemini";
import { t, type Key } from "../lib/i18n";
import { catalogLocale, COUNTRIES, currentPosition, nearestStore, STORES } from "../lib/locale";
import type { Settings } from "../lib/types";

interface Props {
  open: boolean;
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

export function SettingsDialog({ open, settings, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(settings);
  const [locating, setLocating] = useState(false);
  const [geoNote, setGeoNote] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
    setGeoNote(null);
  }, [settings, open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  async function findNearest() {
    setLocating(true);
    setGeoNote(null);
    try {
      const pos = await currentPosition();
      const { store, km } = nearestStore(pos.lat, pos.lng);
      setDraft((d) => ({ ...d, storeId: store.id }));
      setGeoNote(t("store.found", { name: store.name, km: Math.round(km) }));
    } catch {
      setGeoNote(t("store.geoFailed"));
    } finally {
      setLocating(false);
    }
  }

  const locale = catalogLocale(draft.storeId, draft.lang);

  return (
    <dialog ref={ref} className="settings" onClose={onClose}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ ...draft, anthropicKey: draft.anthropicKey.trim(), geminiKey: draft.geminiKey.trim() });
        }}
      >
        <h2>{t("settings.title")}</h2>

        <fieldset className="store-pick">
          <legend>{t("store.title")}</legend>
          <div className="row wrap">
            <button type="button" className="btn ghost small" disabled={locating} onClick={findNearest}>
              {locating ? <><span className="spinner" /> {t("store.locating")}</> : t("store.nearest")}
            </button>
          </div>
          <select
            aria-label={t("store.title")}
            value={draft.storeId ?? ""}
            onChange={(e) => {
              setGeoNote(null);
              setDraft({ ...draft, storeId: e.target.value || null });
            }}
          >
            <option value="">{t("store.none")}</option>
            {COUNTRIES.map((cc) => (
              <optgroup key={cc} label={t(`country.${cc}`)}>
                {STORES.filter((s) => s.country === cc).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {geoNote && <p className="small">{geoNote}</p>}
          <p className="muted small">
            {t("store.products", {
              country: t(`country.${locale.country}`),
              lang: t(`langname.${locale.lang}` as Key),
            })}
          </p>
        </fieldset>

        <p className="muted">{t("settings.intro")}</p>

        <label className="field">
          <span>{t("settings.anthropic")}</span>
          <input
            type="password"
            autoComplete="off"
            placeholder="sk-ant-…"
            value={draft.anthropicKey}
            onChange={(e) => setDraft({ ...draft, anthropicKey: e.target.value })}
          />
          <small>
            {t("settings.anthropicHelp")}{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.{" "}
            {t("settings.anthropicCost")}
          </small>
        </label>

        <label className="field">
          <span>{t("settings.gemini")}</span>
          <input
            type="password"
            autoComplete="off"
            placeholder="AIza…"
            value={draft.geminiKey}
            onChange={(e) => setDraft({ ...draft, geminiKey: e.target.value })}
          />
          <small>
            {t("settings.geminiHelp")}{" "}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com</a>.
          </small>
        </label>

        <label className="field">
          <span>{t("settings.geminiModel")}</span>
          <input
            value={draft.geminiModel}
            placeholder={DEFAULT_GEMINI_MODEL}
            onChange={(e) => setDraft({ ...draft, geminiModel: e.target.value })}
          />
          <small>{t("settings.geminiModelHelp")}</small>
        </label>

        <p className="small">
          <a href="admin.html" target="_blank" rel="noreferrer">{t("settings.usage")}</a>
        </p>

        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>{t("settings.cancel")}</button>
          <button type="submit" className="btn">{t("settings.save")}</button>
        </div>
      </form>
    </dialog>
  );
}
