# Magic lore bible

![Seven realms on one chart: fire, ice, deep water, forest, salt, veil and a hallowed city around a parchment map](images/banner.webp)

Setting-neutral lore for the seven magic systems in
[magic system candidates](../magic-system-candidates.md). It sits at the level
of a school of magic, not a setting: each entry says what the system is made
of, where the generator finds it, what it does to rock, weather and living
things, how a people uses it and what that costs, and enough lore to make it
feel like one thing rather than a slot. Peoples, gods, places and events are
left to the world author. "Practitioner" means anyone of any kind who works the
system.

The current three are implemented as described in the
[product contract](../product-spec.md#103-magical-generation--fire-aurora-and-pressure).
The extensions and the four new systems are design.

## The seven

| System                          | Medium                           | Epigraph                                                              |
| ------------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| [Fire](magic/fire.md)           | stone, and fallen stone          | _The hearth that can be carried._                                     |
| [Aurora](magic/aurora.md)       | ice                              | _The light that withdrew to leave room, and what it left in the ice._ |
| [Pressure](magic/pressure.md)   | deep water, and the sky above it | _The river too strong to land unbroken._                              |
| [Greenwood](magic/greenwood.md) | sap and groundwater              | _The seed is the same everywhere. The ground decides._                |
| [Salt](magic/salt.md)           | brine                            | _The garden where the water is shown by its absence._                 |
| [Veil](magic/veil.md)           | the tear between two others      | _The post the crossing comes down._                                   |
| [Hallowed](magic/hallowed.md)   | what people keep                 | _The ground on which nothing is harmed._                              |

![A stained-glass compass rose with seven panels, one for each system, around a central map](images/hero.webp)

## The shape of the seven

Each system has a medium, and acts only through it. Fire is in stone, Aurora in
ice, Pressure in deep water, Greenwood in the water inside living things, Salt
in brine, Veil in the tear between two others, Hallowed in what people keep.
None of them is a fuel for another. Where two meet they interfere, and the
interference is itself geography: a thermal rim, a steam fracture, a front of
dying trees, a tear.

Every system costs its practitioner something that the system is made of. Fire
takes flesh, Aurora takes the boundary of the self, Pressure takes presence,
Greenwood takes rootedness, Salt takes the ability to forget, Veil takes the
certainty of where one is, Hallowed takes the freedom to leave.

## How the seven touch

| Meeting              | What the map shows                                     |
| -------------------- | ------------------------------------------------------ |
| Fire / Aurora        | thermal rim of cracked ground, Veil where steep        |
| Fire / Pressure      | steam fractures and a broken coast                     |
| Fire / Greenwood     | rot halo, steam fractures at springs                   |
| Fire / Salt          | burnt-clean ground, the one way to end a Barrow heath  |
| Aurora / Pressure    | breached coast, Veil where steep                       |
| Aurora / Greenwood   | frozen forest front                                    |
| Aurora / Salt        | undeath: preserved dead on the Barrow heath            |
| Pressure / Greenwood | salted coastal springs                                 |
| Greenwood / Salt     | a front of dying trees, Veil where steep               |
| Hallowed / any       | damped inside, piled at the rim                        |
| Veil / any           | closed by Aurora, ruptured by Fire, sealed by Hallowed |

## Adjacent sources

Each system's lore was written against one real-world body of thought chosen
to be near the trope without being the trope, so that the entry would not fall
back on genre defaults. The sources were drawn at random from the pool in
[`lore-pool/pool.txt`](../lore-pool/pool.txt), 385 texts, practices and
concepts in 53 tradition families, with
[`lore-pool/roll.py`](../lore-pool/roll.py). The script rolled three draws
(seeds 338923 to 338925), each giving three candidates per system with no two
systems sharing a family, and one candidate per system was chosen from across
the draws. To reroll:

```
python3 docs/lore-pool/roll.py docs/lore-pool/pool.txt --rolls 3
python3 docs/lore-pool/roll.py docs/lore-pool/pool.txt --seed 338923 --rolls 3
```

The second command reproduces the recorded draw. Nothing from the sources is
setting content; each shaped the structure of its entry's teaching.

| System    | Adjacent source                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fire      | Slavic household religion: the domovoi carried with the live coals to a new house and greeted with bread and salt; Koschei's death nested inside needle, egg and duck ([Domovoy](https://en.wikipedia.org/wiki/Domovoy), [folk account](https://godsandmonsters.info/domovoi/))                                                                                                        |
| Aurora    | Lurianic Kabbalah: tzimtzum, the withdrawal that leaves room for a world; the breaking of the vessels; tikkun as the gathering of sparks, whose completion would end the world as known ([My Jewish Learning](https://www.myjewishlearning.com/article/tikkun-in-lurianic-kabbalah/))                                                                                                  |
| Pressure  | Ganga's descent: a river too strong to land unbroken, caught in Shiva's matted hair, wandering there for ages, released in seven streams; the sage who swallowed her and let her out through his ears ([Bhagiratha](https://en.wikipedia.org/wiki/Bhagiratha), [Valmiki Ramayana](https://www.wisdomlib.org/hinduism/book/the-ramayana-of-valmiki/d/doc423893.html))                   |
| Greenwood | The parable of the sower: one seed on four soils, path, stone, thorns and depth, with the outcome decided by the ground and the teaching framed by the command to listen ([commentary](https://thebiblesays.com/en/commentary/mrk+4:1), [kjvstudy](https://kjvstudy.org/parables/the-sower))                                                                                           |
| Salt      | Karesansui dry landscape gardens: raked gravel standing for absent water, stones set as islands, raked daily, and a layout in which one stone is always hidden from any viewpoint ([Japan Journal](https://www.japanjournal.jp/society/culture/pt20211009394.html), [overview](https://wikipedia.classicistranieri.com/en/articles/j/a/p/Japanese_rock_garden.html))                   |
| Veil      | The Vodou poteau-mitan: the centre post of the peristyle, sometimes a living tree, the axis by which spirits descend to inhabit the faithful for a time, around which the whole rite turns, with the gatekeeper saluted first ([Potomitan](https://en.wikipedia.org/wiki/Potomitan), [glossary](https://www.historymuseum.ca/vodou/wp-content/themes/vodou/images/Vodou_glossary.pdf)) |
| Hallowed  | Jain ahimsa toward one-sensed beings: earth, water, fire, air and plants as living and harmable; mendicants who do not dig, kindle, fan or swim and cover the mouth to protect air-bodies; householders who minimise rather than eliminate harm ([jainqq](https://jainqq.org/explore/000161/50), [herenow4u](https://herenow4u.net/?id=91641))                                         |
