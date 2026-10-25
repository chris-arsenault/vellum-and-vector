import type { ConfluenceEffects, MagicConfluence, MagicSystem } from "@atlas/domain";
import { NumberField as NumberSetting } from "./WorkflowFields";
import { SetupDisclosure } from "./SetupDisclosure";

const effectLabels: Record<keyof ConfluenceEffects, string> = {
  fractureConductance: "Fracture conductance opened · 0–1,000 at full coverage",
  rockResistance: "Rock resistance change at full coverage · negative weakens",
  relief: "Relief roughening · metres at full coverage",
  soilRemoval: "Soil removed · share at full coverage, 0–1",
  coastalForcing: "Coastal forcing added · 0–1,000 at full coverage",
  fog: "Fog forcing · 0–1 at full coverage",
  iceMelt: "Ice removed · metres at full coverage",
  debris: "Collapse debris deposited · metres at full coverage",
  toxicity: "Habitat toxicity · 0–1 at full coverage",
};

function ConfluenceProcess({
  confluence,
  change,
}: {
  confluence: MagicConfluence;
  change: (next: MagicConfluence) => void;
}) {
  return (
    <>
      <details>
        <summary>Process on the ground</summary>
        {(Object.keys(effectLabels) as (keyof ConfluenceEffects)[]).map((key) => (
          <NumberSetting
            key={key}
            fieldKey={`confluence.${confluence.id}.effects.${key}`}
            label={effectLabels[key]}
            value={confluence.effects[key]}
            change={(value) =>
              change({ ...confluence, effects: { ...confluence.effects, [key]: value } })
            }
          />
        ))}
      </details>
      {confluence.hazard && (
        <NumberSetting
          fieldKey={`confluence.${confluence.id}.hazard.rate`}
          label={`${confluence.hazard.kind} · events per year at full coverage`}
          value={confluence.hazard.rate}
          min={0}
          change={(rate) => change({ ...confluence, hazard: { ...confluence.hazard!, rate } })}
        />
      )}
    </>
  );
}
/**
 * The meetings between systems: each is a process of its own with a coverage floor, a strain
 * scale, effects on the ground and a hazard. A meeting is active only while every system it
 * reads is enabled.
 */
export function MagicConfluencesEditor({
  confluences,
  systems,
  change,
}: {
  confluences: MagicConfluence[];
  systems: MagicSystem[];
  change: (confluences: MagicConfluence[]) => void;
}) {
  const update = (next: MagicConfluence) =>
    change(confluences.map((entry) => (entry.id === next.id ? next : entry)));
  return (
    <>
      <h3>Where systems meet</h3>
      <p>
        A meeting takes its share of the ground from the systems that make it and acts there with
        its own process; it never averages them. It holds only while every system it reads takes
        part in generation.
      </p>
      {confluences.map((confluence) => {
        const missing = confluence.systems.filter(
          (id) => !systems.some((system) => system.id === id && system.enabled)
        );
        return (
          <SetupDisclosure
            key={confluence.id}
            title={`${confluence.name} · ${confluence.systems.join(" & ")}${
              missing.length ? ` · waiting on ${missing.join(", ")}` : ""
            }`}
          >
            <label className="check">
              <input
                type="checkbox"
                checked={confluence.enabled}
                onChange={(event) => update({ ...confluence, enabled: event.target.checked })}
              />
              Takes part when its systems do
            </label>
            <NumberSetting
              fieldKey={`confluence.${confluence.id}.floor`}
              label="Coverage each system must reach · 0–1"
              value={confluence.floor}
              min={0}
              max={1}
              change={(floor) => update({ ...confluence, floor })}
            />
            <NumberSetting
              fieldKey={`confluence.${confluence.id}.strainScale`}
              label="Strain scale · how much a sharp front adds"
              value={confluence.strainScale}
              min={0}
              change={(strainScale) => update({ ...confluence, strainScale })}
            />
            <ConfluenceProcess confluence={confluence} change={update} />
          </SetupDisclosure>
        );
      })}
    </>
  );
}
