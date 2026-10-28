// ---------------------------------------------------------------------------
// Every offer adapter, alphabetical. test/offers/registry.test.ts fails when an
// adapter file in src/offers/adapters/ exports an adapter that is missing here.
// ---------------------------------------------------------------------------
import type { OfferAdapter } from './types.js';
import { thirtyFiveKnotsMacapa } from './adapters/35-knots-macapa.js';
import { aboveTheWaterKiteCampCapeTown } from './adapters/above-the-water-kite-camp-cape-town.js';
import { aboveTheWaterKiteYogaCampLangebaan } from './adapters/above-the-water-kite-yoga-camp-langebaan.js';
import { airjunkTokoname } from './adapters/airjunk-tokoname.js';
import { airzoneKiteWingCampRangiputa } from './adapters/airzone-kite-wing-camp-rangiputa.js';
import { algarveWatersportZeroToHero } from './adapters/algarve-watersport-zero-to-hero.js';
import { alvorkitecenterGuesthouseAlvor } from './adapters/alvorkitecenter-guesthouse-alvor.js';
import { amagaliPousadaGalinhos } from './adapters/amagali-pousada-galinhos.js';
import { amanpuloPamalican } from './adapters/amanpulo-pamalican.js';
import { amigosDoVentoTouros } from './adapters/amigos-do-vento-touros.js';
import { anapnoeParoskitePounda } from './adapters/anapnoe-paroskite-pounda.js';
import { antonyBoyViganj } from './adapters/antony-boy-viganj.js';
import { apexSnowKitingTourKosciuszko } from './adapters/apex-snow-kiting-tour-kosciuszko.js';
import { aquaVentanaLaVentana } from './adapters/aqua-ventana-la-ventana.js';
import { azulBeachKiteResortElSargento } from './adapters/azul-beach-kite-resort-el-sargento.js';
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
import { cabareteKitePoint7DayAllInclusive } from './adapters/cabarete-kite-point-7-day-all-inclusive.js';
import { campBayLodgeRoatan } from './adapters/camp-bay-lodge-roatan.js';
import { campingFlueggerStrandFehmarn } from './adapters/camping-fluegger-strand-fehmarn.js';
import { campingInternationalHyeres } from './adapters/camping-international-hyeres.js';
import { campingStrukkamphukFehmarnsund } from './adapters/camping-strukkamphuk-fehmarnsund.js';
import { campingTarifaLosLances } from './adapters/camping-tarifa-los-lances.js';
import { campingparkWulfenerHalsFehmarn } from './adapters/campingpark-wulfener-hals-fehmarn.js';
import { campingplatzLoissin } from './adapters/campingplatz-loissin.js';
import { campingplatzStrandgutCuxhaven } from './adapters/campingplatz-strandgut-cuxhaven.js';
import { cantoDasAguasIcarai } from './adapters/canto-das-aguas-icarai.js';
import { casaNoCampoKiteWingCampPortoCovo } from './adapters/casa-no-campo-kite-wing-camp-porto-covo.js';
import { casaNomadeIlhaDoGuajiru } from './adapters/casa-nomade-ilha-do-guajiru.js';
import { casaSuicaKiteVillasPraiaDoFarol } from './adapters/casa-suica-kite-villas-praia-do-farol.js';
import { cascadeKiteboardingMauiWinterCamp } from './adapters/cascade-kiteboarding-maui-winter-camp.js';
import { cbcmKiteSurfCampCorralejo } from './adapters/cbcm-kite-surf-camp-corralejo.js';
import { cheShaleMambrui } from './adapters/che-shale-mambrui.js';
import { chilochillLaVentana } from './adapters/chilochill-la-ventana.js';
import { costaKiteBahiaSalinas } from './adapters/costa-kite-bahia-salinas.js';
import { dagaliSnowkiteCampFagerheim } from './adapters/dagali-snowkite-camp-fagerheim.js';
import { dakhlaAttitudeDakhla } from './adapters/dakhla-attitude-dakhla.js';
import { dakhlaDownwindChallenge } from './adapters/dakhla-downwind-challenge.js';
import { dakhlaEvasionFreeRideCamp } from './adapters/dakhla-evasion-free-ride-camp.js';
import { djerbakiteVillaSedouikech } from './adapters/djerbakite-villa-sedouikech.js';
import { drejbyStrandCampingAls } from './adapters/drejby-strand-camping-als.js';
import { drivethruKiteSurfCampHvideSande } from './adapters/drivethru-kite-surf-camp-hvide-sande.js';
import { dunasLuxuryBeachResortValdevaqueros } from './adapters/dunas-luxury-beach-resort-valdevaqueros.js';
import { elevationNitinatLakeKiteWingCamps } from './adapters/elevation-nitinat-lake-kite-wing-camps.js';
import { escapeEcoFijiKitesurfTourKorolevu } from './adapters/escape-eco-fiji-kitesurf-tour-korolevu.js';
import { escapeEcoIndonesiaKitesurfTourJeneponto } from './adapters/escape-eco-indonesia-kitesurf-tour-jeneponto.js';
import { escapeEcoSriLankaKitesurfTourKalpitiya } from './adapters/escape-eco-sri-lanka-kitesurf-tour-kalpitiya.js';
import { escapePousadaBarraNova } from './adapters/escape-pousada-barra-nova.js';
import { essaouiraWatersportsKitePackage } from './adapters/essaouira-watersports-kite-package-essaouira.js';
import { exotikiteBajaWaveCamps } from './adapters/exotikite-baja-wave-camps.js';
import { expeditionsUnlimitedGreenlandSnowkiteCrossing } from './adapters/expeditions-unlimited-greenland-snowkite-crossing.js';
import { feddetStrandResort } from './adapters/feddet-strand-resort.js';
import { ferienwohnungenWestwindSaal } from './adapters/ferienwohnungen-westwind-saal.js';
import { filhoDoVentoBarraDoCunhau } from './adapters/filho-do-vento-barra-do-cunhau.js';
import { flagBeachSurfersRetreatCorralejo } from './adapters/flag-beach-surfers-retreat-corralejo.js';
import { florasLakeHouseLanglois } from './adapters/floras-lake-house-langlois.js';
import { floripaIspica } from './adapters/floripa-ispica.js';
import { flyHouseLeba } from './adapters/fly-house-leba.js';
import { freerideKitesurfDownwindRioGrandeDoNorte } from './adapters/freeride-kitesurf-downwind-rio-grande-do-norte.js';
import { freerideKitesurfDownwindWildNorth } from './adapters/freeride-kitesurf-downwind-wild-north.js';
import { freeridersMegaDownwinderKalpitiyaMannar } from './adapters/freeriders-mega-downwinder-kalpitiya-mannar.js';
import { ftfWatersportsZipke } from './adapters/ftf-watersports-zipke.js';
import { funbaseUruma } from './adapters/funbase-uruma.js';
import { getHighKiteCampHamata } from './adapters/get-high-kite-camp-hamata.js';
import { getHighKiteCampLoStagnone } from './adapters/get-high-kite-camp-lo-stagnone.js';
import { getHighKiteCampTheologos } from './adapters/get-high-kite-camp-theologos.js';
import { gksKiteHouseEsposende } from './adapters/gks-kite-house-esposende.js';
import { globalKiteTripsKiteSafariColombia } from './adapters/global-kite-trips-kite-safari-colombia.js';
import { globalKiteTripsProgressionCampCumbuco } from './adapters/global-kite-trips-progression-camp-cumbuco.js';
import { gnaralooStation3MileCamp } from './adapters/gnaraloo-station-3-mile-camp.js';
import { gnaralooStationHomestead } from './adapters/gnaraloo-station-homestead.js';
import { grassyFlatsResortMarathon } from './adapters/grassy-flats-resort-marathon.js';
import { guesthouseMiyakojimaMAirKite } from './adapters/guesthouse-miyakojima-m-air-kite.js';
import { habagatAissatouBoracay } from './adapters/habagat-aissatou-boracay.js';
import { haggerstoneIslandResort } from './adapters/haggerstone-island-resort.js';
import { hatterasIslandVacationRentalsAvon } from './adapters/hatteras-island-vacation-rentals-avon.js';
import { haugastolTuristsenterHardangervidda } from './adapters/haugastol-turistsenter-hardangervidda.js';
import { haukeliseterFjellstueHaukelifjell } from './adapters/haukeliseter-fjellstue-haukelifjell.js';
import { highFlyersKiteHouseTarifa } from './adapters/high-flyers-kite-house-tarifa.js';
import { hotel100FunValdevaqueros } from './adapters/hotel-100-fun-valdevaqueros.js';
import { hotelArteVidaLosLances } from './adapters/hotel-arte-vida-los-lances.js';
import { hotelCopacabanaBeachValdevaqueros } from './adapters/hotel-copacabana-beach-valdevaqueros.js';
import { hotelOrkosBeachMikriVigla } from './adapters/hotel-orkos-beach-mikri-vigla.js';
import { hotelPuclaroGualliguaica } from './adapters/hotel-puclaro-gualliguaica.js';
import { hotelTodoBienElSargento } from './adapters/hotel-todo-bien-el-sargento.js';
import { hvideSandeCamping } from './adapters/hvide-sande-camping.js';
import { icaraiKiteVillageAmontada } from './adapters/icarai-kite-village-amontada.js';
import { ikarusKiteboardMexicoIslaBlanca } from './adapters/ikarus-kiteboard-mexico-isla-blanca.js';
import { inchcapeSeasideVillasSilverSands } from './adapters/inchcape-seaside-villas-silver-sands.js';
import { ionClubOasis212LessonsPackageDakhla } from './adapters/ion-club-oasis212-lessons-package-dakhla.js';
import { ionClubPastorinoCampDakhla } from './adapters/ion-club-pastorino-camp-dakhla.js';
import { jaguaribeLodgeFortim } from './adapters/jaguaribe-lodge-fortim.js';
import { jaguarindiaVillageFortim } from './adapters/jaguarindia-village-fortim.js';
import { jejuKiteLabSinyang } from './adapters/jeju-kite-lab-sinyang.js';
import { kahunaAdultsKiteCampKiti } from './adapters/kahuna-adults-kite-camp-kiti.js';
import { kailuaLodgePelzerhaken } from './adapters/kailua-lodge-pelzerhaken.js';
import { kbcAdventureWeekLoStagnone } from './adapters/kbc-adventure-week-lo-stagnone.js';
import { kenyawaysDiani } from './adapters/kenyaways-diani.js';
import { kerosBlueLimnos } from './adapters/keros-blue-limnos.js';
import { kilomboVillasSibauma } from './adapters/kilombo-villas-sibauma.js';
import { kiteAventureAmwejDjerbahood } from './adapters/kite-aventure-amwej-djerbahood.js';
import { kiteBasecampPodsLangebaan } from './adapters/kite-basecamp-pods-langebaan.js';
import { kiteBeachInnCabarete } from './adapters/kite-beach-inn-cabarete.js';
import { kiteBuenHombre10DaySpecial } from './adapters/kite-buen-hombre-10-day-special.js';
import { kiteBuenHombre7DaySpecial } from './adapters/kite-buen-hombre-7-day-special.js';
import { kiteBuenHombreEcoLodge } from './adapters/kite-buen-hombre-eco-lodge.js';
import { kiteClubHatterasAvon } from './adapters/kite-club-hatteras-avon.js';
import { kiteClubHatterasCampAvon } from './adapters/kite-club-hatteras-camp-avon.js';
import { kiteCollegeDaenemarkRingkobingFjord } from './adapters/kite-college-daenemark-ringkobing-fjord.js';
import { kiteCrewCaravansChalupy } from './adapters/kite-crew-caravans-chalupy.js';
import { kiteHostelAfricaTarifa } from './adapters/kite-hostel-africa-tarifa.js';
import { kiteHostelStagnoneMarsala } from './adapters/kite-hostel-stagnone-marsala.js';
import { kiteHouseSardiniaPuntaTrettu } from './adapters/kite-house-sardinia-punta-trettu.js';
import { kiteLodgeBrazilPrea } from './adapters/kite-lodge-brazil-prea.js';
import { kiteMarinaSarbsk } from './adapters/kite-marina-sarbsk.js';
import { kiteMeUpHostelKiteCampLoStagnone } from './adapters/kite-me-up-hostel-kite-camp-lo-stagnone.js';
import { kiteNomadeArraialDoCabo } from './adapters/kite-nomade-arraial-do-cabo.js';
import { kitePassionGlampingPuttgarden } from './adapters/kite-passion-glamping-puttgarden.js';
import { kitePlCaravansChalupy } from './adapters/kite-pl-caravans-chalupy.js';
import { kitekursSnowkiteWeekendHaugastol } from './adapters/kitekurs-snowkite-weekend-haugastol.js';
import { kiteskolenSnowkiteCourseHaukeliseter } from './adapters/kiteskolen-snowkite-course-haukeliseter.js';
import { kiteRepublicAitutakiWinterEscape } from './adapters/kite-republic-aitutaki-winter-escape.js';
import { kiteRepublicBrazilKiteSafari } from './adapters/kite-republic-brazil-kite-safari.js';
import { kiteRepublicMauritiusWavesDreamWinterEscape } from './adapters/kite-republic-mauritius-waves-dream-winter-escape.js';
import { kiteSistersBrazil } from './adapters/kite-sisters-brazil.js';
import { kiteSistersEssentialCampPeru } from './adapters/kite-sisters-essential-camp-peru.js';
import { kiteSistersMoroccoRetreat } from './adapters/kite-sisters-morocco-retreat.js';
import { kiteSuitesPraiaSeca } from './adapters/kite-suites-praia-seca.js';
import { kiteThailandPackageAPranburi } from './adapters/kite-thailand-package-a-pranburi.js';
import { kiteThailandPackageBHuaHin } from './adapters/kite-thailand-package-b-hua-hin.js';
import { kiteThailandPackageBKohPhangan } from './adapters/kite-thailand-package-b-koh-phangan.js';
import { kiteVillageHamata } from './adapters/kite-village-hamata.js';
import { kiteactiveXxxlDownwinder } from './adapters/kiteactive-xxxl-downwinder.js';
import { kiteadventureColombiaCourseStayMayapo } from './adapters/kiteadventure-colombia-course-stay-mayapo.js';
import { kiteboardingColombiaWildNorthKiteTrip } from './adapters/kiteboarding-colombia-wild-north-kite-trip.js';
import { kiteclubOkinawaKohamaKiteTour } from './adapters/kiteclub-okinawa-kohama-kite-tour.js';
import { kiteclubOkinawaKumejimaTour } from './adapters/kiteclub-okinawa-kumejima-tour.js';
import { kiteforceTyrolSnowkiteTrip } from './adapters/kiteforce-tyrol-snowkite-trip.js';
import { kitefreedomSantaFeBantayan } from './adapters/kitefreedom-santa-fe-bantayan.js';
import { kitefunSurfHouseTarifa } from './adapters/kitefun-surf-house-tarifa.js';
import { kitegenerationKiteCampPuntaTrettu } from './adapters/kitegeneration-kite-camp-punta-trettu.js';
import { kitehiMauiDownwinder } from './adapters/kitehi-maui-downwinder.js';
import { kitekahunasKiteVillaSunsetBeach } from './adapters/kitekahunas-kite-villa-sunset-beach.js';
import { kitemexCampLaVentana } from './adapters/kitemex-camp-la-ventana.js';
import { kitemotionCourseStayDiani } from './adapters/kitemotion-course-stay-diani.js';
import { kiteparadiseSakalavaBay } from './adapters/kiteparadise-sakalava-bay.js';
import { kitereizenKiteCampMyHoaPhanRang } from './adapters/kitereizen-kite-camp-my-hoa-phan-rang.js';
import { kitereizenMauritiusResidencyBelOmbre } from './adapters/kitereizen-mauritius-residency-bel-ombre.js';
import { kiteridersMontenegroCampUlcinj } from './adapters/kiteriders-montenegro-camp-ulcinj.js';
import { kitesurfAdventureCumbucoClassic } from './adapters/kitesurf-adventure-cumbuco-classic.js';
import { kitesurfAdventureIlhaExperienceGuajiru } from './adapters/kitesurf-adventure-ilha-experience-guajiru.js';
import { kitesurfMindoroBulalacao } from './adapters/kitesurf-mindoro-bulalacao.js';
import { kitesurfMindoroIslandKiteSafariBulalacao } from './adapters/kitesurf-mindoro-island-kite-safari-bulalacao.js';
import { kitesurfSchoolDubaiSriLankaCampKalpitiya } from './adapters/kitesurf-school-dubai-sri-lanka-camp-kalpitiya.js';
import { kitesurfTofo } from './adapters/kitesurf-tofo.js';
import { kitesurfingGuimarasSanLorenzo } from './adapters/kitesurfing-guimaras-san-lorenzo.js';
import { kitesurfingLankaKalpitiya } from './adapters/kitesurfing-lanka-kalpitiya.js';
import { kitesurfingLankaLearnToKiteKalpitiya } from './adapters/kitesurfing-lanka-learn-to-kite-kalpitiya.js';
import { kitesurfmarocEssaouira } from './adapters/kitesurfmaroc-essaouira.js';
import { kitetribeElGouna } from './adapters/kitetribe-el-gouna.js';
import { kitewestWaveFreestyleCampCoronationBeach } from './adapters/kitewest-wave-freestyle-camp-coronation-beach.js';
import { kitexciteStayAndPlayCabarete } from './adapters/kitexcite-stay-and-play-cabarete.js';
import { kokohauBungalowsSantaVeronica } from './adapters/kokohau-bungalows-santa-veronica.js';
import { laBallenaAlegreSantPerePescador } from './adapters/la-ballena-alegre-sant-pere-pescador.js';
import { laVentanaBeachResort } from './adapters/la-ventana-beach-resort.js';
import { laVentanaHotel } from './adapters/la-ventana-hotel.js';
import { lakesideParadiseSportHostelKnokkeHeist } from './adapters/lakeside-paradise-sport-hostel-knokke-heist.js';
import { lakeunitedDjerba } from './adapters/lakeunited-djerba.js';
import { lakeunitedKitecampSouthAfricaLangebaanCapeTown } from './adapters/lakeunited-kitecamp-south-africa-langebaan-cape-town.js';
import { lakeunitedSnowkitecampNorwayVoringsfoss } from './adapters/lakeunited-snowkitecamp-norway-voringsfoss.js';
import { latitudesNordFinseSnowkiteWeeks } from './adapters/latitudes-nord-finse-snowkite-weeks.js';
import { latitudesNordSnowkiteCapNord } from './adapters/latitudes-nord-snowkite-cap-nord.js';
import { latitudesNordSnowkiteIcelandVolcanoes } from './adapters/latitudes-nord-snowkite-iceland-volcanoes.js';
import { latitudesNordSnowkiteLightRyfylkeSetesdal } from './adapters/latitudes-nord-snowkite-light-ryfylke-setesdal.js';
import { latitudesNordSnowkiteNordkinnVaranger } from './adapters/latitudes-nord-snowkite-nordkinn-varanger.js';
import { lazyKiteSurfHouseTarifa } from './adapters/lazy-kite-surf-house-tarifa.js';
import { lePapayerEcolodgeKitesurfCampCapSkirring } from './adapters/le-papayer-ecolodge-kitesurf-camp-cap-skirring.js';
import { learnkiteboardingnowCampingBbOostvoorne } from './adapters/learnkiteboardingnow-camping-bb-oostvoorne.js';
import { len10StigRubenBrazilTatajuba } from './adapters/len10-stig-ruben-brazil-tatajuba.js';
import { letsgokiteWestaustralienKitesafari } from './adapters/letsgokite-westaustralien-kitesafari.js';
import { lineupKiteSurfHouseTaiba } from './adapters/lineup-kite-surf-house-taiba.js';
import { lionHostelTarifa } from './adapters/lion-hostel-tarifa.js';
import { logosBeachVillageTheologos } from './adapters/logos-beach-village-theologos.js';
import { loopItAcademyApartmentsJastarnia } from './adapters/loop-it-academy-apartments-jastarnia.js';
import { lvkcVillaBrisaLaVentana } from './adapters/lvkc-villa-brisa-la-ventana.js';
import { margaritaVillageKalpitiya } from './adapters/margarita-village-kalpitiya.js';
import { masiraIslandResortMasirah } from './adapters/masira-island-resort-masirah.js';
import { masirahBeachCampSurMasirah } from './adapters/masirah-beach-camp-sur-masirah.js';
import { maszoperiaSun4helJastarnia } from './adapters/maszoperia-sun4hel-jastarnia.js';
import { matosApartmentsTarifa } from './adapters/matos-apartments-tarifa.js';
import { mauritiusSurfHolidaysKiteCampLaGaulette } from './adapters/mauritius-surf-holidays-kite-camp-la-gaulette.js';
import { mazavaLohaResortDiegoSuarez } from './adapters/mazava-loha-resort-diego-suarez.js';
import { merEtSelUnionIsland } from './adapters/mer-et-sel-union-island.js';
import { mfKiteStageCasaAlmaAlmanarre } from './adapters/mf-kite-stage-casa-alma-almanarre.js';
import { michaelsKiteVacanciesRhodes } from './adapters/michaels-kite-vacancies-rhodes.js';
import { mogasurfKiteCampVillaSidiKaouki } from './adapters/mogasurf-kite-camp-villa-sidi-kaouki.js';
import { mounuIslandResortVavau } from './adapters/mounu-island-resort-vavau.js';
import { mySaltySistersRetreatElGouna } from './adapters/my-salty-sisters-retreat-el-gouna.js';
import { mySaltySistersRetreatKremasti } from './adapters/my-salty-sisters-retreat-kremasti.js';
import { namotuIslandResortMamanuca } from './adapters/namotu-island-resort-mamanuca.js';
import { naneakite8DayCampEssaouira } from './adapters/naneakite-8-day-camp-essaouira.js';
import { newSpiritDakhla } from './adapters/new-spirit-dakhla.js';
import { nicekiteLessonCampKaseda } from './adapters/nicekite-lesson-camp-kaseda.js';
import { nitinahtWindsurfParkCabinsNitinatLake } from './adapters/nitinaht-windsurf-park-cabins-nitinat-lake.js';
import { no22RidersInnAkyaka } from './adapters/no22-riders-inn-akyaka.js';
import { nohotelLampesPiratenKojeDranske } from './adapters/nohotel-lampes-piraten-koje-dranske.js';
import { nordseeSurfschuleDomeSeeschwalbeHooksiel } from './adapters/nordsee-surfschule-dome-seeschwalbe-hooksiel.js';
import { nordseewindsportKitecampRingkobingFjord } from './adapters/nordseewindsport-kitecamp-ringkobing-fjord.js';
import { nordwindWassersportSurendorf } from './adapters/nordwind-wassersport-surendorf.js';
import { numeroUnoBeachHouseOceanPark } from './adapters/numero-uno-beach-house-ocean-park.js';
import { oasisKiteKitecampDjerba } from './adapters/oasis-kite-kitecamp-djerba.js';
import { oceanSpiritsLodgeBurgau } from './adapters/ocean-spirits-lodge-burgau.js';
import { oitiBeachResortTutoia } from './adapters/oiti-beach-resort-tutoia.js';
import { olandkiteProgressionKitecampFarjestaden } from './adapters/olandkite-progression-kitecamp-farjestaden.js';
import { oysterrockLangebaan } from './adapters/oysterrock-langebaan.js';
import { pajeByNightPaje } from './adapters/paje-by-night-paje.js';
import { palapasVentanaLaVentana } from './adapters/palapas-ventana-la-ventana.js';
import { pallasKiteweekLappisPallas } from './adapters/pallas-kiteweek-lappis-pallas.js';
import { panamaKiteCenterPuntaChame } from './adapters/panama-kite-center-punta-chame.js';
import { panamaKiteHouse } from './adapters/panama-kite-house.js';
import { pandanusResortMuiNe } from './adapters/pandanus-resort-mui-ne.js';
import { paracuruKiteVillage } from './adapters/paracuru-kite-village.js';
import { peahiResortStagnone } from './adapters/peahi-resort-stagnone.js';
import { penghuKitesurfSunriseBnbGuoye } from './adapters/penghu-kitesurf-sunrise-bnb-guoye.js';
import { pensaoAlcindaSantaKiteSal } from './adapters/pensao-alcinda-santa-kite-sal.js';
import { playLosRoquesAdvancedKiteCampGranRoque } from './adapters/play-los-roques-advanced-kite-camp-gran-roque.js';
import { playLosRoquesKitesurfDiscoveryGranRoque } from './adapters/play-los-roques-kitesurf-discovery-gran-roque.js';
import { playaCentralCampsLaVentana } from './adapters/playa-central-camps-la-ventana.js';
import { pousadaArmacaoDosVentosIlhabela } from './adapters/pousada-armacao-dos-ventos-ilhabela.js';
import { pousadaBgkBarraGrande } from './adapters/pousada-bgk-barra-grande.js';
import { pousadaIlhaDoVentoSaoMiguelDoGostoso } from './adapters/pousada-ilha-do-vento-sao-miguel-do-gostoso.js';
import { pousadaMareAltaParajuru } from './adapters/pousada-mare-alta-parajuru.js';
import { pousadaNaturalParkIbiraquera } from './adapters/pousada-natural-park-ibiraquera.js';
import { pousadaPaisTropicalIcarai } from './adapters/pousada-pais-tropical-icarai.js';
import { pousadaPortalDoVentoTatajuba } from './adapters/pousada-portal-do-vento-tatajuba.js';
import { pousadaRaia1Ibiraquera } from './adapters/pousada-raia-1-ibiraquera.js';
import { prasebanResortPakNamPran } from './adapters/praseban-resort-pak-nam-pran.js';
import { primesurfKiteCampHvideSande } from './adapters/primesurf-kite-camp-hvide-sande.js';
import { proboardingFerienwohnungenKleinZicker } from './adapters/proboarding-ferienwohnungen-klein-zicker.js';
import { puntaTrettuKitesurfHouseSardinia } from './adapters/punta-trettu-kitesurf-house-sardinia.js';
import { puzaMoyaCapeSportsLangebaan } from './adapters/puza-moya-cape-sports-langebaan.js';
import { questIslandHoppingKiteSafariRameswaram } from './adapters/quest-island-hopping-kite-safari-rameswaram.js';
import { questSpiceCoastExpeditionKiteSafariTamilNadu } from './adapters/quest-spice-coast-expedition-kite-safari-tamil-nadu.js';
import { ranchoDoPeixePrea } from './adapters/rancho-do-peixe-prea.js';
import { rascalsKiteResortKalpitiya } from './adapters/rascals-kite-resort-kalpitiya.js';
import { realLaVentanaSupercamp } from './adapters/real-la-ventana-supercamp.js';
import { redStarSurfKiteCampFamara } from './adapters/red-star-surf-kite-camp-famara.js';
import { regenbogenBorn } from './adapters/regenbogen-born.js';
import { regenbogenUmmanz } from './adapters/regenbogen-ummanz.js';
import { rewitaDelfinJurata } from './adapters/rewita-delfin-jurata.js';
import { rideKitesurfingTroubridgeIslandTrip } from './adapters/ride-kitesurfing-troubridge-island-trip.js';
import { road2adventureKiteSafariPerthExmouth } from './adapters/road2adventure-kite-safari-perth-exmouth.js';
import { ruegenKiteHostelMartinshafen } from './adapters/ruegen-kite-hostel-martinshafen.js';
import { ruukVillageKalpitiya } from './adapters/ruuk-village-kalpitiya.js';
import { ruukVillageZeroToHeroKalpitiya } from './adapters/ruuk-village-zero-to-hero-kalpitiya.js';
import { sakalavaLodgeAllInclusiveKiteWingHoliday } from './adapters/sakalava-lodge-all-inclusive-kite-wing-holiday.js';
import { sakalavaLodgeDiegoSuarez } from './adapters/sakalava-lodge-diego-suarez.js';
import { saltysKitesurfVillageKilifi } from './adapters/saltys-kitesurf-village-kilifi.js';
import { seaLionBeachResortMuiNe } from './adapters/sea-lion-beach-resort-mui-ne.js';
import { seahorseResortMuiNe } from './adapters/seahorse-resort-mui-ne.js';
import { secretIslandKiteCampPalawan } from './adapters/secret-island-kite-camp-palawan.js';
import { sevenBeaufortGuajiru } from './adapters/seven-beaufort-guajiru.js';
import { sharkbayKitesurfingProgressionDenham } from './adapters/sharkbay-kitesurfing-progression-denham.js';
import { skavenStrandCamping } from './adapters/skaven-strand-camping.js';
import { solYMarSurfCampCorralejo } from './adapters/sol-y-mar-surf-camp-corralejo.js';
import { sorrentoBeachClubMyHoa } from './adapters/sorrento-beach-club-my-hoa.js';
import { strandcampingWallnauFehmarn } from './adapters/strandcamping-wallnau-fehmarn.js';
import { studiosVrettosPlaka } from './adapters/studios-vrettos-plaka.js';
import { sunsetWaveResortStagnone } from './adapters/sunset-wave-resort-stagnone.js';
import { surfHouseKiteZoneChalupy } from './adapters/surf-house-kite-zone-chalupy.js';
import { surfHubKitesurfingCampSal } from './adapters/surf-hub-kitesurfing-camp-sal.js';
import { surfariafrikaDownwinderXl, surfariafrikaNamibiaDownwinder, surfariafrikaPrimalExplorer } from './adapters/surfariafrika.js';
import { surfersResidenceTarifa } from './adapters/surfers-residence-tarifa.js';
import { surfescapeLajares } from './adapters/surfescape-lajares.js';
import { swissKitesurfCampLoStagnone } from './adapters/swiss-kitesurf-camp-lo-stagnone.js';
import { swissKitesurfCampSomaBay } from './adapters/swiss-kitesurf-camp-soma-bay.js';
import { swissSnowkitingSchoolPackagesSimplon } from './adapters/swiss-snowkiting-school-packages-simplon.js';
import { taigaTarifaPuntaPaloma } from './adapters/taiga-tarifa-punta-paloma.js';
import { taigaTarifaValdevaqueros } from './adapters/taiga-tarifa-valdevaqueros.js';
import { tarifaKiteHostelTarifa } from './adapters/tarifa-kite-hostel-tarifa.js';
import { theBreakersSomaBay } from './adapters/the-breakers-soma-bay.js';
import { theKitesurfLodgeObidos } from './adapters/the-kitesurf-lodge-obidos.js';
import { theriderexperienceLosRoques } from './adapters/theriderexperience-los-roques.js';
import { thorsmindeCamping } from './adapters/thorsminde-camping.js';
import { toowettoshredBrazil } from './adapters/toowettoshred-brazil.js';
import { toowettoshredKiteCampFanes } from './adapters/toowettoshred-kite-camp-fanes.js';
import { travelActiveClubMadagascarKiteTrip } from './adapters/travel-active-club-madagascar-kite-trip.js';
import { travelActiveClubOmanKiteTrip } from './adapters/travel-active-club-oman-kite-trip.js';
import { trueSurfersVietnamKiteTourMuiNePhanRang } from './adapters/true-surfers-vietnam-kite-tour-mui-ne-phan-rang.js';
import { umiliPodCyprysamiJastarnia } from './adapters/umili-pod-cyprysami-jastarnia.js';
import { ummaiiSurfhostelUmmanz } from './adapters/ummaii-surfhostel-ummanz.js';
import { unchartedKiteSessionsFredHopeFoilMasterCabarete } from './adapters/uncharted-kite-sessions-fred-hope-foil-master-cabarete.js';
import { unchartedKiteSessionsStraplessWeekCabarete } from './adapters/uncharted-kite-sessions-strapless-week-cabarete.js';
import { univelaCampioneDelGarda } from './adapters/univela-campione-del-garda.js';
import { urlaKiteCampGulbahce } from './adapters/urla-kite-camp-gulbahce.js';
import { urlaSurfHouseGulbahce } from './adapters/urla-surf-house-gulbahce.js';
import { valampuriBungalowWeekKalpitiya } from './adapters/valampuri-bungalow-week-kalpitiya.js';
import { valampuriResortKalpitiya } from './adapters/valampuri-resort-kalpitiya.js';
import { velaBajaLosBarriles } from './adapters/vela-baja-los-barriles.js';
import { ventanaBayResortElSargento } from './adapters/ventana-bay-resort-el-sargento.js';
import { ventusBrazilRoutes } from './adapters/ventus-brazil-routes.js';
import { versusSnowkiteTripHaugastol } from './adapters/versus-snowkite-trip-haugastol.js';
import { vilaGuaraAtins } from './adapters/vila-guara-atins.js';
import { vilaVentoAtins } from './adapters/vila-vento-atins.js';
import { vilancoolVilanculos } from './adapters/vilancool-vilanculos.js';
import { villaAlohaPraiaDePatos } from './adapters/villa-aloha-praia-de-patos.js';
import { villaEsenciaLongBay } from './adapters/villa-esencia-long-bay.js';
import { villaPefkakiaAgiosNikolaos } from './adapters/villa-pefkakia-agios-nikolaos.js';
import { villaRasaBuzios } from './adapters/villa-rasa-buzios.js';
import { villaTainaCabarete } from './adapters/villa-taina-cabarete.js';
import { wadiLahamiVillageHamata } from './adapters/wadi-lahami-village-hamata.js';
import { wahooWindHotelHondoLosBarriles } from './adapters/wahoo-wind-hotel-hondo-los-barriles.js';
import { watamuBeachCottagesWatamu } from './adapters/watamu-beach-cottages-watamu.js';
import { watermensRetreatWaves } from './adapters/watermens-retreat-waves.js';
import { watersportOmanCampBarAlHikman } from './adapters/watersport-oman-camp-bar-al-hikman.js';
import { wattlodgeNorden } from './adapters/wattlodge-norden.js';
import { waveCultureKiteCampElMedano } from './adapters/wave-culture-kite-camp-el-medano.js';
import { westpointDakhla } from './adapters/westpoint-dakhla.js';
import { whiteWindResortGuajiru } from './adapters/white-wind-resort-guajiru.js';
import { wildHouseTarifa } from './adapters/wild-house-tarifa.js';
import { wildKitePeruLaMaisonMancora } from './adapters/wild-kite-peru-la-maison-mancora.js';
import { windAdventuresStudioOrientBay } from './adapters/wind-adventures-studio-orient-bay.js';
import { windSportsCenterKiteweekBoaVista } from './adapters/wind-sports-center-kiteweek-boa-vista.js';
import { windSportsCenterSurfKiteweekBoaVista } from './adapters/wind-sports-center-surf-kiteweek-boa-vista.js';
import { windSportsFijiNananuIRa } from './adapters/wind-sports-fiji-nananu-i-ra.js';
import { windchaserVillasLongBay } from './adapters/windchaser-villas-long-bay.js';
import { windhoekBoutiqueResortBonaire } from './adapters/windhoek-boutique-resort-bonaire.js';
import { windloopGlampingNeuharlingersiel } from './adapters/windloop-glamping-neuharlingersiel.js';
import { windsurfVillagePortoPollo } from './adapters/windsurf-village-porto-pollo.js';
import { windtownLagoonHotelLangebaan } from './adapters/windtown-lagoon-hotel-langebaan.js';
import { xFlyKiteboardingCampMiyako } from './adapters/x-fly-kiteboarding-camp-miyako.js';
import { zephyrWaOffroadAdventureExmouth } from './adapters/zephyr-wa-offroad-adventure-exmouth.js';

export const adapters: OfferAdapter[] = [
  aboveTheWaterKiteCampCapeTown,
  aboveTheWaterKiteYogaCampLangebaan,
  airjunkTokoname,
  airzoneKiteWingCampRangiputa,
  algarveWatersportZeroToHero,
  alvorkitecenterGuesthouseAlvor,
  amagaliPousadaGalinhos,
  amanpuloPamalican,
  amigosDoVentoTouros,
  anapnoeParoskitePounda,
  antonyBoyViganj,
  apexSnowKitingTourKosciuszko,
  aquaVentanaLaVentana,
  azulBeachKiteResortElSargento,
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
  cabareteKitePoint7DayAllInclusive,
  campBayLodgeRoatan,
  campingFlueggerStrandFehmarn,
  campingInternationalHyeres,
  campingparkWulfenerHalsFehmarn,
  campingplatzLoissin,
  campingplatzStrandgutCuxhaven,
  campingStrukkamphukFehmarnsund,
  campingTarifaLosLances,
  cantoDasAguasIcarai,
  casaNoCampoKiteWingCampPortoCovo,
  casaNomadeIlhaDoGuajiru,
  casaSuicaKiteVillasPraiaDoFarol,
  cascadeKiteboardingMauiWinterCamp,
  cbcmKiteSurfCampCorralejo,
  cheShaleMambrui,
  chilochillLaVentana,
  costaKiteBahiaSalinas,
  dagaliSnowkiteCampFagerheim,
  dakhlaAttitudeDakhla,
  dakhlaDownwindChallenge,
  dakhlaEvasionFreeRideCamp,
  djerbakiteVillaSedouikech,
  drejbyStrandCampingAls,
  drivethruKiteSurfCampHvideSande,
  dunasLuxuryBeachResortValdevaqueros,
  elevationNitinatLakeKiteWingCamps,
  escapeEcoFijiKitesurfTourKorolevu,
  escapeEcoIndonesiaKitesurfTourJeneponto,
  escapeEcoSriLankaKitesurfTourKalpitiya,
  escapePousadaBarraNova,
  essaouiraWatersportsKitePackage,
  exotikiteBajaWaveCamps,
  expeditionsUnlimitedGreenlandSnowkiteCrossing,
  feddetStrandResort,
  ferienwohnungenWestwindSaal,
  filhoDoVentoBarraDoCunhau,
  flagBeachSurfersRetreatCorralejo,
  florasLakeHouseLanglois,
  floripaIspica,
  flyHouseLeba,
  freerideKitesurfDownwindRioGrandeDoNorte,
  freerideKitesurfDownwindWildNorth,
  freeridersMegaDownwinderKalpitiyaMannar,
  ftfWatersportsZipke,
  funbaseUruma,
  getHighKiteCampHamata,
  getHighKiteCampLoStagnone,
  getHighKiteCampTheologos,
  gksKiteHouseEsposende,
  globalKiteTripsKiteSafariColombia,
  globalKiteTripsProgressionCampCumbuco,
  gnaralooStation3MileCamp,
  gnaralooStationHomestead,
  grassyFlatsResortMarathon,
  guesthouseMiyakojimaMAirKite,
  habagatAissatouBoracay,
  haggerstoneIslandResort,
  hatterasIslandVacationRentalsAvon,
  haugastolTuristsenterHardangervidda,
  haukeliseterFjellstueHaukelifjell,
  highFlyersKiteHouseTarifa,
  hotel100FunValdevaqueros,
  hotelArteVidaLosLances,
  hotelCopacabanaBeachValdevaqueros,
  hotelOrkosBeachMikriVigla,
  hotelPuclaroGualliguaica,
  hotelTodoBienElSargento,
  hvideSandeCamping,
  icaraiKiteVillageAmontada,
  ikarusKiteboardMexicoIslaBlanca,
  inchcapeSeasideVillasSilverSands,
  ionClubOasis212LessonsPackageDakhla,
  ionClubPastorinoCampDakhla,
  jaguaribeLodgeFortim,
  jaguarindiaVillageFortim,
  jejuKiteLabSinyang,
  kahunaAdultsKiteCampKiti,
  kailuaLodgePelzerhaken,
  kbcAdventureWeekLoStagnone,
  kenyawaysDiani,
  kerosBlueLimnos,
  kilomboVillasSibauma,
  kiteactiveXxxlDownwinder,
  kiteadventureColombiaCourseStayMayapo,
  kiteAventureAmwejDjerbahood,
  kiteBasecampPodsLangebaan,
  kiteBeachInnCabarete,
  kiteboardingColombiaWildNorthKiteTrip,
  kiteBuenHombre10DaySpecial,
  kiteBuenHombre7DaySpecial,
  kiteBuenHombreEcoLodge,
  kiteClubHatterasAvon,
  kiteClubHatterasCampAvon,
  kiteclubOkinawaKohamaKiteTour,
  kiteclubOkinawaKumejimaTour,
  kiteCollegeDaenemarkRingkobingFjord,
  kiteCrewCaravansChalupy,
  kiteforceTyrolSnowkiteTrip,
  kitefreedomSantaFeBantayan,
  kitefunSurfHouseTarifa,
  kitegenerationKiteCampPuntaTrettu,
  kitehiMauiDownwinder,
  kiteHostelAfricaTarifa,
  kiteHostelStagnoneMarsala,
  kiteHouseSardiniaPuntaTrettu,
  kitekahunasKiteVillaSunsetBeach,
  kiteLodgeBrazilPrea,
  kiteMarinaSarbsk,
  kiteMeUpHostelKiteCampLoStagnone,
  kitemexCampLaVentana,
  kitemotionCourseStayDiani,
  kiteNomadeArraialDoCabo,
  kiteparadiseSakalavaBay,
  kitePassionGlampingPuttgarden,
  kitePlCaravansChalupy,
  kitereizenKiteCampMyHoaPhanRang,
  kitereizenMauritiusResidencyBelOmbre,
  kitekursSnowkiteWeekendHaugastol,
  kiteskolenSnowkiteCourseHaukeliseter,
  kiteRepublicAitutakiWinterEscape,
  kiteRepublicBrazilKiteSafari,
  kiteRepublicMauritiusWavesDreamWinterEscape,
  kiteridersMontenegroCampUlcinj,
  kiteSistersBrazil,
  kiteSistersEssentialCampPeru,
  kiteSistersMoroccoRetreat,
  kiteSuitesPraiaSeca,
  kitesurfAdventureCumbucoClassic,
  kitesurfAdventureIlhaExperienceGuajiru,
  kitesurfingGuimarasSanLorenzo,
  kitesurfingLankaKalpitiya,
  kitesurfingLankaLearnToKiteKalpitiya,
  kitesurfmarocEssaouira,
  kitesurfMindoroBulalacao,
  kitesurfMindoroIslandKiteSafariBulalacao,
  kitesurfSchoolDubaiSriLankaCampKalpitiya,
  kitesurfTofo,
  kiteThailandPackageAPranburi,
  kiteThailandPackageBHuaHin,
  kiteThailandPackageBKohPhangan,
  kitetribeElGouna,
  kiteVillageHamata,
  kitewestWaveFreestyleCampCoronationBeach,
  kitexciteStayAndPlayCabarete,
  kokohauBungalowsSantaVeronica,
  laBallenaAlegreSantPerePescador,
  lakesideParadiseSportHostelKnokkeHeist,
  lakeunitedDjerba,
  lakeunitedKitecampSouthAfricaLangebaanCapeTown,
  lakeunitedSnowkitecampNorwayVoringsfoss,
  latitudesNordFinseSnowkiteWeeks,
  latitudesNordSnowkiteCapNord,
  latitudesNordSnowkiteIcelandVolcanoes,
  latitudesNordSnowkiteLightRyfylkeSetesdal,
  latitudesNordSnowkiteNordkinnVaranger,
  laVentanaBeachResort,
  laVentanaHotel,
  lazyKiteSurfHouseTarifa,
  learnkiteboardingnowCampingBbOostvoorne,
  len10StigRubenBrazilTatajuba,
  lePapayerEcolodgeKitesurfCampCapSkirring,
  letsgokiteWestaustralienKitesafari,
  lineupKiteSurfHouseTaiba,
  lionHostelTarifa,
  logosBeachVillageTheologos,
  loopItAcademyApartmentsJastarnia,
  lvkcVillaBrisaLaVentana,
  margaritaVillageKalpitiya,
  masirahBeachCampSurMasirah,
  masiraIslandResortMasirah,
  maszoperiaSun4helJastarnia,
  matosApartmentsTarifa,
  mauritiusSurfHolidaysKiteCampLaGaulette,
  mazavaLohaResortDiegoSuarez,
  merEtSelUnionIsland,
  mfKiteStageCasaAlmaAlmanarre,
  michaelsKiteVacanciesRhodes,
  mogasurfKiteCampVillaSidiKaouki,
  mounuIslandResortVavau,
  mySaltySistersRetreatElGouna,
  mySaltySistersRetreatKremasti,
  namotuIslandResortMamanuca,
  naneakite8DayCampEssaouira,
  newSpiritDakhla,
  nicekiteLessonCampKaseda,
  nitinahtWindsurfParkCabinsNitinatLake,
  no22RidersInnAkyaka,
  nohotelLampesPiratenKojeDranske,
  nordseeSurfschuleDomeSeeschwalbeHooksiel,
  nordseewindsportKitecampRingkobingFjord,
  nordwindWassersportSurendorf,
  numeroUnoBeachHouseOceanPark,
  oasisKiteKitecampDjerba,
  oceanSpiritsLodgeBurgau,
  oitiBeachResortTutoia,
  olandkiteProgressionKitecampFarjestaden,
  oysterrockLangebaan,
  pajeByNightPaje,
  palapasVentanaLaVentana,
  pallasKiteweekLappisPallas,
  panamaKiteCenterPuntaChame,
  panamaKiteHouse,
  pandanusResortMuiNe,
  paracuruKiteVillage,
  peahiResortStagnone,
  penghuKitesurfSunriseBnbGuoye,
  pensaoAlcindaSantaKiteSal,
  playaCentralCampsLaVentana,
  playLosRoquesAdvancedKiteCampGranRoque,
  playLosRoquesKitesurfDiscoveryGranRoque,
  pousadaArmacaoDosVentosIlhabela,
  pousadaBgkBarraGrande,
  pousadaIlhaDoVentoSaoMiguelDoGostoso,
  pousadaMareAltaParajuru,
  pousadaNaturalParkIbiraquera,
  pousadaPaisTropicalIcarai,
  pousadaPortalDoVentoTatajuba,
  pousadaRaia1Ibiraquera,
  prasebanResortPakNamPran,
  primesurfKiteCampHvideSande,
  proboardingFerienwohnungenKleinZicker,
  puntaTrettuKitesurfHouseSardinia,
  puzaMoyaCapeSportsLangebaan,
  questIslandHoppingKiteSafariRameswaram,
  questSpiceCoastExpeditionKiteSafariTamilNadu,
  ranchoDoPeixePrea,
  rascalsKiteResortKalpitiya,
  realLaVentanaSupercamp,
  redStarSurfKiteCampFamara,
  regenbogenBorn,
  regenbogenUmmanz,
  rewitaDelfinJurata,
  rideKitesurfingTroubridgeIslandTrip,
  road2adventureKiteSafariPerthExmouth,
  ruegenKiteHostelMartinshafen,
  ruukVillageKalpitiya,
  ruukVillageZeroToHeroKalpitiya,
  sakalavaLodgeAllInclusiveKiteWingHoliday,
  sakalavaLodgeDiegoSuarez,
  saltysKitesurfVillageKilifi,
  seahorseResortMuiNe,
  seaLionBeachResortMuiNe,
  secretIslandKiteCampPalawan,
  sevenBeaufortGuajiru,
  sharkbayKitesurfingProgressionDenham,
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
  surfHubKitesurfingCampSal,
  swissKitesurfCampLoStagnone,
  swissKitesurfCampSomaBay,
  swissSnowkitingSchoolPackagesSimplon,
  taigaTarifaPuntaPaloma,
  taigaTarifaValdevaqueros,
  tarifaKiteHostelTarifa,
  theBreakersSomaBay,
  theKitesurfLodgeObidos,
  theriderexperienceLosRoques,
  thirtyFiveKnotsMacapa,
  thorsmindeCamping,
  toowettoshredBrazil,
  toowettoshredKiteCampFanes,
  travelActiveClubMadagascarKiteTrip,
  travelActiveClubOmanKiteTrip,
  trueSurfersVietnamKiteTourMuiNePhanRang,
  umiliPodCyprysamiJastarnia,
  ummaiiSurfhostelUmmanz,
  unchartedKiteSessionsFredHopeFoilMasterCabarete,
  unchartedKiteSessionsStraplessWeekCabarete,
  univelaCampioneDelGarda,
  urlaKiteCampGulbahce,
  urlaSurfHouseGulbahce,
  valampuriBungalowWeekKalpitiya,
  valampuriResortKalpitiya,
  velaBajaLosBarriles,
  ventanaBayResortElSargento,
  ventusBrazilRoutes,
  versusSnowkiteTripHaugastol,
  vilaGuaraAtins,
  vilancoolVilanculos,
  vilaVentoAtins,
  villaAlohaPraiaDePatos,
  villaEsenciaLongBay,
  villaPefkakiaAgiosNikolaos,
  villaRasaBuzios,
  villaTainaCabarete,
  wadiLahamiVillageHamata,
  wahooWindHotelHondoLosBarriles,
  watamuBeachCottagesWatamu,
  watermensRetreatWaves,
  watersportOmanCampBarAlHikman,
  wattlodgeNorden,
  waveCultureKiteCampElMedano,
  westpointDakhla,
  whiteWindResortGuajiru,
  wildHouseTarifa,
  wildKitePeruLaMaisonMancora,
  windAdventuresStudioOrientBay,
  windchaserVillasLongBay,
  windhoekBoutiqueResortBonaire,
  windloopGlampingNeuharlingersiel,
  windSportsCenterKiteweekBoaVista,
  windSportsCenterSurfKiteweekBoaVista,
  windSportsFijiNananuIRa,
  windsurfVillagePortoPollo,
  windtownLagoonHotelLangebaan,
  xFlyKiteboardingCampMiyako,
  zephyrWaOffroadAdventureExmouth,
];

export function adapterByKey(key: string): OfferAdapter | undefined {
  return adapters.find(a => a.key === key);
}
