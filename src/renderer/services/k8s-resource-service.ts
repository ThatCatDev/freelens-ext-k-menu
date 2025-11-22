import { Renderer } from "@freelensapp/extensions";
import { runInAction } from "mobx";

export interface K8sResource {
  kind: string;
  name: string;
  namespace?: string;
  uid: string;
  apiVersion: string;
}

// Export as KubeResource for backwards compatibility
export type KubeResource = K8sResource;

/**
 * Service for managing K8s resources in the renderer process
 * Uses Renderer.K8sApi directly instead of IPC
 */
export class K8sResourceService {
  /**
   * Fetch all K8s resources from available stores
   * This should only be called when in a cluster iframe context
   */
  static async getAllResources(): Promise<K8sResource[]> {
    console.log("[K-MENU-SERVICE] getAllResources() called");

    const K8sApi = (Renderer as any).K8sApi;

    if (!K8sApi) {
      console.warn("[K-MENU-SERVICE] K8sApi not available");
      return [];
    }

    console.log("[K-MENU-SERVICE] K8sApi available, checking for namespacesStore...");

    // Debug: List all available store names
    const allKeys = Object.keys(K8sApi);
    const storeKeys = allKeys.filter((key) => key.toLowerCase().includes("namespace"));
    console.log("[K-MENU-SERVICE] All namespace-related keys in K8sApi:", storeKeys);

    // Save current namespace selection
    let namespaceStore: any = null;
    let savedNamespaces: string[] | null = null;
    let wasAllSelected = false;

    try {
      // Try different possible names
      namespaceStore = K8sApi.namespacesStore || K8sApi.namespaceStore;
      console.log("[K-MENU-SERVICE] namespaceStore:", namespaceStore ? "found" : "not found");

      if (namespaceStore) {
        // Debug: Check what properties and methods are available
        console.log(
          "[K-MENU-SERVICE] namespaceStore methods:",
          Object.getOwnPropertyNames(Object.getPrototypeOf(namespaceStore)).filter(
            (name) => typeof namespaceStore[name] === "function",
          ),
        );
        console.log("[K-MENU-SERVICE] namespaceStore properties:", Object.keys(namespaceStore));

        // Get current selection
        console.log("[K-MENU-SERVICE] namespacesStore.selectedNamespaces:", namespaceStore.selectedNamespaces);
        console.log(
          "[K-MENU-SERVICE] namespacesStore.areAllSelectedImplicitly:",
          namespaceStore.areAllSelectedImplicitly,
        );

        savedNamespaces = namespaceStore.selectedNamespaces ? [...namespaceStore.selectedNamespaces] : null;
        wasAllSelected = namespaceStore.areAllSelectedImplicitly || false;

        console.log("[K-MENU-SERVICE] Saved namespace filter:", savedNamespaces, "(all selected:", wasAllSelected, ")");

        // Try different methods to clear namespace filter
        runInAction(() => {
          if (typeof namespaceStore.selectAllNamespaces === "function") {
            namespaceStore.selectAllNamespaces();
            console.log("[K-MENU-SERVICE] Called selectAllNamespaces()");
          } else if (typeof namespaceStore.selectAll === "function") {
            namespaceStore.selectAll();
            console.log("[K-MENU-SERVICE] Called selectAll()");
          } else if (typeof namespaceStore.toggleAll === "function") {
            namespaceStore.toggleAll(true);
            console.log("[K-MENU-SERVICE] Called toggleAll(true)");
          } else if (namespaceStore.selectedNamespaces && Array.isArray(namespaceStore.selectedNamespaces)) {
            // Direct manipulation - clear the array
            namespaceStore.selectedNamespaces.length = 0;
            console.log("[K-MENU-SERVICE] Cleared selectedNamespaces array directly");
          }
        });

        // Check the state immediately after clearing
        console.log("[K-MENU-SERVICE] After clear - selectedNamespaces:", namespaceStore.selectedNamespaces);
        console.log(
          "[K-MENU-SERVICE] After clear - areAllSelectedImplicitly:",
          namespaceStore.areAllSelectedImplicitly,
        );
        console.log("[K-MENU-SERVICE] After clear - length:", namespaceStore.selectedNamespaces?.length);

        // Just use a small delay instead of when() - the namespace change might trigger store loads
        // which could interfere with our resource fetching
        await new Promise((resolve) => setTimeout(resolve, 150));
        console.log("[K-MENU-SERVICE] Waited for namespace filter to propagate");
      } else {
        console.log("[K-MENU-SERVICE] No namespacesStore available - skipping namespace filter management");
      }
    } catch (err) {
      console.warn("[K-MENU-SERVICE] Could not access namespace store:", err);
    }

    const allResources: K8sResource[] = [];

    try {
      // Get all property names that end with 'Store'
      const allKeys = Object.keys(K8sApi);
      const storeKeys = allKeys.filter((key) => key.endsWith("Store"));

      console.log(`[K-MENU] Found ${storeKeys.length} potential stores to check`);

      let processedStores = 0;
      let skippedStores = 0;

      // Try to access each store individually with proper error handling
      for (const storeKey of storeKeys) {
        try {
          // Try to get the store - this might throw if not available in this environment
          let store: any;
          try {
            store = K8sApi[storeKey];
          } catch (accessErr) {
            // Store not available in current environment (assertion error)
            skippedStores++;
            continue;
          }

          if (!store || !store.api) {
            skippedStores++;
            continue;
          }

          // Try to get items - call API list() to get fresh data respecting current namespace filter
          let items: any[] = [];
          if (store.api && typeof store.api.list === "function") {
            try {
              // Call list() which should respect the current namespace filter
              items = await store.api.list();
              console.log(`[K-MENU-SERVICE] Listed ${items?.length || 0} items from ${storeKey} via API`);
            } catch (listErr) {
              console.warn(`[K-MENU-SERVICE] Error listing from ${storeKey}:`, listErr);
              // Fallback to cached items if API call fails
              if (store.items && Array.isArray(store.items)) {
                items = store.items;
                console.log(`[K-MENU-SERVICE] Using cached items from ${storeKey}: ${items.length}`);
              } else {
                skippedStores++;
                continue;
              }
            }
          } else if (store.items && Array.isArray(store.items)) {
            // No API available, use cached items
            items = store.items;
          } else {
            skippedStores++;
            continue;
          }

          if (Array.isArray(items) && items.length > 0) {
            items.forEach((item: any) => {
              if (item && item.metadata) {
                allResources.push({
                  kind: item.kind || store.api?.kind || "Unknown",
                  name: item.getName ? item.getName() : item.metadata.name,
                  namespace: item.getNs ? item.getNs() : item.metadata.namespace,
                  uid: item.getId ? item.getId() : item.metadata.uid,
                  apiVersion: item.apiVersion || store.api?.apiBase || "",
                });
              }
            });
            processedStores++;
            console.log(`[K-MENU] ✓ Loaded ${items.length} items from ${storeKey}`);
          } else {
            skippedStores++;
          }
        } catch (err) {
          // Silently skip stores that error
          skippedStores++;
        }
      }

      console.log(
        `[K-MENU] Fetched ${allResources.length} resources from ${processedStores} stores (${skippedStores} skipped)`,
      );
    } finally {
      // Restore original namespace selection
      if (namespaceStore) {
        try {
          runInAction(() => {
            if (wasAllSelected) {
              // Restore "all namespaces"
              if (typeof namespaceStore.selectAllNamespaces === "function") {
                namespaceStore.selectAllNamespaces();
              } else if (typeof namespaceStore.selectAll === "function") {
                namespaceStore.selectAll();
              } else if (namespaceStore.selectedNamespaces) {
                namespaceStore.selectedNamespaces.length = 0;
              }
              console.log('[K-MENU-SERVICE] Restored "all namespaces" filter');
            } else if (savedNamespaces && savedNamespaces.length > 0) {
              // Restore specific namespaces
              if (typeof namespaceStore.selectNamespaces === "function") {
                namespaceStore.selectNamespaces(savedNamespaces);
              } else if (typeof namespaceStore.select === "function") {
                namespaceStore.select(savedNamespaces);
              } else if (namespaceStore.selectedNamespaces && Array.isArray(namespaceStore.selectedNamespaces)) {
                // Direct manipulation
                namespaceStore.selectedNamespaces.length = 0;
                namespaceStore.selectedNamespaces.push(...savedNamespaces);
              }
              console.log("[K-MENU-SERVICE] Restored namespace filter to:", savedNamespaces);
            } else {
              // If nothing was selected before, clear selection
              if (typeof namespaceStore.clearSelected === "function") {
                namespaceStore.clearSelected();
              } else if (typeof namespaceStore.clear === "function") {
                namespaceStore.clear();
              } else if (namespaceStore.selectedNamespaces) {
                namespaceStore.selectedNamespaces.length = 0;
              }
              console.log("[K-MENU-SERVICE] Restored empty namespace filter");
            }
          });
        } catch (err) {
          console.warn("[K-MENU-SERVICE] Could not restore namespace filter:", err);
        }
      }
    }

    return allResources;
  }

  /**
   * Delete a K8s resource
   */
  static async deleteResource(resource: K8sResource): Promise<void> {
    const K8sApi = (Renderer as any).K8sApi;

    if (!K8sApi) {
      console.error("[K-MENU] K8sApi not available");
      throw new Error("K8sApi not available");
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
      namespace: resource.namespace,
    });

    console.log(`[K-MENU] Successfully deleted resource`);
  }
}
