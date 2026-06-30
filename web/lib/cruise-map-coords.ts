// Approximate centroids for cruise countries / regions / spots.
// Copied verbatim from the discovery pipeline (src/pipeline/map.ts) so the
// live cruise-map endpoint can place country markers without runtime geocoding.
// Spot markers prefer each itinerary stop's own lat/lng; this is the fallback.

export const COORDS: Record<string, [number, number]> = {
  // North Africa & Middle East
  Morocco: [30.42, -9.6], Dakhla: [23.71, -15.94], Essaouira: [31.51, -9.77],
  'Moulay Bousselham': [34.88, -6.29], Egypt: [27.23, 33.83], Hurghada: [27.26, 33.81],
  'El Gouna': [27.40, 33.68], Dahab: [28.49, 34.52], 'Marsa Alam': [25.07, 34.89],
  Tunisia: [33.88, 10.85], Djibouti: [11.59, 43.14], Oman: [17.02, 54.09], UAE: [24.47, 54.37],

  // West & East Africa
  'Cape Verde': [16.00, -24.01], Sal: [16.74, -22.94], 'Boa Vista': [16.10, -22.82],
  Senegal: [14.43, -16.97], Ghana: [5.55, -0.2], Kenya: [-4.04, 39.67],
  Tanzania: [-6.06, 39.2], Zanzibar: [-6.16, 39.19], Mozambique: [-22, 35.31],
  Madagascar: [-23.35, 43.67], 'South Africa': [-33.92, 18.42],
  'Cape Town': [-33.93, 18.42], Langebaan: [-33.10, 18.03],
  Mauritius: [-20.35, 57.55], 'La Reunion': [-21.12, 55.54], Seychelles: [-4.68, 55.49],

  // Europe
  Spain: [36.18, -5.92], Tarifa: [36.01, -5.60], Fuerteventura: [28.36, -14.05],
  Lanzarote: [29.05, -13.64], 'Gran Canaria': [27.93, -15.38], Tenerife: [28.29, -16.63],
  'Canary Islands': [28.29, -15.63], Portugal: [38.7, -9.32], Algarve: [37.09, -8.30],
  Lagos: [37.10, -8.67], 'Viana do Castelo': [41.69, -8.83], Azores: [37.74, -25.67],
  Greece: [37.03, 25.1], Rhodes: [36.18, 28.05], Kos: [36.88, 27.28],
  Paros: [37.09, 25.14], Naxos: [37.10, 25.38], Lefkada: [38.71, 20.65],
  Thessaloniki: [40.64, 22.94], Croatia: [43.51, 16.44], Italy: [37.97, 12.43],
  Sardinia: [40.12, 9.07], 'Lake Garda': [45.63, 10.66], France: [43.4, 4.74],
  Leucate: [42.91, 3.04], Netherlands: [52.46, 4.53], Germany: [54.32, 11.04],
  Sylt: [54.91, 8.34], Denmark: [55.72, 8.2], Poland: [54.6, 18.8],
  Sweden: [55.42, 13], Ireland: [53.27, -9.05], 'United Kingdom': [50.79, -1],
  Cornwall: [50.40, -5.10], Malta: [35.94, 14.37], Montenegro: [42.71, 19.37],
  Bulgaria: [42.42, 27.7],

  // Americas
  Brazil: [-2.92, -40.14], Cumbuco: [-3.64, -38.71], Jericoacoara: [-2.80, -40.51],
  Fortaleza: [-3.72, -38.54], Natal: [-5.79, -35.21], 'São Luís': [-2.53, -44.30],
  'Florianópolis': [-27.60, -48.55], 'Dominican Republic': [19.75, -70.42],
  Cabarete: [19.76, -70.41], Mexico: [21.1, -86.85], 'La Ventana': [24.05, -109.97],
  'Los Barriles': [23.69, -109.68], 'Baja California': [30.37, -115.00],
  Aruba: [12.52, -69.97], Bonaire: [12.20, -68.26], Colombia: [12.2, -72.16],
  Cartagena: [10.39, -75.51], Argentina: [-40.77, -64.9], Patagonia: [-51.00, -71.00],
  Uruguay: [-34.91, -54.93], Venezuela: [11.94, -69.81], USA: [28, -80.6],
  'Cape Hatteras': [35.23, -75.54], 'Outer Banks': [35.56, -75.47],
  'Florida Keys': [24.85, -80.90], 'Key West': [24.56, -81.78], Hawaii: [19.90, -155.58],
  Canada: [49.3, -123.1], Antigua: [17.06, -61.80], Barbados: [13.19, -59.54],
  'Turks and Caicos': [21.69, -71.80], Bahamas: [25.03, -77.40], Cuba: [23.13, -81.13],
  'Saint Martin': [18.07, -63.08], Guadeloupe: [16.27, -61.55], Martinique: [14.64, -61.02],
  Grenadines: [12.90, -61.27], 'St Vincent and the Grenadines': [12.98, -61.29],

  // Asia Pacific
  Thailand: [12.62, 100], 'Hua Hin': [12.57, 99.96], Pranburi: [12.39, 99.91],
  Vietnam: [11, 108.27], 'Mui Ne': [10.93, 108.29], 'Sri Lanka': [8.47, 79.93],
  Kalpitiya: [8.23, 79.76], Philippines: [11.95, 121.9], Boracay: [11.97, 121.92],
  Indonesia: [-8.72, 115.17], Bali: [-8.34, 115.09], Australia: [-23.84, 151.26],
  Lancelin: [-31.02, 115.33], 'Margaret River': [-33.96, 115.08],
  'New Zealand': [-36.84, 174.74], India: [15.55, 73.75], Goa: [15.30, 73.98],
  Malaysia: [4.21, 108.00], Taiwan: [23.57, 119.58], China: [18.23, 109.5],
  Hainan: [20.02, 110.33],

  // Pacific & Indian Ocean
  Maldives: [3.20, 73.22], 'New Caledonia': [-20.90, 165.62],
  Tahiti: [-17.68, -149.41], Fiji: [-16.58, 179.42],

  // Additional countries
  Turkey: [37.04, 27.43], Cyprus: [35.13, 33.43], Qatar: [25.35, 51.18],
  'United Arab Emirates': [24.47, 54.37], 'Trinidad and Tobago': [10.69, -61.22],
  Grenada: [12.12, -61.68], Dominica: [15.41, -61.37], 'Costa Rica': [11.05, -85.73],
  Panama: [8.64, -79.71], Belize: [17.5, -88.2], Peru: [-13.84, -76.25],
  Chile: [-33.02, -71.55], Namibia: [-22.95, 14.51], Singapore: [1.35, 103.82],
  Japan: [34.65, 136.92], Georgia: [41.65, 41.64], Iceland: [64.15, -21.94],
  Austria: [47.52, 14.55], Switzerland: [46.82, 8.23], Albania: [40.46, 19.49],
  Norway: [58.97, 5.73], Finland: [61.92, 25.75], 'Saudi Arabia': [27.35, 35.68],
  Jordan: [29.53, 35], 'British Virgin Islands': [18.43, -64.62],
  'Virgin Islands': [18.34, -64.90], 'Saint Lucia': [13.91, -60.98],
  'Saint Vincent and the Grenadines': [12.98, -61.29],
  'Antigua and Barbuda': [17.06, -61.80], 'French Polynesia': [-17.68, -149.41],
  'Trinidad': [10.65, -61.52], Gambia: [13.42, -16.69],

  // Additional spots / resorts
  'Alacati': [38.27, 26.37], 'Alaçatı': [38.27, 26.37], 'Gokova': [37.07, 28.40],
  'Gökova': [37.07, 28.40], 'Istanbul': [41.01, 28.95],
  Dubai: [25.20, 55.27], 'Ras Al Khaimah': [25.68, 55.94], 'Jebel Ali': [24.99, 55.03],
  Musandam: [26.20, 56.25], 'Walvis Bay': [-22.96, 14.51], 'Sossusvlei': [-24.73, 15.34],
  'Union Island': [12.59, -61.44], Canouan: [12.71, -61.33], Mayreau: [12.64, -61.39],
  'Tobago Cays': [12.63, -61.36], 'Petit Saint Vincent': [12.54, -61.38],
  'Punta Chame': [8.60, -79.88], 'Corpus Christi': [27.80, -97.40],
  'South Padre Island': [26.11, -97.17], 'Fort Lauderdale': [26.12, -80.14],
  'Pompano Beach': [26.24, -80.12], 'New York': [40.71, -74.01],
  Houston: [29.76, -95.37], Florida: [27.66, -81.52], California: [36.78, -119.42],
  'Puerto Rico': [18.22, -66.59], Alaska: [64.20, -153.37],
  'Hatteras Island': [35.22, -75.54], 'Kitty Hawk': [36.06, -75.72],
  'Lake Neusiedl': [47.82, 16.77],
  'Port Elizabeth': [-33.96, 25.60], 'Port Elisabeth': [-33.96, 25.60],
  'Fuwairit Kite Beach': [26.03, 51.37],

  // Aliases / alternate spellings
  'Turks and Caicos Islands': [21.69, -71.80],
  Caribbean: [15.00, -73.00], Mediterranean: [35.00, 18.00],
  'South America': [-15.00, -60.00], Europe: [50.00, 10.00],

  // Coastal kite areas, used as region fallbacks so offers without geocoded
  // stops don't land on an inland country centroid (e.g. Kenya, Venezuela).
  'Kenya South Coast': [-4.28, 39.59], 'Lamu-Kiunga Archipelago': [-2.27, 40.90],
  'Los Roques Archipelago': [11.85, -66.76], 'San Blas': [9.57, -78.95],
  'Samaná Peninsula': [19.20, -69.33],
};
