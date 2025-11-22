import { KMenuPreferencesStore } from "../../common/store";

import type { Main } from "@freelensapp/extensions";

/**
 * Service responsible for initializing and loading extension stores
 */
export class StoreLoaderService {
  /**
   * Load all extension stores
   */
  static async loadStores(extension: Main.LensExtension): Promise<void> {
    await KMenuPreferencesStore.getInstanceOrCreate().loadExtension(extension);
  }
}
