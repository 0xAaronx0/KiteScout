export type TripType =
  | 'camp'
  | 'safari'
  | 'cruise'
  | 'tour'
  | 'school'
  | 'lessons'
  | 'rental'
  | 'equipment_rental';

export type ProviderStatus = 'new' | 'verified' | 'dead' | 'duplicate';

export interface ProviderExtraction {
  isProvider: boolean;
  name: string | null;
  rootDomain: string;
  primaryCountry: string | null;
  primaryRegion: string | null;
  operatesIn: Array<{
    country: string;
    region?: string;
    spotName?: string;
  }>;
  tripTypes: TripType[];
  contactEmail: string | null;
  contactFormUrl: string | null;
  whatsapp: string | null;
  phone: string | null;
  languages: string[];
  description: string | null;
  notProviderReason: string | null;
}
