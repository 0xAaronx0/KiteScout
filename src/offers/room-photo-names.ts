// ---------------------------------------------------------------------------
// Room photos by file name (Aaron 2026-11-02: "alle anderen Accommodations dementsprechend bearbeiten"): many stays
// put every room's photos into one gallery whose file names name the room ("Pixel_3.jpg", "wp-king-4.webp"). Per
// adapter a reviewed list of [room name, file name] patterns hands those gallery photos to the room
// (ContentRoom.imageUrls), so --room-photos can store them. Only patterns that name exactly one room type; generic
// words ("kite", "lodge", "studio") stay out, a room without a reviewed pattern keeps no photos. Rooms whose adapter
// already reads its own photos are left alone.
// ---------------------------------------------------------------------------
import { fileName } from './gallery.js';
import type { OfferContent } from './types.js';

/** [room name, file name] - both matched in lower case without accents; the file name is read as a person reads it ("+" = space) */
type RoomFiles = Array<[room: RegExp, file: RegExp]>;

export const ROOM_PHOTO_FILES: Record<string, RoomFiles> = {
  'amagali-pousada-galinhos': [[/^roof top apartment/, /^ap roof top/], [/^classic apartment/, /^ap classic/], [/^charming chalet \(2 adults\)/, /^chale charme/]],
  'batikite-resort-jeneponto': [[/^gajah/, /^gajah/]],
  'bkc-houses-bilene': [[/^sea view room/, /^chambrevuemer/], [/^standard room/, /^autre-chambre/]],
  'camp-bay-lodge-roatan': [[/^sunrise cabana/, /^sunrise-cabana/], [/^coco room/, /^coco-/], [/^palm room/, /^palm-room/], [/^kitesurf room/, /^kitesurf-room/]],
  'camping-international-hyeres': [[/^mobile home/, /^photo-mobil-home/], [/^villa/, /^photo-villa/]],
  'camping-tarifa-los-lances': [[/^bungalow/, /^fondo-subheader-bungalows/], [/^apartment/, /^fondo-subheader-apartamentos/]],
  'casa-nomade-ilha-do-guajiru': [[/^mirante/, /^mirante/], [/^jardim/, /^jardim/], [/^por do sol/, /^pordosol/]],
  'chilochill-la-ventana': [[/^king glamping tent/, /^wp-king-/], [/^double queen glamping tent/, /^wp-queen-/]],
  'drejby-strand-camping-als': [
    [/^standard cabin/, /^hytte-standard/], [/^cabin in the outdoor oasis/, /^outdoor-oase-hytte/],
    [/^holiday apartment 1\b/, /^lejl-1-/], [/^holiday apartment 2\b/, /^lejl-2-/], [/^holiday apartment 3\b/, /^lejl-3-/],
    [/^holiday apartment 4\b/, /^lejl-4-/], [/^holiday apartment 5\b/, /^lejl-5-/], [/^holiday apartment 6\b/, /^lejl-6-/],
  ],
  'floras-lake-house-langlois': [[/^garden room/, /^garden/], [/^south room/, /^south/]],
  'floripa-ispica': [
    [/^sunset room/, /surf house sunset/], [/^ubatuba room/, /ubatuba/], [/^uluwatu room/, /uluwatu/], [/^playa maderas room/, /playa maderas/],
    [/^tarifa room/, /shared room tarifa/], [/^keramas room/, /keramas/], [/^shipwreck suite/, /shipwreck/], [/^lobos suite/, /los lobos/],
    [/^honolua suite/, /honolua/], [/^maresias suite/, /maresias/],
  ],
  'gnaraloo-station-3-mile-camp': [[/^basic sites/, /basicsites/], [/^primo sites/, /primosites/], [/^the lagoon/, /lagoonsite|3milecamp-lagoon-camp/]],
  'haggerstone-island-resort': [[/^haus mawu/, /haus-mawu/], [/^kwilla hut/, /^kwila-hut/]],
  'hotel-orkos-beach-mikri-vigla': [[/^triple$/, /^triple\.\w+$/], [/^quadruple/, /^quatraple/], [/^luxury triple/, /^triple-suite/], [/^luxury family/, /^fam-suite/]],
  'jaguaribe-lodge-fortim': [[/^ocean lodge/, /^lodge-oceano/], [/^garden view lodge/, /^lodge-jardim/]],
  'kite-club-hatteras-avon': [[/^private room/, /^kch-queen-bedroom/], [/^shared bunk room/, /bunk-room/], [/^the turtle club house/, /^turtle-club/]],
  'kite-hostel-stagnone-marsala': [[/^mixed dorm/, /^mixed_dorm/], [/^girls dorm/, /^girls_dorm/], [/\(pixel\)/, /^pixel/], [/\(agrumi\)/, /agrumi/]],
  'kite-house-sardinia-punta-trettu': [[/"palme"/, /palme/], [/"ulivi"/, /ulivi/]],
  'kite-nomade-arraial-do-cabo': [
    [/^bangalo reserva/, /^bangalo-reserva/], [/^bangalo lua/, /^bangalo-lua/], [/^bangalo lagoa/, /^bangalo-lagoa/], [/^bangalo garden/, /^bangalo-garden/],
    [/^suites 1, 2 e 3/, /^suites-12-e-3/], [/^suites 4, 5 e 6/, /^suites45e6/],
  ],
  'kiteparadise-sakalava-bay': [[/^chameleon suite/, /chameleon_suite/], [/^baobab/, /baobab/], [/^zebu/, /zebu/], [/^maki/, /maki glamping|bungalow maki/]],
  'la-ventana-beach-resort': [[/^king suite #3/, /^king suite lvbr/]],
  'la-ventana-hotel': [[/^deluxe king/, /^room-deluxe-king/], [/^queen room/, /^room-queen/], [/^bunk bed dorm/, /^room-bunk/]],
  'learnkiteboardingnow-camping-bb-oostvoorne': [[/^surfers shed/, /^lkn-sheddie/]],
  'logos-beach-village-theologos': [[/^beach village studio/, /studio-impressionen/], [/^beach village lodge xl$/, /lodge-xl-impressionen/], [/^beach village lodge xxl/, /lodge-xxl-impressionen/]],
  'margarita-village-kalpitiya': [[/^wooden bungalow/, /^timber-bungalows/]],
  'maszoperia-sun4hel-jastarnia': [[/^surf caravan/, /^przyczepa/], [/^wiatr/, /^wiatr_/], [/^sky room/, /^sky_/], [/^woda room/, /^woda_/]],
  'matos-apartments-tarifa': [[/^atico/, /^atico/], [/braille/, /braill?e/]],
  'mazava-loha-resort-diego-suarez': [[/^wooden bungalow/, /^bungalow-bois/]],
  'mer-et-sel-union-island': [[/^2 bedroom villa/, /^mer-et-sel-villa-/], [/^private mayreau view suite/, /^mer-et-sel-(?:private-)?suite-/]],
  'mounu-island-resort-vavau': [[/^tongan fale/, /^faleinterior/]],
  'numero-uno-beach-house-ocean-park': [[/^beach apartment/, /beachhouse-sleep-apts/]],
  'ocean-spirits-lodge-burgau': [[/^dorm room/, /^dorm-/]],
  'pandanus-resort-mui-ne': [
    [/^signature suite/, /signature-suite/], [/^bungalow/, /resort-bungalow/], [/^superior comfort/, /superior-comfort/],
    [/^superior deluxe/, /superior-deluxe/], [/^superior standard/, /superior-standard/], [/^family suite/, /family-suite/], [/^executive suite/, /executive-suite/],
  ],
  'paracuru-kite-village': [[/^garden suite/, /^garden\./], [/^chalet suite/, /^chale\./], [/^standard room/, /^standard-/], [/^dunas suite/, /^dunas/]],
  'pousada-bgk-barra-grande': [[/^standard masonry chalet/, /^standart/], [/^coqueiral/, /^coqueiral/], [/beira-mar/, /^frente_mar/], [/^bungalow essence/, /essencia/]],
  'pousada-ilha-do-vento-sao-miguel-do-gostoso': [[/^suite luxo/, /^luxo\d/]],
  'pousada-natural-park-ibiraquera': [[/^casa 01$/, /^casa-01-/], [/^casa 04$/, /^casa-04-/], [/^casa 04 - anexo/, /^casa-04anexo/], [/^casa 08$/, /^casa-08-/], [/^casa 11$/, /^casa-11-/]],
  'pousada-portal-do-vento-tatajuba': [[/^palafita/, /palafita/], [/^kitehouse/, /kitehouse/], [/^bungalow/, /^pdv-bungalow/]],
  'proboarding-ferienwohnungen-klein-zicker': [[/seeseite/, /seeseite/], [/bergseite/, /bergseite|fewoberg/], [/deluxe/, /deluxe/]],
  'rancho-do-peixe-prea': [[/^coqueiral/, /^coqueiral/]],
  'ruegen-kite-hostel-martinshafen': [[/^6-bed room/, /^6er_/], [/^double room/, /^(?:hostel)?doppelzimmer/]],
  'ruuk-village-kalpitiya': [[/^garden cabana/, /garden-cabana-interior/], [/^vw surfer van/, /camper-van|vw-bully/]],
  'seahorse-resort-mui-ne': [
    [/^deluxe room, garden view/, /^deluxe garden view/], [/^deluxe family room, sea view/, /^deluxe family seaview/],
    [/^premium room, sea view/, /^premium deluxe seaview/], [/^bungalow, garden view/, /^bungalow garden view/],
    [/^bungalow, pool view/, /bungalow-pool-view/], [/^beachfront bungalow/, /^bungalow beach/],
  ],
  'the-breakers-soma-bay': [[/^lifestyle room/, /somabay-lifestyle-room/], [/^xl lifestyle room/, /xl-lifestyle-room/]],
  'the-kitesurf-lodge-obidos': [[/^dorm room/, /dormitory-room/], [/^private rooms/, /king-bed-single-room|double-bed-room/]],
  'urla-surf-house-gulbahce': [[/^family room/, /^1_family-room/], [/^comfort room/, /comfort-room/], [/^bungalow tent/, /^3_bungalow-room/], [/^camping area/, /^4_camping-area/]],
  'villa-esencia-long-bay': [[/^esencia cottage/, /esencia-cottage/], [/- k2$/, /^k2-/], [/^wyakha 1 /, /^w1-/]],
  'villa-taina-cabarete': [
    [/^premium room/, /^premium-room/], [/^superior ocean side room/, /^superior-ocean-side/], [/^ocean side room/, /^ocean-side-/],
    [/^superior room/, /^superior-room/], [/^standard room/, /^standard-room/],
  ],
  'wadi-lahami-village-hamata': [[/^deluxe chalet/, /^lahami_chalet/]],
  'wattlodge-norden': [[/^surfer-suite classic/, /^meuesurferklassik/], [/^surfer's hostel/, /^surfermehrbett/], [/^hutten-suite/, /^huettensuite/]],
  'westpoint-dakhla': [[/^waves view lodge/, /^waves-view/]],
  'wind-sports-fiji-nananu-i-ra': [[/^beachfront bure/, /^bure \d/], [/mango lodge/, /mango villa/]],
  'windhoek-boutique-resort-bonaire': [[/^one-bedroom villa/, /^1slaapkamer/]],
};

const plain = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** the gallery photos whose file names name a room, for the rooms that bring none of their own (gallery order kept) */
export function withNamedRoomPhotos(key: string, c: OfferContent): OfferContent {
  const pairs = ROOM_PHOTO_FILES[key];
  if (!pairs) return c;
  const files = c.imageUrls.map(u => [u, plain(fileName(u))] as const);
  const rooms = c.rooms.map(r => {
    if (r.imageUrls?.length) return r;
    const name = plain(r.name);
    const pair = pairs.find(([room]) => room.test(name));
    const urls = pair ? files.filter(([, f]) => pair[1].test(f)).map(([u]) => u) : [];
    return urls.length ? { ...r, imageUrls: urls } : r;
  });
  return { ...c, rooms };
}
