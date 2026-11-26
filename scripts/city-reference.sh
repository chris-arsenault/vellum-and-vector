#!/usr/bin/env bash
# Reference inputs for City and Street development on the shared local atlas.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
atlas=(scripts/local-atlas.sh --built)
reports=.artifacts/local-atlas
shared=${ATLAS_LOCAL_HOME:-$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.artifacts/local-atlas}
action=${1:?choose develop or views}
city=${2:-nishi}
case "$city" in
  nishi) settlement='Nishi Mabasahiro'; parent=Nishi-resident-region
    reference=experiments/Nishi-founded-districts-176ff34c6e0b4cd2ad7ee11ad87a1ba6/trial-1 ;;
  mitsu) settlement=Mitsu; parent=Mitsu-recursive-region-28km
    reference=experiments/Mitsu-court-and-parcel-commons-0dde7f6373ac433b8a80fd263470b1ff/trial-1 ;;
  vila) settlement='Vila Modosaliona'; parent=Vila-recursive-region-32km
    reference=experiments/Vila-refined-catchments-and-commons-fd9790251c8f495eabca171c72a9a03c/trial-1 ;;
  kikuchihara) settlement=Kikuchihara; parent=Kikuchihara-recursive-region-24km
    reference=maps/Kikuchihara-recursive-city ;;
  *) echo "Choose nishi, mitsu, vila or kikuchihara" >&2; exit 2 ;;
esac

have_region() {
  [[ -f "$reports/maps/$1/map.json" || -f "$shared/maps/$1/map.json" ]]
}

region() {
  if ! have_region "$1"; then
    "${atlas[@]}" region --name "$1" --parent "$2" --at "$3" --width "$4"
  fi
}

if [[ "$action" == develop ]]; then
  # Reuse the kept recursive parents. Build missing levels from the reference world.
  if ! have_region "$parent"; then
    case "$city" in
      mitsu)
        region Mitsu-recursive-country-220km Density-world Mitsu 220000
        region Mitsu-recursive-region-72km Mitsu-recursive-country-220km Mitsu 72000
        region "$parent" Mitsu-recursive-region-72km Mitsu 28000 ;;
      vila)
        region Nishi-provision-L1 Density-world 195000,419412 378000
        region Vila-recursive-region-90km Nishi-provision-L1 "$settlement" 90000
        region "$parent" Vila-recursive-region-90km "$settlement" 32000 ;;
      nishi|kikuchihara)
        region Density-L1 Density-world 195000,419412 378000
        region Nishi-resident-region Density-L1 91535.655131,420534.817156 143000
        if [[ "$city" == kikuchihara ]]; then
          region "$parent" Nishi-resident-region "$settlement" 24000
        fi ;;
    esac
  fi
  exec "${atlas[@]}" city --parent "$parent" --at "$settlement" --name "${3:-$city-street-parent}"
fi
[[ "$action" == views ]] || { echo "Choose develop or views" >&2; exit 2; }
input=${3:-$reports/$reference}
if [[ -z "${3:-}" && ! -d "$input" ]]; then input="$shared/$reference"; fi
if [[ ! -d "$input" ]]; then
  echo "Missing $input. Use make local-city CITY=$city to develop a fresh published map." >&2
  exit 1
fi
prepare_views() {
  local folder=$1
  if [[ -f "$folder/map.json" ]] &&
     [[ ! -f "$folder/city-view-features.json" || ! -f "$folder/terrain.tif" || ! -f "$folder/raster-Population.tif" ]]; then
    "${atlas[@]}" city-view-inputs "$(realpath "$folder")"
  fi
}
prepare_views "$input"
args=("$input")
if [[ -n ${4:-} ]]; then
  prepare_views "$4"
  args+=(--compare "$4")
fi
if [[ -n ${5:-} ]]; then args+=(--out "$5"); fi
exec uv run --script scripts/city-views.py "${args[@]}"
