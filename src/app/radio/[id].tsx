/**
 * Station route: the player's "playing from" header navigates to the source,
 * and a station's source is /radio/<id>, so this must exist even though there
 * is no per-station screen yet. A real one lands later — until then it is the
 * station list, which is what the header points at anyway.
 */
import { useEffect } from 'react';

import { useRouter } from 'expo-router';

export default function RadioStationScreen() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/radio');
  }, [router]);
  return null;
}
