import CruiseFinder from '../../components/CruiseFinder';

// Alias of the root Cruise Finder, kept so existing /cruise?provider=… and
// /cruise?destination=… deep-links (e.g. from the cruise map) keep working.
export default function CruisePage() {
  return <CruiseFinder />;
}
