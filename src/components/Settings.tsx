import { useEffect, useRef, useState } from "react";
import type { Settings } from "../lib/types";
import { DEFAULT_GEMINI_MODEL } from "../lib/gemini";

interface Props {
  open: boolean;
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

export function SettingsDialog({ open, settings, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(settings);

  useEffect(() => setDraft(settings), [settings, open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="settings" onClose={onClose}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ ...draft, anthropicKey: draft.anthropicKey.trim(), geminiKey: draft.geminiKey.trim() });
        }}
      >
        <h2>Instellingen</h2>
        <p className="muted">
          Je sleutels blijven in deze browser. Ze gaan rechtstreeks naar Anthropic en Google, nergens anders heen.
          Gebruik deze pagina niet met je sleutels op een gedeelde computer.
        </p>

        <label className="field">
          <span>Anthropic API-sleutel</span>
          <input
            type="password"
            autoComplete="off"
            placeholder="sk-ant-…"
            value={draft.anthropicKey}
            onChange={(e) => setDraft({ ...draft, anthropicKey: e.target.value })}
          />
          <small>
            Nodig voor de analyse en het ontwerp. Maak er een aan op{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.
            Een ontwerp kost doorgaans enkele tientallen eurocent.
          </small>
        </label>

        <label className="field">
          <span>Gemini API-sleutel (optioneel)</span>
          <input
            type="password"
            autoComplete="off"
            placeholder="AIza…"
            value={draft.geminiKey}
            onChange={(e) => setDraft({ ...draft, geminiKey: e.target.value })}
          />
          <small>
            Voor de fotorealistische "na"-foto. Aanmaken op{" "}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com</a>.
          </small>
        </label>

        <label className="field">
          <span>Gemini-beeldmodel</span>
          <input
            value={draft.geminiModel}
            placeholder={DEFAULT_GEMINI_MODEL}
            onChange={(e) => setDraft({ ...draft, geminiModel: e.target.value })}
          />
        </label>

        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Annuleren</button>
          <button type="submit" className="btn">Opslaan</button>
        </div>
      </form>
    </dialog>
  );
}
