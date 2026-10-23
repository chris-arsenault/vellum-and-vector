import {
  population,
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
  const label = (id: string | null) => (id ? (world.entities[id]?.name ?? id) : "Unspecified");
  return (
    <details open>
      <summary>People and livelihoods</summary>
      <p>
        {Math.round(urban).toLocaleString()} settlement residents · {community.status}
      </p>
      <p>
        {Math.round(population(community) - urban).toLocaleString()} rural residents in the
        surrounding {Math.round(community.areaKm2).toLocaleString()} km². Composition below includes
        both.
      </p>
      <table>
        <thead>
          <tr>
            <th>Culture</th>
            <th>People</th>
            <th>Languages</th>
            <th>Traditions</th>
          </tr>
        </thead>
        <tbody>
          {community.groups.map((g, i) => (
            <tr key={i}>
              <td>{label(g.culture)}</td>
              <td>{Math.round(g.count).toLocaleString()}</td>
              <td>{g.languages.map(label).join(", ")}</td>
              <td>{g.religions.map(label).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Local support: {Math.round(community.support.capacity).toLocaleString()} people. Farming{" "}
        {Math.round(community.support.farming)}, grazing {Math.round(community.support.grazing)},
        gathering {Math.round(community.support.gathering)}, fishing{" "}
        {Math.round(community.support.fishing)}.
      </p>
      {practice && <PracticeInspection practice={practice} />}
      <OccupationHistory community={community} />
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
function OccupationHistory({ community }: { community: SocietyCommunity }) {
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
