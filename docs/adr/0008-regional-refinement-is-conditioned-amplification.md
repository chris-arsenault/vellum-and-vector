# 0008 — Regional refinement is conditioned amplification

User direction recorded 2026-10-29 to 2026-10-31; adopted 2026-10-31. Applies to
independent regional maps under [ADR 0005](0005-scale-contract.md) and the
dedicated regional refinement correction in the
[product contract](../product-spec.md).

## Decision

**The captured parent is the specification.** Its coastline, ranges, rivers,
lakes and cover classes are what a refined map keeps. Refinement adds the next
scale of structure; it does not re-derive the parent's facts with different
classifiers, and it never constrains or validates against parent heights.

**Terrain develops by landscape evolution.** The captured surface is sampled,
smoothed to remove the parent's interpolation creases, and given sub-parent
roughness scaled by local parent relief. An implicit stream-power incision and
hillslope-diffusion relaxation (`refinement/landscape.ts`) is then pulled toward
that target. Ridges, summits, cols and branching valleys emerge from the
drainage network. Erodibility follows rock, fracture and runoff, so dry or hard
ground dissects less. The relaxation is numerical and never advances world time.

**Pits drain unless a basin is captured.** Every closed depression is filled
during and after the relaxation except basins the parent held as lakes, and
substantial new basins a later magical change makes. Noise never creates a lake.

**Rivers are a map-scale generalization.** A mapped stream drains a catchment
measured in this map's own samples at reference runoff, so every refinement
level shows a similar density while dry country shows fewer streams. A channel
must gather water from wider than a strip, and short headwaters are not drawn.
Each river is one feature from its source to the larger river it joins. A
captured river crossing the frame edge enters with its captured discharge.

**Cover keeps its captured class.** A cell departs from the captured class only
where a resolved feature changes it: cold new relief, a river floodplain, a
coastal flat, steep bare ground or a lake. Class boundaries are displaced
smoothly rather than following parent sample squares. No patch noise is applied.

## Consequences

Refinement output stays recognizably the parent's region while gaining relief and
drainage detail. Thresholds act on developed structure, not on noise, so lake,
river and cover counts no longer track the noise amplitude. The relaxation costs a
priority flood per step on the regional grid; it replaces the earlier noise,
incision and pit-settling passes rather than adding to them.
