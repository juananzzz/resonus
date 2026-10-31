import { Image } from 'expo-image';

import { clearExportCache } from '@/lib/exportSong';
import { queryClient } from '@/lib/query';

/** Drops what can be fetched again: server answers, covers, the last exported song. */
export async function clearTemporaryData() {
  queryClient.clear();
  clearExportCache();
  await Promise.all([Image.clearMemoryCache(), Image.clearDiskCache()]).catch(() => {});
}
