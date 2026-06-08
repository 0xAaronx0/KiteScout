interface Props {
  lat: number;
  lon: number;
  /** Slippy-map zoom level; lower = more regional context. */
  zoom?: number;
  /** Card-map height in px. */
  height?: number;
}

const TILE = 256;

// A simple, non-interactive location map: a small mosaic of OpenStreetMap
// raster tiles centered exactly on the point, with a pin on top. No zoom
// controls, no scroll/drag, no attribution/donation chrome — just the place.
export default function MiniMap({ lat, lon, zoom = 7, height = 130 }: Props) {
  const n = 2 ** zoom;
  // Web-Mercator → fractional tile coordinates of the point.
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n;
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  const fracX = x - tileX; // 0..1 position of the point inside its tile
  const fracY = y - tileY;

  // 3×3 tiles around the point guarantee full coverage of the card area.
  const tiles: { key: string; src: string; left: number; top: number }[] = [];
  for (const dy of [-1, 0, 1]) {
    const ty = tileY + dy;
    if (ty < 0 || ty >= n) continue; // off the top/bottom of the world
    for (const dx of [-1, 0, 1]) {
      const tx = ((tileX + dx) % n + n) % n; // wrap around the antimeridian
      // CARTO "Voyager" basemap (no labels): blue water, soft land, and none of
      // the administrative boundary lines the default OSM style draws around coasts.
      const sub = ['a', 'b', 'c', 'd'][(tx + ty) % 4];
      tiles.push({
        key: `${dx},${dy}`,
        src: `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/${zoom}/${tx}/${ty}.png`,
        // Offsets are measured from the card centre (the anchor below), so the
        // point lands dead-centre regardless of the card's rendered width.
        left: dx * TILE - fracX * TILE,
        top: dy * TILE - fracY * TILE,
      });
    }
  }

  return (
    <div
      className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-100"
      style={{ height }}
    >
      {/* Tile mosaic, anchored at the card centre = the point. */}
      <div className="absolute" style={{ left: '50%', top: '50%' }}>
        {tiles.map(t => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={t.key}
            src={t.src}
            alt=""
            width={TILE}
            height={TILE}
            draggable={false}
            referrerPolicy="no-referrer"
            className="absolute max-w-none select-none"
            style={{ left: t.left, top: t.top, pointerEvents: 'none' }}
          />
        ))}
      </div>

      {/* Pin at the exact point (its tip sits on the card centre). */}
      <div
        className="absolute"
        style={{ left: '50%', top: '50%', transform: 'translate(-50%, -100%)', pointerEvents: 'none' }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" className="drop-shadow-md block">
          <path
            fill="#0ea5e9"
            stroke="#fff"
            strokeWidth="1.5"
            d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
          />
          <circle cx="12" cy="9" r="2.5" fill="#fff" />
        </svg>
      </div>

      {/* Minimal attribution required by OSM data + CARTO basemap. */}
      <span className="absolute bottom-0 right-0 bg-white/70 text-[9px] leading-tight text-slate-500 px-1 rounded-tl">
        © OpenStreetMap · CARTO
      </span>
    </div>
  );
}
