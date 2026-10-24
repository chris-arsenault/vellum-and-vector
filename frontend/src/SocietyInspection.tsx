import {
  population,
  languageShares,
  languageUse,
  practiceShares,
  type AtlasFeature,
  type World,
  type SocietyMagicPractice,
  type SocietyCommunity,
} from "@atlas/domain";

export function SocietyInspection({
  world,
  feature,
  areaId,
}: {
  world: World;
  feature: AtlasFeature;
  areaId: string;
}) {
  const region = world.societies?.[areaId] ?? world.societies?.[feature.areaId];
  const community = region?.communities.find((c) => c.id === feature.attributes.communityId);
  if (!region || !community) return null;
  const practice = region.magic.find((p) => p.communityId === community.id);
  const urban = community.settlement?.population ?? 0;
  return (
    <details open>
      <summary>People and livelihoods</summary>
      <PoliticalSeat world={world} feature={feature} />
      <SettlementSite feature={feature} />
      <p>
        {Math.round(urban).toLocaleString()} settlement residents · {community.status}
      </p>
      <p>
        {Math.round(population(community) - urban).toLocaleString()} rural residents in the
        surrounding {Math.round(community.areaKm2).toLocaleString()} km². Composition below includes
        both.
      </p>
      <PopulationComposition world={world} community={community} />
      <LinguisticUse world={world} community={community} />
      <p>
        Local support: {Math.round(community.support.capacity).toLocaleString()} people. Farming{" "}
        {Math.round(community.support.farming)}, grazing {Math.round(community.support.grazing)},
        gathering {Math.round(community.support.gathering)}, fishing{" "}
        {Math.round(community.support.fishing)}.
      </p>
      {practice && <PracticeInspection practice={practice} />}
      <OccupationHistory world={world} community={community} />
      <details>
        <summary>Completed human eras</summary>
        <ul>
          {region.history.map((era, i) => (
            <li key={i}>
              {era.id}: {Math.round(era.before).toLocaleString()} →{" "}
              {Math.round(era.after).toLocaleString()} residents across the recorded region;{" "}
              {Math.round(era.migrated).toLocaleString()} migrated across {era.cycles ?? 1} feedback
              cycles. {era.causes.join(" ")}
            </li>
          ))}
        </ul>
      </details>
    </details>
  );
}
function label(world: World, id: string | null) {
  return id ? (world.entities[id]?.name ?? id) : "Unspecified";
}
/** Why the settlement sits where it does: the site class the geography offered its country. */
function SettlementSite({ feature }: { feature: AtlasFeature }) {
  const reason = feature.attributes.siteReason;
  if (typeof reason !== "string") return null;
  return (
    <p>
      {feature.attributes.fortress ? "Fortress site: " : "Site: "}
      {reason}.
    </p>
  );
}
/** A polity's character as published: the practices and languages of the people it holds. */
function polityCharacterLabel(world: World, id: string) {
  const character = world.entities[id]?.attributes.character as
    | { practices: Record<string, number>; languages: number; communities: number }
    | undefined;
  if (!character) return null;
  const practices = Object.entries(character.practices)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, 3)
    .map(([key, share]) => `${key} ${(share * 100).toFixed(0)}%`)
    .join(" · ");
  return `${label(world, id)}: ${practices || "no settled practices"}; ${character.languages} language${character.languages === 1 ? "" : "s"} widely known across ${character.communities} communities`;
}
function PoliticalSeat({ world, feature }: { world: World; feature: AtlasFeature }) {
  if (feature.attributes.settlementRole === "capital") {
    const polities = (feature.attributes.capitalOf ?? []) as string[];
    return (
      <>
        <p>Capital of {polities.map((id) => label(world, id)).join(", ")}</p>
        {polities.map((id) => {
          const character = polityCharacterLabel(world, id);
          return character ? <p key={id}>{character}</p> : null;
        })}
      </>
    );
  }
  if (feature.attributes.settlementRole === "regionalCapital")
    return <p>Regional center of {label(world, feature.attributes.polityId as string)}</p>;
  return null;
}
function PopulationComposition({
  world,
  community,
}: {
  world: World;
  community: SocietyCommunity;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>Culture</th>
          <th>People</th>
          <th>Languages known</th>
          <th>Naming use</th>
          <th>Traditions</th>
          <th>Practices</th>
        </tr>
      </thead>
      <tbody>
        {community.groups.map((g, i) => (
          <tr key={i}>
            <td>{label(world, g.culture)}</td>
            <td>{Math.round(g.count).toLocaleString()}</td>
            <td>{groupLanguageLabel(world, g, "knowledge")}</td>
            <td>{groupLanguageLabel(world, g, "use")}</td>
            <td>{g.religions.map((id) => label(world, id)).join(", ")}</td>
            <td>{practiceLabel(g)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function groupLanguageLabel(
  world: World,
  group: SocietyCommunity["groups"][number],
  channel: "knowledge" | "use"
) {
  return (
    Object.entries(languageShares(group))
      .filter(([, share]) => share[channel] > 0)
      .map(([id, share]) => `${label(world, id)} ${(share[channel] * 100).toFixed(1)}%`)
      .join(" · ") || "Unspecified"
  );
}
/** Livelihood shares and magic practices, heaviest first; the list order already carries it. */
function practiceLabel(group: SocietyCommunity["groups"][number]) {
  const shares = practiceShares(group);
  return (
    group.practices.map((id) => `${id} ${(shares[id] * 100).toFixed(0)}%`).join(" · ") ||
    "Unspecified"
  );
}
function languageUseLabel(world: World, use: Record<string, number>) {
  return (
    Object.entries(use)
      .map(([id, share]) => `${label(world, id)} ${(share * 100).toFixed(1)}%`)
      .join(" · ") || "Unspecified"
  );
}
function LinguisticUse({ world, community }: { world: World; community: SocietyCommunity }) {
  return (
    <div>
      <p>Naming-language use: {languageUseLabel(world, languageUse(community.groups))}</p>
      {community.naming && (
        <p>
          Named in {community.naming.era} using {label(world, community.naming.language)}. The
          established name is retained as language use changes.
        </p>
      )}
    </div>
  );
}
function OccupationHistory({ world, community }: { world: World; community: SocietyCommunity }) {
  return (
    <details>
      <summary>Local population history</summary>
      <table>
        <thead>
          <tr>
            <th>Era / year</th>
            <th>Residents</th>
            <th>Local support</th>
            <th>Settlement</th>
            <th>Occupation</th>
            <th>Naming-language use</th>
          </tr>
        </thead>
        <tbody>
          {community.history?.map((step, i) => (
            <tr key={i}>
              <td>
                {step.era} / {Math.round(step.year)}
              </td>
              <td>{Math.round(step.population).toLocaleString()}</td>
              <td>{Math.round(step.capacity).toLocaleString()}</td>
              <td>{Math.round(step.settlementPopulation).toLocaleString()}</td>
              <td>{step.status}</td>
              <td>{languageUseLabel(world, step.languageUse ?? {})}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
function PracticeInspection({ practice }: { practice: SocietyMagicPractice }) {
  return (
    <dl>
      <dt>Fire cores</dt>
      <dd>
        {practice.coreSupply.toFixed(1)} stored; {practice.coreDeposit.toFixed(1)} in the deposit;{" "}
        {practice.coreUsed.toFixed(1)} consumed
      </dd>
      <dt>Aurora</dt>
      <dd>
        {practice.crystals.toFixed(1)} crystals; {practice.charge.toFixed(1)} charge;{" "}
        {Math.round(practice.readers)} readers; strain {practice.strain.toFixed(2)}
      </dd>
      <dt>Pressure</dt>
      <dd>
        {Math.round(practice.divers)} divers; depth limit {practice.depthLimit} m;{" "}
        {practice.pressureCharge.toFixed(1)} carried charge
      </dd>
    </dl>
  );
}
