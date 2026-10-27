import FairweatherApp from './components/FairweatherApp';

// Rendered per request so shared caches (Namecheap's edge proxy) never hold stale HTML that
// points at JS chunks a later build removed. The shell is tiny; all data loads client-side.
export const dynamic = 'force-dynamic';

export default function FairweatherPage() {
  return <FairweatherApp />;
}
