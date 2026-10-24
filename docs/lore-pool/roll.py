"""Roll adjacent lore sources for the seven magic systems.

Usage: python roll.py POOL [--seed N] [--rolls K] [--per-system M]

Each roll draws M candidates for every system from the pool. Within one roll no
two systems share a tradition family, and no source is drawn twice. The seed
makes a roll reproducible so a chosen draw can be recorded.
"""

import argparse
import random
import sys

SYSTEMS = ["Fire", "Aurora", "Pressure", "Greenwood", "Salt", "Veil", "Hallowed"]


def load(path):
    pool = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            family, tradition, source, hook = (part.strip() for part in line.split("|"))
            pool.append({"family": family, "tradition": tradition, "source": source, "hook": hook})
    return pool


def roll(pool, seed, per_system):
    rng = random.Random(seed)
    remaining = list(pool)
    rng.shuffle(remaining)
    used_families = set()
    draw = {}
    for system in SYSTEMS:
        picks = []
        family = None
        for entry in list(remaining):
            if family is None:
                if entry["family"] in used_families:
                    continue
                family = entry["family"]
            if entry["family"] != family:
                continue
            picks.append(entry)
            remaining.remove(entry)
            if len(picks) == per_system:
                break
        # If the family ran short, top up from any unused family.
        for entry in list(remaining):
            if len(picks) == per_system:
                break
            if entry["family"] in used_families or entry["family"] == family:
                continue
            picks.append(entry)
            remaining.remove(entry)
        used_families.add(family)
        draw[system] = picks
    return draw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pool")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--rolls", type=int, default=3)
    parser.add_argument("--per-system", type=int, default=3)
    args = parser.parse_args()
    pool = load(args.pool)
    families = {entry["family"] for entry in pool}
    print(f"pool: {len(pool)} sources in {len(families)} families\n")
    base = args.seed if args.seed is not None else random.SystemRandom().randrange(1, 10**6)
    for k in range(args.rolls):
        seed = base + k
        print(f"=== roll {k + 1}  seed={seed} ===")
        draw = roll(pool, seed, args.per_system)
        for system, picks in draw.items():
            print(f"{system}:")
            for entry in picks:
                print(f"    [{entry['tradition']}] {entry['source']}  --  {entry['hook']}")
        print()


if __name__ == "__main__":
    sys.exit(main())
