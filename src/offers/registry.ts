// ---------------------------------------------------------------------------
// Every offer adapter, alphabetical. test/offers/registry.test.ts fails when an
// adapter file in src/offers/adapters/ exports an adapter that is missing here.
// ---------------------------------------------------------------------------
import type { OfferAdapter } from './types.js';
import { thirtyFiveKnotsMacapa } from './adapters/35-knots-macapa.js';
import { algarveWatersportZeroToHero } from './adapters/algarve-watersport-zero-to-hero.js';
import { alvorkitecenterGuesthouseAlvor } from './adapters/alvorkitecenter-guesthouse-alvor.js';
import { amagaliPousadaGalinhos } from './adapters/amagali-pousada-galinhos.js';
import { amanpuloPamalican } from './adapters/amanpulo-pamalican.js';
import { amigosDoVentoTouros } from './adapters/amigos-do-vento-touros.js';
import { anapnoeParoskitePounda } from './adapters/anapnoe-paroskite-pounda.js';
import { antonyBoyViganj } from './adapters/antony-boy-viganj.js';
import { babaombyIslandLodgeDiegoSuarez } from './adapters/babaomby-island-lodge-diego-suarez.js';
import { bajaJoesLaVentana } from './adapters/baja-joes-la-ventana.js';
import { batikiteResortJeneponto } from './adapters/batikite-resort-jeneponto.js';
import { beachesBonaireKralendijk } from './adapters/beaches-bonaire-kralendijk.js';
import { beekiteVillageMacapa } from './adapters/beekite-village-macapa.js';
import { bkcHousesBilene } from './adapters/bkc-houses-bilene.js';
import { blueDreamKiteboardingResortBahiaSalinas } from './adapters/blue-dream-kiteboarding-resort-bahia-salinas.js';
import { boardroomsBlouberg } from './adapters/boardrooms-blouberg.js';
import { borkHavnCamping } from './adapters/bork-havn-camping.js';
import { bretterbudeHeiligenhafen } from './adapters/bretterbude-heiligenhafen.js';
import { bscAtlanticzinEssaouira } from './adapters/bsc-atlanticzin-essaouira.js';
import { cabareteBoutiqueKiteHotel } from './adapters/cabarete-boutique-kite-hotel.js';
import { campBayLodgeRoatan } from './adapters/camp-bay-lodge-roatan.js';
import { campingFlueggerStrandFehmarn } from './adapters/camping-fluegger-strand-fehmarn.js';
import { campingInternationalHyeres } from './adapters/camping-international-hyeres.js';
import { campingStrukkamphukFehmarnsund } from './adapters/camping-strukkamphuk-fehmarnsund.js';
import { campingTarifaLosLances } from './adapters/camping-tarifa-los-lances.js';
import { campingparkWulfenerHalsFehmarn } from './adapters/campingpark-wulfener-hals-fehmarn.js';
import { campingplatzLoissin } from './adapters/campingplatz-loissin.js';
import { campingplatzStrandgutCuxhaven } from './adapters/campingplatz-strandgut-cuxhaven.js';
import { cantoDasAguasIcarai } from './adapters/canto-das-aguas-icarai.js';
import { casaNomadeIlhaDoGuajiru } from './adapters/casa-nomade-ilha-do-guajiru.js';
import { casaSuicaKiteVillasPraiaDoFarol } from './adapters/casa-suica-kite-villas-praia-do-farol.js';
import { cheShaleMambrui } from './adapters/che-shale-mambrui.js';
import { costaKiteBahiaSalinas } from './adapters/costa-kite-bahia-salinas.js';
import { dagaliSnowkiteCampFagerheim } from './adapters/dagali-snowkite-camp-fagerheim.js';
import { dakhlaAttitudeDakhla } from './adapters/dakhla-attitude-dakhla.js';
import { dakhlaDownwindChallenge } from './adapters/dakhla-downwind-challenge.js';
import { drejbyStrandCampingAls } from './adapters/drejby-strand-camping-als.js';
import { drivethruKiteSurfCampHvideSande } from './adapters/drivethru-kite-surf-camp-hvide-sande.js';
import { dunasLuxuryBeachResortValdevaqueros } from './adapters/dunas-luxury-beach-resort-valdevaqueros.js';
import { escapePousadaBarraNova } from './adapters/escape-pousada-barra-nova.js';
import { feddetStrandResort } from './adapters/feddet-strand-resort.js';
import { ferienwohnungenWestwindSaal } from './adapters/ferienwohnungen-westwind-saal.js';
import { filhoDoVentoBarraDoCunhau } from './adapters/filho-do-vento-barra-do-cunhau.js';
import { flagBeachSurfersRetreatCorralejo } from './adapters/flag-beach-surfers-retreat-corralejo.js';
import { floripaIspica } from './adapters/floripa-ispica.js';
import { flyHouseLeba } from './adapters/fly-house-leba.js';
import { ftfWatersportsZipke } from './adapters/ftf-watersports-zipke.js';
import { gksKiteHouseEsposende } from './adapters/gks-kite-house-esposende.js';
import { grassyFlatsResortMarathon } from './adapters/grassy-flats-resort-marathon.js';
import { habagatAissatouBoracay } from './adapters/habagat-aissatou-boracay.js';
import { highFlyersKiteHouseTarifa } from './adapters/high-flyers-kite-house-tarifa.js';
import { hotel100FunValdevaqueros } from './adapters/hotel-100-fun-valdevaqueros.js';
import { hotelArteVidaLosLances } from './adapters/hotel-arte-vida-los-lances.js';
import { hotelCopacabanaBeachValdevaqueros } from './adapters/hotel-copacabana-beach-valdevaqueros.js';
import { hotelOrkosBeachMikriVigla } from './adapters/hotel-orkos-beach-mikri-vigla.js';
import { hotelPuclaroGualliguaica } from './adapters/hotel-puclaro-gualliguaica.js';
import { hvideSandeCamping } from './adapters/hvide-sande-camping.js';
import { icaraiKiteVillageAmontada } from './adapters/icarai-kite-village-amontada.js';
import { ikarusKiteboardMexicoIslaBlanca } from './adapters/ikarus-kiteboard-mexico-isla-blanca.js';
import { inchcapeSeasideVillasSilverSands } from './adapters/inchcape-seaside-villas-silver-sands.js';
import { jaguaribeLodgeFortim } from './adapters/jaguaribe-lodge-fortim.js';
import { jaguarindiaVillageFortim } from './adapters/jaguarindia-village-fortim.js';
import { kailuaLodgePelzerhaken } from './adapters/kailua-lodge-pelzerhaken.js';
import { kenyawaysDiani } from './adapters/kenyaways-diani.js';
import { kerosBlueLimnos } from './adapters/keros-blue-limnos.js';
import { kilomboVillasSibauma } from './adapters/kilombo-villas-sibauma.js';
import { kiteBasecampPodsLangebaan } from './adapters/kite-basecamp-pods-langebaan.js';
import { kiteBeachInnCabarete } from './adapters/kite-beach-inn-cabarete.js';
import { kiteBuenHombreEcoLodge } from './adapters/kite-buen-hombre-eco-lodge.js';
import { kiteCrewCaravansChalupy } from './adapters/kite-crew-caravans-chalupy.js';
import { kiteHostelAfricaTarifa } from './adapters/kite-hostel-africa-tarifa.js';
import { kiteHostelStagnoneMarsala } from './adapters/kite-hostel-stagnone-marsala.js';
import { kiteHouseSardiniaPuntaTrettu } from './adapters/kite-house-sardinia-punta-trettu.js';
import { kiteLodgeBrazilPrea } from './adapters/kite-lodge-brazil-prea.js';
import { kiteMarinaSarbsk } from './adapters/kite-marina-sarbsk.js';
import { kitePassionGlampingPuttgarden } from './adapters/kite-passion-glamping-puttgarden.js';
import { kitePlCaravansChalupy } from './adapters/kite-pl-caravans-chalupy.js';
import { kiteSistersBrazil } from './adapters/kite-sisters-brazil.js';
import { kiteVillageHamata } from './adapters/kite-village-hamata.js';
import { kiteactiveXxxlDownwinder } from './adapters/kiteactive-xxxl-downwinder.js';
import { kitefreedomSantaFeBantayan } from './adapters/kitefreedom-santa-fe-bantayan.js';
import { kitefunSurfHouseTarifa } from './adapters/kitefun-surf-house-tarifa.js';
import { kitehiMauiDownwinder } from './adapters/kitehi-maui-downwinder.js';
import { kitekahunasKiteVillaSunsetBeach } from './adapters/kitekahunas-kite-villa-sunset-beach.js';
import { kiteparadiseSakalavaBay } from './adapters/kiteparadise-sakalava-bay.js';
import { kitesurfMindoroBulalacao } from './adapters/kitesurf-mindoro-bulalacao.js';
import { kitesurfTofo } from './adapters/kitesurf-tofo.js';
import { kitesurfingGuimarasSanLorenzo } from './adapters/kitesurfing-guimaras-san-lorenzo.js';
import { kitesurfingLankaKalpitiya } from './adapters/kitesurfing-lanka-kalpitiya.js';
import { kitesurfmarocEssaouira } from './adapters/kitesurfmaroc-essaouira.js';
import { kitetribeElGouna } from './adapters/kitetribe-el-gouna.js';
import { kokohauBungalowsSantaVeronica } from './adapters/kokohau-bungalows-santa-veronica.js';
import { laBallenaAlegreSantPerePescador } from './adapters/la-ballena-alegre-sant-pere-pescador.js';
import { lakesideParadiseSportHostelKnokkeHeist } from './adapters/lakeside-paradise-sport-hostel-knokke-heist.js';
import { lakeunitedDjerba } from './adapters/lakeunited-djerba.js';
import { lazyKiteSurfHouseTarifa } from './adapters/lazy-kite-surf-house-tarifa.js';
import { learnkiteboardingnowCampingBbOostvoorne } from './adapters/learnkiteboardingnow-camping-bb-oostvoorne.js';
import { lineupKiteSurfHouseTaiba } from './adapters/lineup-kite-surf-house-taiba.js';
import { lionHostelTarifa } from './adapters/lion-hostel-tarifa.js';
import { logosBeachVillageTheologos } from './adapters/logos-beach-village-theologos.js';
import { loopItAcademyApartmentsJastarnia } from './adapters/loop-it-academy-apartments-jastarnia.js';
import { margaritaVillageKalpitiya } from './adapters/margarita-village-kalpitiya.js';
import { masiraIslandResortMasirah } from './adapters/masira-island-resort-masirah.js';
import { masirahBeachCampSurMasirah } from './adapters/masirah-beach-camp-sur-masirah.js';
import { maszoperiaSun4helJastarnia } from './adapters/maszoperia-sun4hel-jastarnia.js';
import { matosApartmentsTarifa } from './adapters/matos-apartments-tarifa.js';
import { mazavaLohaResortDiegoSuarez } from './adapters/mazava-loha-resort-diego-suarez.js';
import { merEtSelUnionIsland } from './adapters/mer-et-sel-union-island.js';
import { michaelsKiteVacanciesRhodes } from './adapters/michaels-kite-vacancies-rhodes.js';
import { mounuIslandResortVavau } from './adapters/mounu-island-resort-vavau.js';
import { namotuIslandResortMamanuca } from './adapters/namotu-island-resort-mamanuca.js';
import { newSpiritDakhla } from './adapters/new-spirit-dakhla.js';
import { no22RidersInnAkyaka } from './adapters/no22-riders-inn-akyaka.js';
import { nohotelLampesPiratenKojeDranske } from './adapters/nohotel-lampes-piraten-koje-dranske.js';
import { nordseeSurfschuleDomeSeeschwalbeHooksiel } from './adapters/nordsee-surfschule-dome-seeschwalbe-hooksiel.js';
import { nordwindWassersportSurendorf } from './adapters/nordwind-wassersport-surendorf.js';
import { numeroUnoBeachHouseOceanPark } from './adapters/numero-uno-beach-house-ocean-park.js';
import { oceanSpiritsLodgeBurgau } from './adapters/ocean-spirits-lodge-burgau.js';
import { oitiBeachResortTutoia } from './adapters/oiti-beach-resort-tutoia.js';
import { oysterrockLangebaan } from './adapters/oysterrock-langebaan.js';
import { pajeByNightPaje } from './adapters/paje-by-night-paje.js';
import { palapasVentanaLaVentana } from './adapters/palapas-ventana-la-ventana.js';
import { panamaKiteCenterPuntaChame } from './adapters/panama-kite-center-punta-chame.js';
import { panamaKiteHouse } from './adapters/panama-kite-house.js';
import { pandanusResortMuiNe } from './adapters/pandanus-resort-mui-ne.js';
import { paracuruKiteVillage } from './adapters/paracuru-kite-village.js';
import { peahiResortStagnone } from './adapters/peahi-resort-stagnone.js';
import { pensaoAlcindaSantaKiteSal } from './adapters/pensao-alcinda-santa-kite-sal.js';
import { pousadaArmacaoDosVentosIlhabela } from './adapters/pousada-armacao-dos-ventos-ilhabela.js';
import { pousadaBgkBarraGrande } from './adapters/pousada-bgk-barra-grande.js';
import { pousadaIlhaDoVentoSaoMiguelDoGostoso } from './adapters/pousada-ilha-do-vento-sao-miguel-do-gostoso.js';
import { pousadaMareAltaParajuru } from './adapters/pousada-mare-alta-parajuru.js';
import { pousadaNaturalParkIbiraquera } from './adapters/pousada-natural-park-ibiraquera.js';
import { pousadaPaisTropicalIcarai } from './adapters/pousada-pais-tropical-icarai.js';
import { pousadaPortalDoVentoTatajuba } from './adapters/pousada-portal-do-vento-tatajuba.js';
import { pousadaRaia1Ibiraquera } from './adapters/pousada-raia-1-ibiraquera.js';
import { prasebanResortPakNamPran } from './adapters/praseban-resort-pak-nam-pran.js';
import { proboardingFerienwohnungenKleinZicker } from './adapters/proboarding-ferienwohnungen-klein-zicker.js';
import { puntaTrettuKitesurfHouseSardinia } from './adapters/punta-trettu-kitesurf-house-sardinia.js';
import { puzaMoyaCapeSportsLangebaan } from './adapters/puza-moya-cape-sports-langebaan.js';
import { ranchoDoPeixePrea } from './adapters/rancho-do-peixe-prea.js';
import { rascalsKiteResortKalpitiya } from './adapters/rascals-kite-resort-kalpitiya.js';
import { realLaVentanaSupercamp } from './adapters/real-la-ventana-supercamp.js';
import { regenbogenBorn } from './adapters/regenbogen-born.js';
import { regenbogenUmmanz } from './adapters/regenbogen-ummanz.js';
import { rewitaDelfinJurata } from './adapters/rewita-delfin-jurata.js';
import { ruegenKiteHostelMartinshafen } from './adapters/ruegen-kite-hostel-martinshafen.js';
import { ruukVillageKalpitiya } from './adapters/ruuk-village-kalpitiya.js';
import { sakalavaLodgeDiegoSuarez } from './adapters/sakalava-lodge-diego-suarez.js';
import { saltysKitesurfVillageKilifi } from './adapters/saltys-kitesurf-village-kilifi.js';
import { seaLionBeachResortMuiNe } from './adapters/sea-lion-beach-resort-mui-ne.js';
import { seahorseResortMuiNe } from './adapters/seahorse-resort-mui-ne.js';
import { secretIslandKiteCampPalawan } from './adapters/secret-island-kite-camp-palawan.js';
import { sevenBeaufortGuajiru } from './adapters/seven-beaufort-guajiru.js';
import { skavenStrandCamping } from './adapters/skaven-strand-camping.js';
import { solYMarSurfCampCorralejo } from './adapters/sol-y-mar-surf-camp-corralejo.js';
import { sorrentoBeachClubMyHoa } from './adapters/sorrento-beach-club-my-hoa.js';
import { strandcampingWallnauFehmarn } from './adapters/strandcamping-wallnau-fehmarn.js';
import { studiosVrettosPlaka } from './adapters/studios-vrettos-plaka.js';
import { sunsetWaveResortStagnone } from './adapters/sunset-wave-resort-stagnone.js';
import { surfHouseKiteZoneChalupy } from './adapters/surf-house-kite-zone-chalupy.js';
import { surfariafrikaDownwinderXl, surfariafrikaNamibiaDownwinder, surfariafrikaPrimalExplorer } from './adapters/surfariafrika.js';
import { surfersResidenceTarifa } from './adapters/surfers-residence-tarifa.js';
import { surfescapeLajares } from './adapters/surfescape-lajares.js';
import { taigaTarifaPuntaPaloma } from './adapters/taiga-tarifa-punta-paloma.js';
import { taigaTarifaValdevaqueros } from './adapters/taiga-tarifa-valdevaqueros.js';
import { tarifaKiteHostelTarifa } from './adapters/tarifa-kite-hostel-tarifa.js';
import { theBreakersSomaBay } from './adapters/the-breakers-soma-bay.js';
import { theKitesurfLodgeObidos } from './adapters/the-kitesurf-lodge-obidos.js';
import { theriderexperienceLosRoques } from './adapters/theriderexperience-los-roques.js';
import { thorsmindeCamping } from './adapters/thorsminde-camping.js';
import { toowettoshredBrazil } from './adapters/toowettoshred-brazil.js';
import { umiliPodCyprysamiJastarnia } from './adapters/umili-pod-cyprysami-jastarnia.js';
import { ummaiiSurfhostelUmmanz } from './adapters/ummaii-surfhostel-ummanz.js';
import { univelaCampioneDelGarda } from './adapters/univela-campione-del-garda.js';
import { urlaKiteCampGulbahce } from './adapters/urla-kite-camp-gulbahce.js';
import { urlaSurfHouseGulbahce } from './adapters/urla-surf-house-gulbahce.js';
import { valampuriResortKalpitiya } from './adapters/valampuri-resort-kalpitiya.js';
import { ventanaBayResortElSargento } from './adapters/ventana-bay-resort-el-sargento.js';
import { ventusBrazilRoutes } from './adapters/ventus-brazil-routes.js';
import { vilaGuaraAtins } from './adapters/vila-guara-atins.js';
import { vilaVentoAtins } from './adapters/vila-vento-atins.js';
import { vilancoolVilanculos } from './adapters/vilancool-vilanculos.js';
import { villaAlohaPraiaDePatos } from './adapters/villa-aloha-praia-de-patos.js';
import { villaEsenciaLongBay } from './adapters/villa-esencia-long-bay.js';
import { villaPefkakiaAgiosNikolaos } from './adapters/villa-pefkakia-agios-nikolaos.js';
import { villaRasaBuzios } from './adapters/villa-rasa-buzios.js';
import { villaTainaCabarete } from './adapters/villa-taina-cabarete.js';
import { wadiLahamiVillageHamata } from './adapters/wadi-lahami-village-hamata.js';
import { watamuBeachCottagesWatamu } from './adapters/watamu-beach-cottages-watamu.js';
import { watersportOmanCampBarAlHikman } from './adapters/watersport-oman-camp-bar-al-hikman.js';
import { wattlodgeNorden } from './adapters/wattlodge-norden.js';
import { westpointDakhla } from './adapters/westpoint-dakhla.js';
import { whiteWindResortGuajiru } from './adapters/white-wind-resort-guajiru.js';
import { wildHouseTarifa } from './adapters/wild-house-tarifa.js';
import { wildKitePeruLaMaisonMancora } from './adapters/wild-kite-peru-la-maison-mancora.js';
import { windAdventuresStudioOrientBay } from './adapters/wind-adventures-studio-orient-bay.js';
import { windSportsFijiNananuIRa } from './adapters/wind-sports-fiji-nananu-i-ra.js';
import { windchaserVillasLongBay } from './adapters/windchaser-villas-long-bay.js';
import { windhoekBoutiqueResortBonaire } from './adapters/windhoek-boutique-resort-bonaire.js';
import { windloopGlampingNeuharlingersiel } from './adapters/windloop-glamping-neuharlingersiel.js';
import { windsurfVillagePortoPollo } from './adapters/windsurf-village-porto-pollo.js';
import { windtownLagoonHotelLangebaan } from './adapters/windtown-lagoon-hotel-langebaan.js';

export const adapters: OfferAdapter[] = [
  algarveWatersportZeroToHero,
  alvorkitecenterGuesthouseAlvor,
  amagaliPousadaGalinhos,
  amanpuloPamalican,
  amigosDoVentoTouros,
  anapnoeParoskitePounda,
  antonyBoyViganj,
  babaombyIslandLodgeDiegoSuarez,
  bajaJoesLaVentana,
  batikiteResortJeneponto,
  beachesBonaireKralendijk,
  beekiteVillageMacapa,
  bkcHousesBilene,
  blueDreamKiteboardingResortBahiaSalinas,
  boardroomsBlouberg,
  borkHavnCamping,
  bretterbudeHeiligenhafen,
  bscAtlanticzinEssaouira,
  cabareteBoutiqueKiteHotel,
  campBayLodgeRoatan,
  campingFlueggerStrandFehmarn,
  campingInternationalHyeres,
  campingparkWulfenerHalsFehmarn,
  campingplatzLoissin,
  campingplatzStrandgutCuxhaven,
  campingStrukkamphukFehmarnsund,
  campingTarifaLosLances,
  cantoDasAguasIcarai,
  casaNomadeIlhaDoGuajiru,
  casaSuicaKiteVillasPraiaDoFarol,
  cheShaleMambrui,
  costaKiteBahiaSalinas,
  dagaliSnowkiteCampFagerheim,
  dakhlaAttitudeDakhla,
  dakhlaDownwindChallenge,
  drejbyStrandCampingAls,
  drivethruKiteSurfCampHvideSande,
  dunasLuxuryBeachResortValdevaqueros,
  escapePousadaBarraNova,
  feddetStrandResort,
  ferienwohnungenWestwindSaal,
  filhoDoVentoBarraDoCunhau,
  flagBeachSurfersRetreatCorralejo,
  floripaIspica,
  flyHouseLeba,
  ftfWatersportsZipke,
  gksKiteHouseEsposende,
  grassyFlatsResortMarathon,
  habagatAissatouBoracay,
  highFlyersKiteHouseTarifa,
  hotel100FunValdevaqueros,
  hotelArteVidaLosLances,
  hotelCopacabanaBeachValdevaqueros,
  hotelOrkosBeachMikriVigla,
  hotelPuclaroGualliguaica,
  hvideSandeCamping,
  icaraiKiteVillageAmontada,
  ikarusKiteboardMexicoIslaBlanca,
  inchcapeSeasideVillasSilverSands,
  jaguaribeLodgeFortim,
  jaguarindiaVillageFortim,
  kailuaLodgePelzerhaken,
  kenyawaysDiani,
  kerosBlueLimnos,
  kilomboVillasSibauma,
  kiteactiveXxxlDownwinder,
  kiteBasecampPodsLangebaan,
  kiteBeachInnCabarete,
  kiteBuenHombreEcoLodge,
  kiteCrewCaravansChalupy,
  kitefreedomSantaFeBantayan,
  kitefunSurfHouseTarifa,
  kitehiMauiDownwinder,
  kiteHostelAfricaTarifa,
  kiteHostelStagnoneMarsala,
  kiteHouseSardiniaPuntaTrettu,
  kitekahunasKiteVillaSunsetBeach,
  kiteLodgeBrazilPrea,
  kiteMarinaSarbsk,
  kiteparadiseSakalavaBay,
  kitePassionGlampingPuttgarden,
  kitePlCaravansChalupy,
  kiteSistersBrazil,
  kitesurfingGuimarasSanLorenzo,
  kitesurfingLankaKalpitiya,
  kitesurfmarocEssaouira,
  kitesurfMindoroBulalacao,
  kitesurfTofo,
  kitetribeElGouna,
  kiteVillageHamata,
  kokohauBungalowsSantaVeronica,
  laBallenaAlegreSantPerePescador,
  lakesideParadiseSportHostelKnokkeHeist,
  lakeunitedDjerba,
  lazyKiteSurfHouseTarifa,
  learnkiteboardingnowCampingBbOostvoorne,
  lineupKiteSurfHouseTaiba,
  lionHostelTarifa,
  logosBeachVillageTheologos,
  loopItAcademyApartmentsJastarnia,
  margaritaVillageKalpitiya,
  masirahBeachCampSurMasirah,
  masiraIslandResortMasirah,
  maszoperiaSun4helJastarnia,
  matosApartmentsTarifa,
  mazavaLohaResortDiegoSuarez,
  merEtSelUnionIsland,
  michaelsKiteVacanciesRhodes,
  mounuIslandResortVavau,
  namotuIslandResortMamanuca,
  newSpiritDakhla,
  no22RidersInnAkyaka,
  nohotelLampesPiratenKojeDranske,
  nordseeSurfschuleDomeSeeschwalbeHooksiel,
  nordwindWassersportSurendorf,
  numeroUnoBeachHouseOceanPark,
  oceanSpiritsLodgeBurgau,
  oitiBeachResortTutoia,
  oysterrockLangebaan,
  pajeByNightPaje,
  palapasVentanaLaVentana,
  panamaKiteCenterPuntaChame,
  panamaKiteHouse,
  pandanusResortMuiNe,
  paracuruKiteVillage,
  peahiResortStagnone,
  pensaoAlcindaSantaKiteSal,
  pousadaArmacaoDosVentosIlhabela,
  pousadaBgkBarraGrande,
  pousadaIlhaDoVentoSaoMiguelDoGostoso,
  pousadaMareAltaParajuru,
  pousadaNaturalParkIbiraquera,
  pousadaPaisTropicalIcarai,
  pousadaPortalDoVentoTatajuba,
  pousadaRaia1Ibiraquera,
  prasebanResortPakNamPran,
  proboardingFerienwohnungenKleinZicker,
  puntaTrettuKitesurfHouseSardinia,
  puzaMoyaCapeSportsLangebaan,
  ranchoDoPeixePrea,
  rascalsKiteResortKalpitiya,
  realLaVentanaSupercamp,
  regenbogenBorn,
  regenbogenUmmanz,
  rewitaDelfinJurata,
  ruegenKiteHostelMartinshafen,
  ruukVillageKalpitiya,
  sakalavaLodgeDiegoSuarez,
  saltysKitesurfVillageKilifi,
  seahorseResortMuiNe,
  seaLionBeachResortMuiNe,
  secretIslandKiteCampPalawan,
  sevenBeaufortGuajiru,
  skavenStrandCamping,
  solYMarSurfCampCorralejo,
  sorrentoBeachClubMyHoa,
  strandcampingWallnauFehmarn,
  studiosVrettosPlaka,
  sunsetWaveResortStagnone,
  surfariafrikaDownwinderXl,
  surfariafrikaNamibiaDownwinder,
  surfariafrikaPrimalExplorer,
  surfersResidenceTarifa,
  surfescapeLajares,
  surfHouseKiteZoneChalupy,
  taigaTarifaPuntaPaloma,
  taigaTarifaValdevaqueros,
  tarifaKiteHostelTarifa,
  theBreakersSomaBay,
  theKitesurfLodgeObidos,
  theriderexperienceLosRoques,
  thirtyFiveKnotsMacapa,
  thorsmindeCamping,
  toowettoshredBrazil,
  umiliPodCyprysamiJastarnia,
  ummaiiSurfhostelUmmanz,
  univelaCampioneDelGarda,
  urlaKiteCampGulbahce,
  urlaSurfHouseGulbahce,
  valampuriResortKalpitiya,
  ventanaBayResortElSargento,
  ventusBrazilRoutes,
  vilaGuaraAtins,
  vilancoolVilanculos,
  vilaVentoAtins,
  villaAlohaPraiaDePatos,
  villaEsenciaLongBay,
  villaPefkakiaAgiosNikolaos,
  villaRasaBuzios,
  villaTainaCabarete,
  wadiLahamiVillageHamata,
  watamuBeachCottagesWatamu,
  watersportOmanCampBarAlHikman,
  wattlodgeNorden,
  westpointDakhla,
  whiteWindResortGuajiru,
  wildHouseTarifa,
  wildKitePeruLaMaisonMancora,
  windAdventuresStudioOrientBay,
  windchaserVillasLongBay,
  windhoekBoutiqueResortBonaire,
  windloopGlampingNeuharlingersiel,
  windSportsFijiNananuIRa,
  windsurfVillagePortoPollo,
  windtownLagoonHotelLangebaan,
];

export function adapterByKey(key: string): OfferAdapter | undefined {
  return adapters.find(a => a.key === key);
}
