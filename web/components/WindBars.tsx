interface Props {
  /** Stable seed (e.g. provider id) so the mock pattern is consistent per card. */
  seed: string;
  /** Real monthly wind probabilities (0–100, length 12). Falls back to mock data. */
  months?: number[];
}

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

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

// Placeholder seasonal curve until real wind data exists: one smooth peak per
// year at a seed-dependent phase, plus a little per-month jitter.
function mockMonths(seed: string): number[] {
  const phase = rand(seed, 99) * Math.PI * 2;
  return Array.from({ length: 12 }, (_, m) => {
    const base = 50 + 32 * Math.sin((m / 12) * Math.PI * 2 + phase);
    const jitter = (rand(seed, m) - 0.5) * 18;
    return Math.max(8, Math.min(100, Math.round(base + jitter)));
  });
}

// A small 12-month wind-probability strip (Jan–Dec) with the current month
// highlighted. Data is estimated for now — wire `months` to real data later.
export default function WindBars({ seed, months }: Props) {
  const isReal = !!(months && months.length === 12);
  const data = isReal ? months! : mockMonths(seed);
  const current = new Date().getMonth();

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Wind by month
        </span>
        <span className="text-[10px] text-slate-400" title={isReal
          ? 'Windy-day probability from bstoked.net'
          : 'Estimated — no per-country data yet'}>
          {isReal ? 'bstoked.net' : 'est.'}
        </span>
      </div>
      <div className="flex items-end gap-[3px] h-9">
        {data.map((v, m) => (
          <div
            key={m}
            className="flex-1 h-full rounded-sm bg-slate-100 flex items-end overflow-hidden"
            title={`${MONTH_FULL[m]}: ~${v}% windy`}
          >
            <div
              className={`w-full ${m === current ? 'bg-sky-500' : 'bg-sky-300'}`}
              style={{ height: `${v}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-[3px] mt-0.5">
        {MONTH_INITIALS.map((l, m) => (
          <span
            key={m}
            className={`flex-1 text-center text-[8px] leading-none ${
              m === current ? 'text-sky-600 font-bold' : 'text-slate-400'
            }`}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
