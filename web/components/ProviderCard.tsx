import type { ProviderResult } from '../lib/types';

const TYPE_LABELS: Record<string, string> = {
  camp: 'Camp', safari: 'Safari', cruise: 'Cruise', tour: 'Tour',
  school: 'School', lessons: 'Lessons', rental: 'Rental',
  equipment_rental: 'Gear rental', snowkite: 'Snowkite',
};

export default function ProviderCard({ provider }: { provider: ProviderResult }) {
  const types = provider.trip_types.map(t => TYPE_LABELS[t] ?? t).join(' · ');

  const location = provider.locations.length > 0
    ? [...new Set(provider.locations)].slice(0, 4).join(' · ')
    : [provider.primary_region, provider.primary_country].filter(Boolean).join(', ');

  const whatsappHref = provider.whatsapp
    ? (provider.whatsapp.startsWith('http') ? provider.whatsapp : `https://wa.me/${provider.whatsapp.replace(/\D/g, '')}`)
    : null;

  return (
    <div className="border border-slate-200 rounded-xl p-4 bg-white hover:border-blue-300 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 truncate">
            {provider.name ?? new URL(provider.website_url ?? 'https://unknown').hostname}
          </h3>
          {location && <p className="text-xs text-slate-400 mt-0.5">{location}</p>}
        </div>
        {types && (
          <span className="text-xs bg-blue-50 text-blue-700 rounded-full px-2.5 py-1 whitespace-nowrap shrink-0 font-medium">
            {types}
          </span>
        )}
      </div>

      {provider.description && (
        <p className="text-sm text-slate-600 mt-2 line-clamp-2">{provider.description}</p>
      )}

      <div className="flex items-center gap-4 mt-3 flex-wrap">
        {provider.website_url && (
          <a href={provider.website_url} target="_blank" rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline font-medium">
            Visit website →
          </a>
        )}
        {provider.contact_email && (
          <a href={`mailto:${provider.contact_email}`}
            className="text-sm text-slate-400 hover:text-slate-600">
            {provider.contact_email}
          </a>
        )}
        {whatsappHref && (
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer"
            className="text-sm text-emerald-600 hover:underline font-medium">
            WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}
