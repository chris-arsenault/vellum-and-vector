import type { ReactNode } from "react";
import { channelClass, percent, placeSegments, type Segment } from "./surfaceData";

/**
 * The inspection surface: the small set of controls every feature panel is built from.
 * Sections group facts, stats headline them, meters show a value against its room, share
 * bars show a distribution, links jump to related features. Editing stays in the forms.
 */

/** A titled block of the surface; collapsible when its facts are secondary. */
export function Section({
  title,
  meta,
  collapsed,
  children,
}: {
  title: string;
  meta?: ReactNode;
  /** Render as a closed disclosure; absent means always open. */
  collapsed?: boolean;
  children: ReactNode;
}) {
  if (collapsed === undefined)
    return (
      <section className="surface-section">
        <header className="surface-head">
          <h3>{title}</h3>
          {meta && <span className="surface-meta">{meta}</span>}
        </header>
        {children}
      </section>
    );
  return (
    <details className="surface-section" open={!collapsed}>
      <summary className="surface-head">
        <h3>
          <i className="surface-caret" aria-hidden="true" />
          {title}
        </h3>
        {meta && <span className="surface-meta">{meta}</span>}
      </summary>
      {children}
    </details>
  );
}

/** Headline numbers in a row; each stat is a value with a short label under it. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="stat-grid">{children}</div>;
}
export function Stat({ value, label, hint }: { value: ReactNode; label: string; hint?: string }) {
  return (
    <div className="stat" title={hint}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

/** A short status word with a tone. */
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "accent";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** A value against its room: people against capacity, stock against a deposit. */
export function Meter({
  label,
  value,
  max,
  text,
  channel,
}: {
  label: string;
  value: number;
  max: number;
  /** The value text; defaults to a percentage of the maximum. */
  text?: string;
  /** A channel id for the fill colour; defaults to the accent. */
  channel?: string;
}) {
  const share = max > 0 ? value / max : 0;
  const width = Math.min(1, share);
  const tone = share > 1 ? "over" : share > 0.85 ? "near" : "ok";
  return (
    <div
      className="meter"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <div className="meter-head">
        <span>{label}</span>
        <span className="meter-text">{text ?? percent(share)}</span>
      </div>
      <div className="meter-track">
        <i
          className={`meter-fill meter-${tone} ${channel ? channelClass(channel, 0) : "ch-accent"}`}
          style={{ "--w": `${100 * width}%` }}
        />
      </div>
    </div>
  );
}

/**
 * A distribution as one bar, heaviest segment first, with a legend. `total` larger than
 * the segments' sum leaves the remainder empty to show headroom.
 */
export function ShareBar({
  label,
  segments,
  total,
  format = (s) => percent(s.value / (total ?? sum(segments))),
  legend = true,
}: {
  label: string;
  segments: Segment[];
  total?: number;
  /** The legend text for a segment; defaults to its share as a percentage. */
  format?: (segment: Segment) => string;
  legend?: boolean;
}) {
  const placed = placeSegments(segments, total);
  return (
    <div className="share">
      <div className="share-bar" role="img" aria-label={label}>
        {placed.map((s, i) => (
          <i
            key={s.id}
            className={`share-seg ${channelClass(s.id, i)}`}
            title={`${s.label} ${format(s)}`}
            style={{ "--x": `${s.start}%`, "--w": `${s.width}%` }}
          />
        ))}
      </div>
      {legend && (
        <ul className="legend">
          {segments.map((s, i) => (
            <li key={s.id}>
              <i className={`swatch ${channelClass(s.id, i)}`} />
              <span>
                {s.label} {format(s)}
              </span>
            </li>
          ))}
          {!segments.length && <li className="legend-empty">{label}: none</li>}
        </ul>
      )}
    </div>
  );
}
function sum(segments: Segment[]) {
  return segments.reduce((s, x) => s + x.value, 0);
}

/** Jumps to related features: each row selects something else on the map. */
export interface SurfaceLink {
  id: string;
  label: string;
  meta?: ReactNode;
  channel?: string;
  select?: () => void;
}
export function LinkList({ links, empty }: { links: SurfaceLink[]; empty?: string }) {
  if (!links.length) return empty ? <p className="surface-empty">{empty}</p> : null;
  return (
    <ul className="link-list">
      {links.map((link, i) => (
        <li key={link.id}>
          <button
            type="button"
            className="surface-link"
            disabled={!link.select}
            onClick={link.select}
          >
            {link.channel && <i className={`swatch ${channelClass(link.channel, i)}`} />}
            <span className="surface-link-label">{link.label}</span>
            {link.meta && <span className="surface-link-meta">{link.meta}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Label and value pairs for facts that are neither numbers to compare nor shares. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="facts">
      {items.map(([term, detail]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{detail}</dd>
        </div>
      ))}
    </dl>
  );
}
