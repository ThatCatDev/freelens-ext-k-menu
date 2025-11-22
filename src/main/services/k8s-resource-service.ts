import { Main } from "@freelensapp/extensions";

export interface K8sResource {
  kind: string;
  name: string;
  namespace?: string;
  uid: string;
  apiVersion: string;
}

/**
 * Service for managing K8s resources in the main process
 */
export class K8sResourceService {
  /**
   * Fetch all K8s resources from available stores
   */
  static async getAllResources(): Promise<K8sResource[]> {
    const K8sApi = (Main as any).K8sApi;

    if (!K8sApi) {
      console.warn('[K-MENU] K8sApi not available in main process');
      throw new Error('K8sApi not available');
    }

    const allResources: K8sResource[] = [];
    const allKeys = Object.keys(K8sApi);
    const storeKeys = allKeys.filter(key => key.endsWith('Store'));

    console.log(`[K-MENU] Fetching resources from ${storeKeys.length} stores...`);

    let processedStores = 0;
    let skippedStores = 0;

    // Fetch all resources from each store using the API
    for (const storeKey of storeKeys) {
      try {
        const store = K8sApi[storeKey];
        if (!store || !store.api) {
          skippedStores++;
          continue;
        }

        // Use the API to list all resources (across all namespaces)
        const items = await store.api.list();

        if (items && Array.isArray(items)) {
          items.forEach((item: any) => {
            if (item && item.metadata) {
              allResources.push({
                kind: item.kind || store.api?.kind || 'Unknown',
                name: item.getName ? item.getName() : item.metadata.name,
                namespace: item.getNs ? item.getNs() : item.metadata.namespace,
                uid: item.getId ? item.getId() : item.metadata.uid,
                apiVersion: item.apiVersion || store.api?.apiBase || '',
              });
            }
          });
        }

        processedStores++;
      } catch (err) {
        console.warn(`[K-MENU] Error processing store ${storeKey}:`, err);
      }
    }

    console.log(`[K-MENU] Fetched ${allResources.length} resources from ${processedStores} stores (${skippedStores} skipped)`);
    return allResources;
  }

  /**
   * Delete a K8s resource
   */
  static async deleteResource(resource: K8sResource): Promise<void> {
    const K8sApi = (Main as any).K8sApi;

    if (!K8sApi) {
      console.error('[K-MENU] K8sApi not available in main process');
      throw new Error('K8sApi not available');
    }

    // Find the appropriate store for this resource type
    const storeKey = `${resource.kind.toLowerCase()}Store`;
    const store = K8sApi[storeKey];

    if (!store || !store.api) {
      console.error(`[K-MENU] Store not found for kind: ${resource.kind}`);
      throw new Error(`Store not found for ${resource.kind}`);
    }

    console.log(`[K-MENU] Deleting resource:`, resource);
    await store.api.delete({
      name: resource.name,
      namespace: resource.namespace
    });

    console.log(`[K-MENU] Successfully deleted resource`);
  }
}
