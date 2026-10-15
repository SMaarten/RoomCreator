import { t } from "../lib/i18n";
import type { PlanPiece } from "../lib/layout";
import type { Room } from "../lib/types";
import { FloorPlan } from "./FloorPlan";

// A fixed example room for the hero: 400 × 350 cm, window in A, door in C.
const DEMO_ROOM: Room = {
  name: "",
  height: 260,
  walls: [
    { id: "A", length: 400, angle: 0 },
    { id: "B", length: 350, angle: 90 },
    { id: "C", length: 400, angle: 180 },
  ],
  openings: [
    { id: "w", wall: "A", kind: "raam", offset: 120, size: 140, sillHeight: 90 },
    { id: "r", wall: "A", kind: "radiator", offset: 150, size: 80 },
    { id: "d", wall: "C", kind: "deur", offset: 40, size: 90, hinge: "links", swing: "binnen" },
  ],
};

function demoPieces(): PlanPiece[] {
  const piece = (key: string, label: string, x: number, y: number, width: number, depth: number): PlanPiece => ({
    key,
    label,
    placement: { x, y, width, depth },
    kind: "new",
  });
  return [
    piece("rug", t("demo.rug"), 50, 90, 250, 150),
    piece("sofa", t("demo.sofa"), 30, 250, 200, 90),
    piece("table", t("demo.table"), 125, 150, 100, 50),
    piece("armchair", t("demo.armchair"), 310, 120, 80, 80),
    piece("bookcase", t("demo.bookcase"), 4, 100, 40, 120),
  ];
}

export function Hero({ hasProject }: { hasProject: boolean }) {
  return (
    <section className="hero" id="top">
      <div className="hero-copy">
        <h1>{t("hero.title")}</h1>
        <p className="hero-lead">{t("hero.lead")}</p>
        <div className="hero-actions">
          <a className="btn tape" href="#studio">{hasProject ? t("hero.continue") : t("hero.start")}</a>
          <a className="hero-link" href="#how">{t("hero.how")}</a>
        </div>
        <p className="hero-note">{t("hero.note")}</p>
      </div>
      <figure className="hero-plan">
        <FloorPlan room={DEMO_ROOM} pieces={demoPieces()} />
        <figcaption>{t("hero.caption")}</figcaption>
      </figure>
    </section>
  );
}

export function HowItWorks() {
  const steps = [1, 2, 3, 4] as const;
  return (
    <section className="how" id="how" aria-labelledby="how-title">
      <h2 id="how-title">{t("how.title")}</h2>
      <ol>
        {steps.map((n) => (
          <li key={n}>
            <span className="how-n" aria-hidden="true">{n}</span>
            <h3>{t(`how.${n}.t`)}</h3>
            <p>{t(`how.${n}.d`)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p className="brandmark">RoomKreator</p>
      <p>{t("footer.privacy")}</p>
      <p className="legal">{t("footer.disclaimer")}</p>
    </footer>
  );
}
