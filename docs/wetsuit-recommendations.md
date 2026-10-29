# Wetsuit recommendations per spot and month

Status 2026-10-29 (Aaron): research + rule + pure function, **not shown anywhere yet**. Next step is an
info line in the KCS map climate panel; Aaron decides the form later (variants at the end).

- Code: `src/lib/wetsuit.ts` (`wetsuitFor({ waterC, airMaxC, windKn })`), test `test/lib/wetsuit.test.ts`
- Machine-readable: `data/wetsuit-recommendations.json` (a test keeps it identical to the code constants)
- Sport: kitesurfing. Wingfoil uses the same table (see "Wingfoil").

## The table (kitesurf)

Base level from the monthly mean sea surface temperature:

| Level (`level`) | Suit | Water (°C) |
|---|---|---|
| `lycra` | Boardshorts or bikini + Lycra | >= 25 |
| `shorty` | Shorty or springsuit, 1-2 mm | 22 to < 25 |
| `three_quarter` | 3/4 suit: short-arm full or long john, 2 mm | 19 to < 22 |
| `full_3_2` | Full suit 3/2 | 16 to < 19 |
| `full_4_3` | Full suit 4/3 | 12 to < 16 |
| `full_5_4` | Full suit 5/4 | 8 to < 12 |
| `full_6_5` | Full suit 6/5, hooded | < 8 |

Accessories by water temperature:

| Item | Optional below | Recommended below |
|---|---|---|
| Boots | 15 °C | 12 °C |
| Gloves | 12 °C | 9 °C |
| Hood / neoprene cap | 13 °C | 10 °C |

If the mean daily max air temperature is below 10 °C, gloves and hood are recommended, whatever the water
temperature.

## The rule (as code applies it)

1. **Base** = first level, from warm to cold, with `waterC >= waterMinC`. The coldest level has no lower bound.
2. **Air step** +1 level when `airMaxC < base.waterMinC + 3` (`AIR_MARGIN_C`). The coldest level never steps.
   Why: a kiter rides out of the water and, on a kiteable day, in at least 12 kn of wind. Wind chill on wet skin
   makes the daytime air count, not only the water. O'Neill and Evolve both say the air and the wind matter more
   for kite and windsurf than for surfing, and Rip Curl says a cold wind "can shift your recommendation up a full
   step". `airMaxC` is the mean daily max (kiting happens in daytime), not the daily mean.
3. **Wind step** +1 level when `windKn >= 20` (`STRONG_WIND_KN`). `windKn` = mean 10 m wind on kiteable days.
   **We have no such value yet** (see "Data"). Callers pass `null`, the step stays 0 and the result says
   `wind: 'no_data'`.
4. `level = base + airStep + windStep`, capped at `full_6_5`.
5. Accessories from `waterC` (table above), plus the cold-air override.

No step ever makes the suit thinner. "Cold water, warm air" can allow a thinner suit for kiters (Evolve,
MACkite's air + water sum), but our spots are windy by definition and the data cannot tell a calm day from a
windy one, so the rule only adds warmth.

## Sources and where they disagree

Read in full (2026-10-29):
- O'Neill, wetsuit thickness chart: https://eu.oneill.com/blogs/all/wetsuit-thickness.
  Lycra 26+ °C, 1 mm 21-25, 2 mm / shorty 18-20, 3/2 (or 4/3) 12-17, 4/3 (or 5/4) 8-11, 5/4 or 6/5 4-7, 7 mm < 3.
  Says wind chill and air matter more for kite/windsurf than for surfing.
- Rip Curl US, thickness guide (reviewed April 2026): https://www.ripcurl.com/us/blog/wetsuit-thickness-guide.html.
  Boardshorts/rashguard 75 °F+ (24 °C), 2 mm 65-75 °F (18-24), 3/2 60-65 °F (16-18, boots optional),
  4/3 55-60 °F (13-16, boots recommended), 4/3 or 5/4 48-55 °F (9-13, boots + gloves), 5/4 or 6/5 hooded
  below 48 °F (9). Boots below 60 °F (16), gloves essential below 55 °F (13) for sessions over an hour,
  hood below 50 °F (10), "earlier ... when wind or offshore spray is in the picture".
- Mystic (kite brand), beginners guide: https://www.mysticboarding.com/blogs/news/the-ultimate-guide-to-wetsuits-for-beginners.
  2 mm or lighter above 20 °C, 3/2 around 13-15 °C and warmer, 4/3 11-15 (boots, gloves, hood optional),
  5/3 8-12 (recommended), 5/4+ below 8 (highly recommended).
- Barts: https://barts.com/blogs/news/wet-suit-thickness-vs-water-temperature-a-guide.
  Lycra 24+ °C, 1-2 mm springsuit 21-24, 2 mm shorty or full 18-21, 3/2 16-18, 4/3 13-16 (booties
  recommended), 5/4 hooded 10-13 (gloves, boots, hood essential), 6/5/4 or drysuit below 10.
- Evolve (kite/wing shop, uses the O'Neill table): https://rideevolve.eu/en/blog/news-1/guide-how-to-choose-your-wetsuit-659.
  Adds a kite/wing column: neo top in 18-20 °C if the wind is chilly, hood "as soon as it gets windy" at 8-11 °C.
  Kite and wing: wind and air matter more than for surfers; mild water with cool air needs a thicker suit.
- MACkite (kite shop): https://www.mackiteboarding.com/news/wetsuit-buyers-guide/.
  Rule of thumb: water + air in °F; 140+ boardshorts, about 100-120 a 3/2.

Search snippets only (page not readable, shown for context, not used for a threshold):
- Rip Curl AU (4/3 at about 14 °C, 3/2 at 18, springsuit at 21).
- Xcel chart via Jack's Surfboards (5/4 with boots, gloves, hood at 50-55 °F).
- A kite guide saying gloves are not essential until about 8 °C.
- Decathlon (gloves from 12-17 °C, hood from 7-12 °C).

Where they disagree and what we chose:
- **O'Neill runs about 3-4 °C colder** than Rip Curl, Barts and Mystic (3/2 down to 12 °C, 4/3 down to 8 °C).
  Those charts are for surfing, where the body stays in the water. We follow the warmer cluster (Rip Curl /
  Barts / Mystic) because kiting adds wind chill.
- **Lycra**: O'Neill 26, Rip Curl and Barts 24. Chosen **25**; the air step catches cool, windy months.
- **Shorty vs 3/4**: Barts splits springsuit (21-24) from "2 mm shorty or full" (18-21); Rip Curl has one
  2 mm band (18-24). Chosen shorty 22-25 and a 3/4 suit (short-arm full or long john) at 19-22.
- **3/2**: Barts 16-18, Rip Curl 16-18 (60-65 °F), Mystic about 13-15+. Chosen **16-19**.
- **4/3**: Barts 13-16, Rip Curl 13-16 (and 9-13 as "4/3 or 5/4"), Mystic 11-15. Chosen **12-16**.
- **5/4**: Barts 10-13 hooded, Mystic 5/3 8-12, Rip Curl 4/3 or 5/4 at 9-13. Chosen **8-12**; **6/5 below 8**
  (Mystic, Rip Curl below 9, O'Neill and Evolve 5/4 or 6/5 at 4-7).
- **Boots**: Rip Curl from 16, Barts recommended 13-16, Mystic optional 11-15. Many kiters ride footstraps
  barefoot, so **optional below 15, recommended below 12**. Reef, urchins or rocks need boots in any water;
  that is a spot fact, not a temperature one.
- **Gloves**: Rip Curl essential below 13, Barts essential 10-13, Mystic recommended 8-12. Gloves cost bar feel
  and kiters keep their hands working, so **optional below 12, recommended below 9**.
- **Hood**: Rip Curl below 10 (earlier with wind), Barts 10-13, Mystic recommended 8-12, Evolve "as soon as it
  gets windy" at 8-11. **Optional below 13, recommended below 10.**
- **Air**: no source gives a number for kiters. Our margin (3 °C) is calibrated on spots with well-known local
  advice (examples below); it is the main tuning knob.

## Wingfoil

No source gives separate numbers. Evolve says wingfoilers keep the upper body in the wind the whole session
and, as learners, fall a lot: a thermal lining on the torso matters more than an extra millimetre on the legs.
Other guides say experienced wingers on the foil stay drier and can go a little thinner. Net: **same table**;
in text, note "wingfoil learners: one step warmer in borderline months". Not coded.

## Data: what we really have (live, read-only, 2026-10-29)

- `offer_climate_stats`: 487 offers (252 distinct 0.1° cells). `water_temp_months` (SST),
  `air_temp_max_months`, `air_temp_min_months`, `uv_months`. **No wind column.**
  23 offers have no water temperature, so no recommendation. Most are inland: lakes, mountains, snowkite
  (Hardangervidda, Reschensee, Garda, Simplon...). Two are coastal, so their gap is a missing SST cell:
  Mui Ne and Surendorf.
- `climate_points.wind_kiteable_months`: ERA5 share of days with >= 12 kn for >= 3 daylight hours, on 156
  offers' cells. It is a **share of days, not a speed**.
- `wind_stats` (Bstoked) and `country_climate_stats.wind_months`: share of windy days per country/region.
  Not a speed either.
- **No wind speed per spot and month exists.** That is why the wind step needs data. Cheapest path: the ERA5
  hourly 10 m wind series is already downloaded per cell for `kiteableShare` (`src/pipeline/copernicus.ts`).
  A "mean wind on kiteable days" per month could come from the same series. That needs a new column on
  `climate_points` (migration) and a climate-stats run.
- Country and region rows (`country_climate_stats`, `region_climate_stats`) carry water + air max as well, so
  the map's country/region view can use the same function.

## Run over the live months (read-only, 2026-10-29)

`wetsuitFor` over every month of `offer_climate_stats`, `windKn = null`:

| Level | Offer-months | Share | Distinct cell-months | Share |
|---|---|---|---|---|
| lycra | 2047 | 35.0 % | 1031 | 34.1 % |
| shorty | 1257 | 21.5 % | 611 | 20.2 % |
| three_quarter | 614 | 10.5 % | 257 | 8.5 % |
| full_3_2 | 573 | 9.8 % | 302 | 10.0 % |
| full_4_3 | 617 | 10.6 % | 294 | 9.7 % |
| full_5_4 | 191 | 3.3 % | 121 | 4.0 % |
| full_6_5 | 269 | 4.6 % | 192 | 6.3 % |
| no water | 276 | 4.7 % | 216 | 7.1 % |

Totals: 5844 offer-months (487 x 12) and 3024 cell-months (252 x 12). The air step fired in 1926 offer-months.
Boots recommended in 325 offer-months, gloves in 270, hood in 285.

Examples:

| Spot (month) | Water / air max °C | Result |
|---|---|---|
| Tarifa (Jan) | 15.8 / 15.7 | Full 4/3 |
| Tarifa (Aug) | 20.9 / 26.8 | 3/4 suit |
| Hurghada (Jan) | 22.4 / 21.4 | 3/4 suit (shorty + air step) |
| Hurghada (Jul) | 29.0 / 37.1 | Lycra |
| Cumbuco (all year) | 26.8-29.0 / 29.6-31.8 | Lycra |
| Cape Town Sunset Beach (Jan) | 14.3 / 25.6 | Full 4/3, boots optional |
| Essaouira (Jan / Jul) | 17.1 / 18.5, 18.0 / 25.4 | Full 4/3 (air step) / Full 3/2 |
| Fehmarn (Jul / Oct) | 18.4 / 19.4, 13.1 / 13.3 | Full 3/2 / Full 5/4 (air step), boots optional |
| Fehmarn (Jan) | 3.6 / 4.2 | Full 6/5, boots, gloves, hood |

Known weak spot (tuning knob `AIR_MARGIN_C`, `src/lib/wetsuit.ts`): on islands where the air max is about the
water temperature all year (Lanzarote, Cape Verde), the air step fires in almost every month. Sal Rei
(Boa Vista) in Sep/Oct, at 27 °C water, comes out as shorty, where many riders wear only a Lycra. That is the
conservative side. A cap like "air max >= 26 °C never steps" would fix it, but it would also drop the step for
Hurghada in November, where shorty is the usual local advice.

## How it could appear in the map climate panel (KCS `public/cruise-map.html` + `public/monthly-wind-map.js`)

The panel today has one metric select (windy days, air min, air max, water, UV), a legend and a hover
profile per country/region with 12 month bars. Three options, not built:

**A. New layer "Wetsuit"** in the metric select. Countries/regions are coloured by level for the selected month,
with a 7-step legend from Lycra (warm colour) to 6/5 (dark blue). The hover profile reads
`Jan: Full suit 4/3 · boots optional` and shows 12 small level chips.
Pro: the whole world at a glance, a natural fit for the month slider. Con: a new layer, legend and overlay route;
the most work.

**B. One info line in the existing hover profile**, shown under the temperature line when the water or air layer
is active: `Wetsuit (kite): Full suit 3/2 · boots optional`. No new layer, no colour.
Pro: smallest change, uses the data the profile already holds. Con: only visible on hover, and only for those layers.

**C. Month strip in the profile, for every layer.** A row of 12 short codes under the bars
(`L L L S S 3/4 3/2 ...`), with the selected month highlighted and a "?" linking to this table.
Pro: answers "when do I need what" for a spot in one glance, independent of the active layer. Con: dense on a
phone. Needs a short key.

Shared: the label says "indicative, for kitesurfing; personal cold tolerance and session length vary". The wind
step stays off until a wind-speed column exists.
