#!/usr/bin/env bash
# Every RAPM file the season stats page reads (Nov 25, Luka): each single season since 2020-21 (penalty by cross-validation) and
# every range of seasons (penalty 3000, what the cross-validation picks for multi-season fits). ONLY_CUR=1 redoes just the ones
# that include this season (the nightly run).
#   NBA_DIR=nba-data RAPM_CACHE=/tmp/rapm-cache bash scripts/rapm-all.sh
set -e
CUR=${CUR_SEASON:-$(node --input-type=module -e "import('./scripts/season.mjs').then(m=>console.log(m.CUR_SEASON))")}; export CUR_SEASON=$CUR
S=(); y=2020; while :; do s="$y-$(printf %02d $(( (y+1) % 100 )))"; S+=("$s"); [ "$s" = "$CUR" ] && break; y=$((y+1)); [ $y -gt 2100 ] && exit 1; done
for ((i=0;i<${#S[@]};i++)); do for ((j=i;j<${#S[@]};j++)); do
  R=("${S[@]:i:j-i+1}"); [ -n "$ONLY_CUR" ] && [ "${S[j]}" != "$CUR" ] && continue
  if [ $i -eq $j ]; then node scripts/rapm.mjs "${R[@]}" | tail -1; else LAMBDAS=3000 node scripts/rapm.mjs "${R[@]}" | tail -1; fi
done; done
