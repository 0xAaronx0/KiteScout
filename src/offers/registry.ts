// ---------------------------------------------------------------------------
// Every offer adapter, alphabetical. test/offers/registry.test.ts fails when an
// adapter file in src/offers/adapters/ exports an adapter that is missing here.
// ---------------------------------------------------------------------------
import type { OfferAdapter } from './types.js';
import { algarveWatersportZeroToHero } from './adapters/algarve-watersport-zero-to-hero.js';
import { anapnoeParoskitePounda } from './adapters/anapnoe-paroskite-pounda.js';
import { bajaJoesLaVentana } from './adapters/baja-joes-la-ventana.js';
import { bscAtlanticzinEssaouira } from './adapters/bsc-atlanticzin-essaouira.js';
import { dakhlaDownwindChallenge } from './adapters/dakhla-downwind-challenge.js';
import { flagBeachSurfersRetreatCorralejo } from './adapters/flag-beach-surfers-retreat-corralejo.js';
import { floripaIspica } from './adapters/floripa-ispica.js';
import { hotelOrkosBeachMikriVigla } from './adapters/hotel-orkos-beach-mikri-vigla.js';
import { kenyawaysDiani } from './adapters/kenyaways-diani.js';
import { kerosBlueLimnos } from './adapters/keros-blue-limnos.js';
import { kiteBuenHombreEcoLodge } from './adapters/kite-buen-hombre-eco-lodge.js';
import { kiteHouseSardiniaPuntaTrettu } from './adapters/kite-house-sardinia-punta-trettu.js';
import { kiteLodgeBrazilPrea } from './adapters/kite-lodge-brazil-prea.js';
import { kiteSistersBrazil } from './adapters/kite-sisters-brazil.js';
import { kiteVillageHamata } from './adapters/kite-village-hamata.js';
import { kiteactiveXxxlDownwinder } from './adapters/kiteactive-xxxl-downwinder.js';
import { kitehiMauiDownwinder } from './adapters/kitehi-maui-downwinder.js';
import { kitesurfmarocEssaouira } from './adapters/kitesurfmaroc-essaouira.js';
import { kitetribeElGouna } from './adapters/kitetribe-el-gouna.js';
import { lakeunitedDjerba } from './adapters/lakeunited-djerba.js';
import { logosBeachVillageTheologos } from './adapters/logos-beach-village-theologos.js';
import { michaelsKiteVacanciesRhodes } from './adapters/michaels-kite-vacancies-rhodes.js';
import { newSpiritDakhla } from './adapters/new-spirit-dakhla.js';
import { oceanSpiritsLodgeBurgau } from './adapters/ocean-spirits-lodge-burgau.js';
import { panamaKiteHouse } from './adapters/panama-kite-house.js';
import { pousadaBgkBarraGrande } from './adapters/pousada-bgk-barra-grande.js';
import { pousadaMareAltaParajuru } from './adapters/pousada-mare-alta-parajuru.js';
import { pousadaPortalDoVentoTatajuba } from './adapters/pousada-portal-do-vento-tatajuba.js';
import { puntaTrettuKitesurfHouseSardinia } from './adapters/punta-trettu-kitesurf-house-sardinia.js';
import { ranchoDoPeixePrea } from './adapters/rancho-do-peixe-prea.js';
import { rascalsKiteResortKalpitiya } from './adapters/rascals-kite-resort-kalpitiya.js';
import { realLaVentanaSupercamp } from './adapters/real-la-ventana-supercamp.js';
import { ruukVillageKalpitiya } from './adapters/ruuk-village-kalpitiya.js';
import { sakalavaLodgeDiegoSuarez } from './adapters/sakalava-lodge-diego-suarez.js';
import { sevenBeaufortGuajiru } from './adapters/seven-beaufort-guajiru.js';
import { studiosVrettosPlaka } from './adapters/studios-vrettos-plaka.js';
import { sunsetWaveResortStagnone } from './adapters/sunset-wave-resort-stagnone.js';
import { surfariafrikaDownwinderXl, surfariafrikaNamibiaDownwinder, surfariafrikaPrimalExplorer } from './adapters/surfariafrika.js';
import { theKitesurfLodgeObidos } from './adapters/the-kitesurf-lodge-obidos.js';
import { theriderexperienceLosRoques } from './adapters/theriderexperience-los-roques.js';
import { toowettoshredBrazil } from './adapters/toowettoshred-brazil.js';
import { ventusBrazilRoutes } from './adapters/ventus-brazil-routes.js';
import { vilaGuaraAtins } from './adapters/vila-guara-atins.js';
import { vilaVentoAtins } from './adapters/vila-vento-atins.js';
import { villaPefkakiaAgiosNikolaos } from './adapters/villa-pefkakia-agios-nikolaos.js';
import { wadiLahamiVillageHamata } from './adapters/wadi-lahami-village-hamata.js';
import { wildKitePeruLaMaisonMancora } from './adapters/wild-kite-peru-la-maison-mancora.js';

export const adapters: OfferAdapter[] = [
  algarveWatersportZeroToHero,
  anapnoeParoskitePounda,
  bajaJoesLaVentana,
  bscAtlanticzinEssaouira,
  dakhlaDownwindChallenge,
  flagBeachSurfersRetreatCorralejo,
  floripaIspica,
  hotelOrkosBeachMikriVigla,
  kenyawaysDiani,
  kerosBlueLimnos,
  kiteactiveXxxlDownwinder,
  kiteBuenHombreEcoLodge,
  kitehiMauiDownwinder,
  kiteHouseSardiniaPuntaTrettu,
  kiteLodgeBrazilPrea,
  kiteSistersBrazil,
  kitesurfmarocEssaouira,
  kitetribeElGouna,
  kiteVillageHamata,
  lakeunitedDjerba,
  logosBeachVillageTheologos,
  michaelsKiteVacanciesRhodes,
  newSpiritDakhla,
  oceanSpiritsLodgeBurgau,
  panamaKiteHouse,
  pousadaBgkBarraGrande,
  pousadaMareAltaParajuru,
  pousadaPortalDoVentoTatajuba,
  puntaTrettuKitesurfHouseSardinia,
  ranchoDoPeixePrea,
  rascalsKiteResortKalpitiya,
  realLaVentanaSupercamp,
  ruukVillageKalpitiya,
  sakalavaLodgeDiegoSuarez,
  sevenBeaufortGuajiru,
  studiosVrettosPlaka,
  sunsetWaveResortStagnone,
  surfariafrikaDownwinderXl,
  surfariafrikaNamibiaDownwinder,
  surfariafrikaPrimalExplorer,
  theKitesurfLodgeObidos,
  theriderexperienceLosRoques,
  toowettoshredBrazil,
  ventusBrazilRoutes,
  vilaGuaraAtins,
  vilaVentoAtins,
  villaPefkakiaAgiosNikolaos,
  wadiLahamiVillageHamata,
  wildKitePeruLaMaisonMancora,
];

export function adapterByKey(key: string): OfferAdapter | undefined {
  return adapters.find(a => a.key === key);
}
