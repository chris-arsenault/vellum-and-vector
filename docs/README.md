# Documentation

| Document                                        | Contents                                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [Product contract](product-spec.md)             | Required behavior: maps, generation, magic, society, regions, inspection and presentation           |
| [Generation workflows](generation-workflows.md) | How world and regional generation work: processes, epochs, physical, ecology, magic, society        |
| [Generation modules](generation-modules.md)     | Feature modules, recipes, process contracts, validity ledger and publication                        |
| [Backlog](backlog.md)                           | Open product and generation work                                                                    |
| [Magic lore](lore/magic.md)                     | Character, practice, cost and lore of the seven magic systems; one page per system in `lore/magic/` |
| [Lore pool](lore-pool/roll.py)                  | Script and source pool for rolling adjacent lore for the magic systems                              |

## Architecture decisions

| ADR                                                                  | Decision                                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [0001](adr/0001-spatial-authority.md)                                | One spatial model for progressive world authoring                             |
| [0002](adr/0002-relational-spatial-storage.md)                       | Relational storage and Ahara integration (superseded by 0003)                 |
| [0003](adr/0003-frontend-session.md)                                 | Browser-only workspace: catalog, numerical coverage, worker and saves         |
| [0004](adr/0004-coupling-through-each-systems-medium.md)             | Pillars couple through each system's own medium                               |
| [0005](adr/0005-scale-contract.md)                                   | Realized, latent and absent; significance judged at each map's scale          |
| [0006](adr/0006-landmarks-are-injected-causes.md)                    | Major landmarks are injected causes with a guaranteed signature               |
| [0007](adr/0007-magic-systems-are-materials.md)                      | Magic systems are materials the world carries                                 |
| [0008](adr/0008-regional-refinement-is-conditioned-amplification.md) | Regional refinement is a bidirectional, multi-pass process on the one lattice |
| [0009](adr/0009-named-entities-persist-and-cells-are-shares.md)      | Named entities persist and may move; a coarse cell is a share of its children |

Files named `*-PLAN.md` in this directory are working copies of open plans and
are deleted when their plan closes; see the
[documentation rules](../AGENTS.md#documentation).
