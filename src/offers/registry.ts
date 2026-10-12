// ---------------------------------------------------------------------------
// Every offer adapter, alphabetical. test/offers/registry.test.ts fails when an
// adapter file in src/offers/adapters/ exports an adapter that is missing here.
// ---------------------------------------------------------------------------
import type { OfferAdapter } from './types.js';
import { thirtyFiveKnotsMacapa } from './adapters/35-knots-macapa.js';
import { algarveWatersportZeroToHero } from './adapters/algarve-watersport-zero-to-hero.js';
import { alvorkitecenterGuesthouseAlvor } from './adapters/alvorkitecenter-guesthouse-alvor.js';
import { amanpuloPamalican } from './adapters/amanpulo-pamalican.js';
import { anapnoeParoskitePounda } from './adapters/anapnoe-paroskite-pounda.js';
import { antonyBoyViganj } from './adapters/antony-boy-viganj.js';
import { babaombyIslandLodgeDiegoSuarez } from './adapters/babaomby-island-lodge-diego-suarez.js';
import { bajaJoesLaVentana } from './adapters/baja-joes-la-ventana.js';
import { beachesBonaireKralendijk } from './adapters/beaches-bonaire-kralendijk.js';
import { beekiteVillageMacapa } from './adapters/beekite-village-macapa.js';
import { bkcHousesBilene } from './adapters/bkc-houses-bilene.js';
import { boardroomsBlouberg } from './adapters/boardrooms-blouberg.js';
import { bscAtlanticzinEssaouira } from './adapters/bsc-atlanticzin-essaouira.js';
import { cabareteBoutiqueKiteHotel } from './adapters/cabarete-boutique-kite-hotel.js';
import { campBayLodgeRoatan } from './adapters/camp-bay-lodge-roatan.js';
import { campingInternationalHyeres } from './adapters/camping-international-hyeres.js';
import { campingparkWulfenerHalsFehmarn } from './adapters/campingpark-wulfener-hals-fehmarn.js';
import { cheShaleMambrui } from './adapters/che-shale-mambrui.js';
import { dakhlaAttitudeDakhla } from './adapters/dakhla-attitude-dakhla.js';
import { dakhlaDownwindChallenge } from './adapters/dakhla-downwind-challenge.js';
import { flagBeachSurfersRetreatCorralejo } from './adapters/flag-beach-surfers-retreat-corralejo.js';
import { floripaIspica } from './adapters/floripa-ispica.js';
import { gksKiteHouseEsposende } from './adapters/gks-kite-house-esposende.js';
import { grassyFlatsResortMarathon } from './adapters/grassy-flats-resort-marathon.js';
import { habagatAissatouBoracay } from './adapters/habagat-aissatou-boracay.js';
import { hotelOrkosBeachMikriVigla } from './adapters/hotel-orkos-beach-mikri-vigla.js';
import { hotelPuclaroGualliguaica } from './adapters/hotel-puclaro-gualliguaica.js';
import { ikarusKiteboardMexicoIslaBlanca } from './adapters/ikarus-kiteboard-mexico-isla-blanca.js';
import { kenyawaysDiani } from './adapters/kenyaways-diani.js';
import { kerosBlueLimnos } from './adapters/keros-blue-limnos.js';
import { kiteBasecampPodsLangebaan } from './adapters/kite-basecamp-pods-langebaan.js';
import { kiteBeachInnCabarete } from './adapters/kite-beach-inn-cabarete.js';
import { kiteBuenHombreEcoLodge } from './adapters/kite-buen-hombre-eco-lodge.js';
import { kiteHostelStagnoneMarsala } from './adapters/kite-hostel-stagnone-marsala.js';
import { kiteHouseSardiniaPuntaTrettu } from './adapters/kite-house-sardinia-punta-trettu.js';
import { kiteLodgeBrazilPrea } from './adapters/kite-lodge-brazil-prea.js';
import { kiteSistersBrazil } from './adapters/kite-sisters-brazil.js';
import { kiteVillageHamata } from './adapters/kite-village-hamata.js';
import { kiteactiveXxxlDownwinder } from './adapters/kiteactive-xxxl-downwinder.js';
import { kitefreedomSantaFeBantayan } from './adapters/kitefreedom-santa-fe-bantayan.js';
import { kitehiMauiDownwinder } from './adapters/kitehi-maui-downwinder.js';
import { kitekahunasKiteVillaSunsetBeach } from './adapters/kitekahunas-kite-villa-sunset-beach.js';
import { kitesurfMindoroBulalacao } from './adapters/kitesurf-mindoro-bulalacao.js';
import { kitesurfTofo } from './adapters/kitesurf-tofo.js';
import { kitesurfingGuimarasSanLorenzo } from './adapters/kitesurfing-guimaras-san-lorenzo.js';
import { kitesurfmarocEssaouira } from './adapters/kitesurfmaroc-essaouira.js';
import { kitetribeElGouna } from './adapters/kitetribe-el-gouna.js';
import { kokohauBungalowsSantaVeronica } from './adapters/kokohau-bungalows-santa-veronica.js';
import { laBallenaAlegreSantPerePescador } from './adapters/la-ballena-alegre-sant-pere-pescador.js';
import { lakeunitedDjerba } from './adapters/lakeunited-djerba.js';
import { lineupKiteSurfHouseTaiba } from './adapters/lineup-kite-surf-house-taiba.js';
import { logosBeachVillageTheologos } from './adapters/logos-beach-village-theologos.js';
import { masiraIslandResortMasirah } from './adapters/masira-island-resort-masirah.js';
import { masirahBeachCampSurMasirah } from './adapters/masirah-beach-camp-sur-masirah.js';
import { merEtSelUnionIsland } from './adapters/mer-et-sel-union-island.js';
import { michaelsKiteVacanciesRhodes } from './adapters/michaels-kite-vacancies-rhodes.js';
import { namotuIslandResortMamanuca } from './adapters/namotu-island-resort-mamanuca.js';
import { newSpiritDakhla } from './adapters/new-spirit-dakhla.js';
import { no22RidersInnAkyaka } from './adapters/no22-riders-inn-akyaka.js';
import { numeroUnoBeachHouseOceanPark } from './adapters/numero-uno-beach-house-ocean-park.js';
import { oceanSpiritsLodgeBurgau } from './adapters/ocean-spirits-lodge-burgau.js';
import { oysterrockLangebaan } from './adapters/oysterrock-langebaan.js';
import { pajeByNightPaje } from './adapters/paje-by-night-paje.js';
import { palapasVentanaLaVentana } from './adapters/palapas-ventana-la-ventana.js';
import { panamaKiteHouse } from './adapters/panama-kite-house.js';
import { pandanusResortMuiNe } from './adapters/pandanus-resort-mui-ne.js';
import { peahiResortStagnone } from './adapters/peahi-resort-stagnone.js';
import { pensaoAlcindaSantaKiteSal } from './adapters/pensao-alcinda-santa-kite-sal.js';
import { pousadaBgkBarraGrande } from './adapters/pousada-bgk-barra-grande.js';
import { pousadaMareAltaParajuru } from './adapters/pousada-mare-alta-parajuru.js';
import { pousadaPortalDoVentoTatajuba } from './adapters/pousada-portal-do-vento-tatajuba.js';
import { puntaTrettuKitesurfHouseSardinia } from './adapters/punta-trettu-kitesurf-house-sardinia.js';
import { puzaMoyaCapeSportsLangebaan } from './adapters/puza-moya-cape-sports-langebaan.js';
import { ranchoDoPeixePrea } from './adapters/rancho-do-peixe-prea.js';
import { rascalsKiteResortKalpitiya } from './adapters/rascals-kite-resort-kalpitiya.js';
import { realLaVentanaSupercamp } from './adapters/real-la-ventana-supercamp.js';
import { ruukVillageKalpitiya } from './adapters/ruuk-village-kalpitiya.js';
import { sakalavaLodgeDiegoSuarez } from './adapters/sakalava-lodge-diego-suarez.js';
import { saltysKitesurfVillageKilifi } from './adapters/saltys-kitesurf-village-kilifi.js';
import { seaLionBeachResortMuiNe } from './adapters/sea-lion-beach-resort-mui-ne.js';
import { seahorseResortMuiNe } from './adapters/seahorse-resort-mui-ne.js';
import { secretIslandKiteCampPalawan } from './adapters/secret-island-kite-camp-palawan.js';
import { sevenBeaufortGuajiru } from './adapters/seven-beaufort-guajiru.js';
import { sorrentoBeachClubMyHoa } from './adapters/sorrento-beach-club-my-hoa.js';
import { studiosVrettosPlaka } from './adapters/studios-vrettos-plaka.js';
import { sunsetWaveResortStagnone } from './adapters/sunset-wave-resort-stagnone.js';
import { surfariafrikaDownwinderXl, surfariafrikaNamibiaDownwinder, surfariafrikaPrimalExplorer } from './adapters/surfariafrika.js';
import { surfescapeLajares } from './adapters/surfescape-lajares.js';
import { theBreakersSomaBay } from './adapters/the-breakers-soma-bay.js';
import { theKitesurfLodgeObidos } from './adapters/the-kitesurf-lodge-obidos.js';
import { theriderexperienceLosRoques } from './adapters/theriderexperience-los-roques.js';
import { toowettoshredBrazil } from './adapters/toowettoshred-brazil.js';
import { umiliPodCyprysamiJastarnia } from './adapters/umili-pod-cyprysami-jastarnia.js';
import { univelaCampioneDelGarda } from './adapters/univela-campione-del-garda.js';
import { urlaKiteCampGulbahce } from './adapters/urla-kite-camp-gulbahce.js';
import { urlaSurfHouseGulbahce } from './adapters/urla-surf-house-gulbahce.js';
import { ventanaBayResortElSargento } from './adapters/ventana-bay-resort-el-sargento.js';
import { ventusBrazilRoutes } from './adapters/ventus-brazil-routes.js';
import { vilaGuaraAtins } from './adapters/vila-guara-atins.js';
import { vilaVentoAtins } from './adapters/vila-vento-atins.js';
import { vilancoolVilanculos } from './adapters/vilancool-vilanculos.js';
import { villaEsenciaLongBay } from './adapters/villa-esencia-long-bay.js';
import { villaPefkakiaAgiosNikolaos } from './adapters/villa-pefkakia-agios-nikolaos.js';
import { villaTainaCabarete } from './adapters/villa-taina-cabarete.js';
import { wadiLahamiVillageHamata } from './adapters/wadi-lahami-village-hamata.js';
import { watamuBeachCottagesWatamu } from './adapters/watamu-beach-cottages-watamu.js';
import { watersportOmanCampBarAlHikman } from './adapters/watersport-oman-camp-bar-al-hikman.js';
import { westpointDakhla } from './adapters/westpoint-dakhla.js';
import { whiteWindResortGuajiru } from './adapters/white-wind-resort-guajiru.js';
import { wildKitePeruLaMaisonMancora } from './adapters/wild-kite-peru-la-maison-mancora.js';
import { windSportsFijiNananuIRa } from './adapters/wind-sports-fiji-nananu-i-ra.js';
import { windhoekBoutiqueResortBonaire } from './adapters/windhoek-boutique-resort-bonaire.js';
import { windsurfVillagePortoPollo } from './adapters/windsurf-village-porto-pollo.js';
import { windtownLagoonHotelLangebaan } from './adapters/windtown-lagoon-hotel-langebaan.js';

export const adapters: OfferAdapter[] = [
  algarveWatersportZeroToHero,
  alvorkitecenterGuesthouseAlvor,
  amanpuloPamalican,
  anapnoeParoskitePounda,
  antonyBoyViganj,
  babaombyIslandLodgeDiegoSuarez,
  bajaJoesLaVentana,
  beachesBonaireKralendijk,
  beekiteVillageMacapa,
  bkcHousesBilene,
  boardroomsBlouberg,
  bscAtlanticzinEssaouira,
  cabareteBoutiqueKiteHotel,
  campBayLodgeRoatan,
  campingInternationalHyeres,
  campingparkWulfenerHalsFehmarn,
  cheShaleMambrui,
  dakhlaAttitudeDakhla,
  dakhlaDownwindChallenge,
  flagBeachSurfersRetreatCorralejo,
  floripaIspica,
  gksKiteHouseEsposende,
  grassyFlatsResortMarathon,
  habagatAissatouBoracay,
  hotelOrkosBeachMikriVigla,
  hotelPuclaroGualliguaica,
  ikarusKiteboardMexicoIslaBlanca,
  kenyawaysDiani,
  kerosBlueLimnos,
  kiteactiveXxxlDownwinder,
  kiteBasecampPodsLangebaan,
  kiteBeachInnCabarete,
  kiteBuenHombreEcoLodge,
  kitefreedomSantaFeBantayan,
  kitehiMauiDownwinder,
  kiteHostelStagnoneMarsala,
  kiteHouseSardiniaPuntaTrettu,
  kitekahunasKiteVillaSunsetBeach,
  kiteLodgeBrazilPrea,
  kiteSistersBrazil,
  kitesurfingGuimarasSanLorenzo,
  kitesurfmarocEssaouira,
  kitesurfMindoroBulalacao,
  kitesurfTofo,
  kitetribeElGouna,
  kiteVillageHamata,
  kokohauBungalowsSantaVeronica,
  laBallenaAlegreSantPerePescador,
  lakeunitedDjerba,
  lineupKiteSurfHouseTaiba,
  logosBeachVillageTheologos,
  masirahBeachCampSurMasirah,
  masiraIslandResortMasirah,
  merEtSelUnionIsland,
  michaelsKiteVacanciesRhodes,
  namotuIslandResortMamanuca,
  newSpiritDakhla,
  no22RidersInnAkyaka,
  numeroUnoBeachHouseOceanPark,
  oceanSpiritsLodgeBurgau,
  oysterrockLangebaan,
  pajeByNightPaje,
  palapasVentanaLaVentana,
  panamaKiteHouse,
  pandanusResortMuiNe,
  peahiResortStagnone,
  pensaoAlcindaSantaKiteSal,
  pousadaBgkBarraGrande,
  pousadaMareAltaParajuru,
  pousadaPortalDoVentoTatajuba,
  puntaTrettuKitesurfHouseSardinia,
  puzaMoyaCapeSportsLangebaan,
  ranchoDoPeixePrea,
  rascalsKiteResortKalpitiya,
  realLaVentanaSupercamp,
  ruukVillageKalpitiya,
  sakalavaLodgeDiegoSuarez,
  saltysKitesurfVillageKilifi,
  seahorseResortMuiNe,
  seaLionBeachResortMuiNe,
  secretIslandKiteCampPalawan,
  sevenBeaufortGuajiru,
  sorrentoBeachClubMyHoa,
  studiosVrettosPlaka,
  sunsetWaveResortStagnone,
  surfariafrikaDownwinderXl,
  surfariafrikaNamibiaDownwinder,
  surfariafrikaPrimalExplorer,
  surfescapeLajares,
  theBreakersSomaBay,
  theKitesurfLodgeObidos,
  theriderexperienceLosRoques,
  thirtyFiveKnotsMacapa,
  toowettoshredBrazil,
  umiliPodCyprysamiJastarnia,
  univelaCampioneDelGarda,
  urlaKiteCampGulbahce,
  urlaSurfHouseGulbahce,
  ventanaBayResortElSargento,
  ventusBrazilRoutes,
  vilaGuaraAtins,
  vilancoolVilanculos,
  vilaVentoAtins,
  villaEsenciaLongBay,
  villaPefkakiaAgiosNikolaos,
  villaTainaCabarete,
  wadiLahamiVillageHamata,
  watamuBeachCottagesWatamu,
  watersportOmanCampBarAlHikman,
  westpointDakhla,
  whiteWindResortGuajiru,
  wildKitePeruLaMaisonMancora,
  windhoekBoutiqueResortBonaire,
  windSportsFijiNananuIRa,
  windsurfVillagePortoPollo,
  windtownLagoonHotelLangebaan,
];

export function adapterByKey(key: string): OfferAdapter | undefined {
  return adapters.find(a => a.key === key);
}
