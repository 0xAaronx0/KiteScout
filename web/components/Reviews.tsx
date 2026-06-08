interface Props {
  /** Stable seed (e.g. provider id) so the mock ratings are consistent per card. */
  seed: string;
}

// Deterministic pseudo-random in [0,1) from a string seed + index (FNV-1a).
function rand(seed: string, i: number): number {
  let h = 2166136261;
  for (let k = 0; k < seed.length; k++) {
    h ^= seed.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  h ^= i + 0x9e3779b9;
  h = Math.imul(h, 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function mockRating(seed: string, salt: number, lo: number, hi: number): number {
  return Math.round((lo + rand(seed, salt) * (hi - lo)) * 10) / 10;
}
function mockCount(seed: string, salt: number, lo: number, hi: number): number {
  return Math.round(lo + rand(seed, salt) * (hi - lo));
}

// A handful of generic snippets; pick one per source by seed (placeholder copy).
const QUOTES = [
  'Unforgettable downwinders and a super friendly crew.',
  'Great wind every day, comfortable cabins, would book again.',
  'Perfect mix of kiting and chilling — flawless organisation.',
  'Top spots, patient instructors, delicious food on board.',
  'Best kite trip we’ve done. Spotless boat, epic conditions.',
];

// Five-star track with the gold fill clipped to the rating.
function Stars({ value }: { value: number }) {
  return (
    <span className="relative inline-block text-slate-200 text-[13px] leading-none tracking-tight">
      ★★★★★
      <span
        className="absolute inset-0 overflow-hidden text-amber-400 whitespace-nowrap"
        style={{ width: `${(value / 5) * 100}%` }}
      >
        ★★★★★
      </span>
    </span>
  );
}

// Per-source brand presentation. bstoked teal matches their map palette;
// Tripadvisor green is their brand colour.
const SOURCES = [
  { key: 'bstoked', label: 'bstoked', dot: '#10babd', ratLo: 4.2, ratHi: 4.9, cLo: 8, cHi: 90 },
  { key: 'tripadvisor', label: 'Tripadvisor', dot: '#34e0a1', ratLo: 3.8, ratHi: 4.8, cLo: 40, cHi: 520 },
] as const;

/**
 * Reviews preview — mock data for now. Shows a rating teaser from two sources
 * (bstoked and Tripadvisor) so the card layout can be evaluated before the real
 * review pipeline exists. All numbers/quotes are deterministic per `seed`.
 */
export default function Reviews({ seed }: Props) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Reviews
        </span>
        <span className="text-[10px] text-slate-400" title="Placeholder — real reviews coming soon">
          preview
        </span>
      </div>
      <div className="space-y-2">
        {SOURCES.map((s, i) => {
          const rating = mockRating(seed, i * 7 + 1, s.ratLo, s.ratHi);
          const count = mockCount(seed, i * 7 + 2, s.cLo, s.cHi);
          const quote = QUOTES[Math.floor(rand(seed, i * 7 + 3) * QUOTES.length)];
          return (
            <div key={s.key} className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.dot }} />
                <span className="text-xs font-semibold text-slate-700">{s.label}</span>
                <Stars value={rating} />
                <span className="text-xs font-bold text-slate-700 tabular-nums">{rating.toFixed(1)}</span>
                <span className="text-[11px] text-slate-400 tabular-nums ml-auto">{count} reviews</span>
              </div>
              <p className="text-[11px] text-slate-500 italic mt-1 line-clamp-1">“{quote}”</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
