export interface SearchContext {
  countries?: string[];
  regions?: string[];
  tripTypes?: string[];
}

export interface OfferResult {
  found: boolean;
  offerName?: string | null;
  price?: string | null;
  dates?: string | null;
  highlights?: string[];
  directUrl?: string | null;
}

export interface ProviderResult {
  id: string;
  name: string | null;
  website_url: string | null;
  description: string | null;
  trip_types: string[];
  primary_country: string | null;
  primary_region: string | null;
  contact_email: string | null;
  contact_form_url: string | null;
  whatsapp: string | null;
  phone: string | null;
  locations: string[];
  matchedLocations: string[]; // locations that matched the search query
  isHighlight: boolean;
}
