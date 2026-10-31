import { createRoot } from 'react-dom/client';

import FairweatherApp from './components/FairweatherApp';
import './fonts.css';
import './globals.css';

// No StrictMode: the boot effect registers the service worker and fetches config, and production never ran doubled effects
createRoot(document.getElementById('root')!).render(<FairweatherApp />);
