// ---------------------------------------------------------------------------
// Every offer adapter, alphabetical. test/offers/registry.test.ts fails when an
// adapter file in src/offers/adapters/ exports an adapter that is missing here.
// ---------------------------------------------------------------------------
import type { OfferAdapter } from './types.js';
import { algarveWatersportZeroToHero } from './adapters/algarve-watersport-zero-to-hero.js';
import { bscAtlanticzinEssaouira } from './adapters/bsc-atlanticzin-essaouira.js';
import { dakhlaDownwindChallenge } from './adapters/dakhla-downwind-challenge.js';
import { kerosBlueLimnos } from './adapters/keros-blue-limnos.js';
import { kiteSistersBrazil } from './adapters/kite-sisters-brazil.js';
import { kiteVillageHamata } from './adapters/kite-village-hamata.js';
import { kiteactiveXxxlDownwinder } from './adapters/kiteactive-xxxl-downwinder.js';
import { kitehiMauiDownwinder } from './adapters/kitehi-maui-downwinder.js';
import { lakeunitedDjerba } from './adapters/lakeunited-djerba.js';
import { michaelsKiteVacanciesRhodes } from './adapters/michaels-kite-vacancies-rhodes.js';
import { panamaKiteHouse } from './adapters/panama-kite-house.js';
import { realLaVentanaSupercamp } from './adapters/real-la-ventana-supercamp.js';
import { surfariafrikaDownwinderXl, surfariafrikaNamibiaDownwinder, surfariafrikaPrimalExplorer } from './adapters/surfariafrika.js';
import { theriderexperienceLosRoques } from './adapters/theriderexperience-los-roques.js';
import { toowettoshredBrazil } from './adapters/toowettoshred-brazil.js';
import { ventusBrazilRoutes } from './adapters/ventus-brazil-routes.js';
import { vilaGuaraAtins } from './adapters/vila-guara-atins.js';

export const adapters: OfferAdapter[] = [
  algarveWatersportZeroToHero,
  bscAtlanticzinEssaouira,
  dakhlaDownwindChallenge,
  kerosBlueLimnos,
  kiteSistersBrazil,
  kiteVillageHamata,
  kiteactiveXxxlDownwinder,
  kitehiMauiDownwinder,
  lakeunitedDjerba,
  michaelsKiteVacanciesRhodes,
  panamaKiteHouse,
  realLaVentanaSupercamp,
  surfariafrikaDownwinderXl,
  surfariafrikaNamibiaDownwinder,
  surfariafrikaPrimalExplorer,
  theriderexperienceLosRoques,
  toowettoshredBrazil,
  ventusBrazilRoutes,
  vilaGuaraAtins,
];

export function adapterByKey(key: string): OfferAdapter | undefined {
  return adapters.find(a => a.key === key);
}
