// Approximate centroids for cruise countries / regions / spots.
// Copied verbatim from the discovery pipeline (src/pipeline/map.ts) so the
// live cruise-map endpoint can place country markers without runtime geocoding.
// Spot markers prefer each itinerary stop's own lat/lng; this is the fallback.

export const COORDS: Record<string, [number, number]> = {
  // North Africa & Middle East
  Morocco: [31.79, -7.09], Dakhla: [23.71, -15.94], Essaouira: [31.51, -9.77],
  'Moulay Bousselham': [34.88, -6.29], Egypt: [26.82, 30.80], Hurghada: [27.26, 33.81],
  'El Gouna': [27.40, 33.68], Dahab: [28.49, 34.52], 'Marsa Alam': [25.07, 34.89],
  Tunisia: [33.89, 9.54], Djibouti: [11.83, 42.59], Oman: [21.51, 55.92], UAE: [23.42, 53.85],

  // West & East Africa
  'Cape Verde': [16.00, -24.01], Sal: [16.74, -22.94], 'Boa Vista': [16.10, -22.82],
  Senegal: [14.50, -14.45], Ghana: [7.95, -1.02], Kenya: [-0.02, 37.91],
  Tanzania: [-6.37, 34.89], Zanzibar: [-6.16, 39.19], Mozambique: [-18.67, 35.53],
  Madagascar: [-18.77, 46.87], 'South Africa': [-30.56, 22.94],
  'Cape Town': [-33.93, 18.42], Langebaan: [-33.10, 18.03],
  Mauritius: [-20.35, 57.55], 'La Reunion': [-21.12, 55.54], Seychelles: [-4.68, 55.49],

  // Europe
  Spain: [40.46, -3.75], Tarifa: [36.01, -5.60], Fuerteventura: [28.36, -14.05],
  Lanzarote: [29.05, -13.64], 'Gran Canaria': [27.93, -15.38], Tenerife: [28.29, -16.63],
  'Canary Islands': [28.29, -15.63], Portugal: [39.40, -8.22], Algarve: [37.09, -8.30],
  Lagos: [37.10, -8.67], 'Viana do Castelo': [41.69, -8.83], Azores: [37.74, -25.67],
  Greece: [39.07, 21.82], Rhodes: [36.18, 28.05], Kos: [36.88, 27.28],
  Paros: [37.09, 25.14], Naxos: [37.10, 25.38], Lefkada: [38.71, 20.65],
  Thessaloniki: [40.64, 22.94], Croatia: [45.10, 15.20], Italy: [41.87, 12.57],
  Sardinia: [40.12, 9.07], 'Lake Garda': [45.63, 10.66], France: [46.23, 2.21],
  Leucate: [42.91, 3.04], Netherlands: [52.13, 5.29], Germany: [51.17, 10.45],
  Sylt: [54.91, 8.34], Denmark: [56.26, 9.50], Poland: [51.92, 19.15],
  Sweden: [60.13, 18.64], Ireland: [53.41, -8.24], 'United Kingdom': [55.38, -3.44],
  Cornwall: [50.40, -5.10], Malta: [35.94, 14.37], Montenegro: [42.71, 19.37],
  Bulgaria: [42.73, 25.49],

  // Americas
  Brazil: [-14.24, -51.93], Cumbuco: [-3.64, -38.71], Jericoacoara: [-2.80, -40.51],
  Fortaleza: [-3.72, -38.54], Natal: [-5.79, -35.21], 'São Luís': [-2.53, -44.30],
  'Florianópolis': [-27.60, -48.55], 'Dominican Republic': [18.74, -70.16],
  Cabarete: [19.76, -70.41], Mexico: [23.63, -102.55], 'La Ventana': [24.05, -109.97],
  'Los Barriles': [23.69, -109.68], 'Baja California': [30.37, -115.00],
  Aruba: [12.52, -69.97], Bonaire: [12.20, -68.26], Colombia: [4.57, -74.30],
  Cartagena: [10.39, -75.51], Argentina: [-38.42, -63.62], Patagonia: [-51.00, -71.00],
  Uruguay: [-32.52, -55.77], Venezuela: [6.42, -66.59], USA: [37.09, -95.71],
  'Cape Hatteras': [35.23, -75.54], 'Outer Banks': [35.56, -75.47],
  'Florida Keys': [24.85, -80.90], 'Key West': [24.56, -81.78], Hawaii: [19.90, -155.58],
  Canada: [56.13, -106.35], Antigua: [17.06, -61.80], Barbados: [13.19, -59.54],
  'Turks and Caicos': [21.69, -71.80], Bahamas: [25.03, -77.40], Cuba: [21.52, -77.78],
  'Saint Martin': [18.07, -63.08], Guadeloupe: [16.27, -61.55], Martinique: [14.64, -61.02],
  Grenadines: [12.90, -61.27], 'St Vincent and the Grenadines': [12.98, -61.29],

  // Asia Pacific
  Thailand: [15.87, 100.99], 'Hua Hin': [12.57, 99.96], Pranburi: [12.39, 99.91],
  Vietnam: [14.06, 108.28], 'Mui Ne': [10.93, 108.29], 'Sri Lanka': [7.87, 80.77],
  Kalpitiya: [8.23, 79.76], Philippines: [12.88, 121.77], Boracay: [11.97, 121.92],
  Indonesia: [-0.79, 113.92], Bali: [-8.34, 115.09], Australia: [-25.27, 133.78],
  Lancelin: [-31.02, 115.33], 'Margaret River': [-33.96, 115.08],
  'New Zealand': [-40.90, 174.89], India: [20.59, 78.96], Goa: [15.30, 73.98],
  Malaysia: [4.21, 108.00], Taiwan: [23.70, 121.00], China: [35.86, 104.20],
  Hainan: [20.02, 110.33],

  // Pacific & Indian Ocean
  Maldives: [3.20, 73.22], 'New Caledonia': [-20.90, 165.62],
  Tahiti: [-17.68, -149.41], Fiji: [-16.58, 179.42],

  // Additional countries
  Turkey: [38.96, 35.24], Cyprus: [35.13, 33.43], Qatar: [25.35, 51.18],
  'United Arab Emirates': [23.42, 53.85], 'Trinidad and Tobago': [10.69, -61.22],
  Grenada: [12.12, -61.68], Dominica: [15.41, -61.37], 'Costa Rica': [9.75, -83.75],
  Panama: [8.54, -80.78], Belize: [17.19, -88.50], Peru: [-9.19, -75.02],
  Chile: [-35.68, -71.54], Namibia: [-22.96, 18.49], Singapore: [1.35, 103.82],
  Japan: [36.20, 138.25], Georgia: [42.32, 43.36], Iceland: [64.96, -19.02],
  Austria: [47.52, 14.55], Switzerland: [46.82, 8.23], Albania: [41.15, 20.17],
  Norway: [60.47, 8.47], Finland: [61.92, 25.75], 'Saudi Arabia': [23.89, 45.08],
  Jordan: [30.59, 36.24], 'British Virgin Islands': [18.43, -64.62],
  'Virgin Islands': [18.34, -64.90], 'Saint Lucia': [13.91, -60.98],
  'Saint Vincent and the Grenadines': [12.98, -61.29],
  'Antigua and Barbuda': [17.06, -61.80], 'French Polynesia': [-17.68, -149.41],
  'Trinidad': [10.65, -61.52], Gambia: [13.44, -15.31],

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
};
