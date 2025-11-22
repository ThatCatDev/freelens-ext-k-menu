import { Renderer } from "@freelensapp/extensions";

export interface KubeResource {
  kind: string;
  name: string;
  namespace?: string;
  uid: string;
  apiVersion: string;
}

/**
 * Service for opening pod logs
 * This must run in the iframe context where stores and log APIs are available
 */
export class LogsService {
  /**
   * Open logs for a pod
   */
  static async openPodLogs(resource: KubeResource): Promise<void> {
    if (resource.kind !== "Pod") {
      throw new Error(`Logs are only available for Pods, not ${resource.kind}`);
    }

    console.log("[K-MENU-LOGS] Opening logs for pod:", resource.name, "in namespace:", resource.namespace);

    try {
      // Get the full Pod object from the store
      const K8sApi = (Renderer as any).K8sApi;
      const podStore = K8sApi.podsStore;

      if (!podStore) {
        console.error("[K-MENU-LOGS] Pod store not available. K8sApi:", K8sApi);
        throw new Error("Pod store not available");
      }

      console.log("[K-MENU-LOGS] Listing pods in namespace:", resource.namespace);

      // List pods in the namespace and find ours
      const pods = await podStore.api.list(resource.namespace);
      console.log("[K-MENU-LOGS] Found", pods.length, "pods in namespace");

      const pod = pods.find((p: any) => p.getName() === resource.name);

      if (!pod) {
        console.error(
          "[K-MENU-LOGS] Pod not found. Available pods:",
          pods.map((p: any) => p.getName()),
        );
        throw new Error(`Pod not found: ${resource.name}`);
      }

      console.log("[K-MENU-LOGS] Found pod object:", pod);

      // Get the first container using getAllContainersWithType (like Freelens does)
      const containers = pod.getAllContainersWithType?.() || pod.getAllContainers?.() || [];
      console.log("[K-MENU-LOGS] Pod has", containers.length, "containers:", containers);

      if (containers.length === 0) {
        throw new Error("Pod has no containers");
      }

      const selectedContainer = containers[0];
      console.log("[K-MENU-LOGS] Selected container:", selectedContainer);

      // Use the Freelens API to create pod logs tab
      const Component = (Renderer as any).Component;
      console.log("[K-MENU-LOGS] Component:", Component);
      console.log("[K-MENU-LOGS] logTabStore:", Component?.logTabStore);
      console.log("[K-MENU-LOGS] createPodTab:", Component?.logTabStore?.createPodTab);

      if (Component.logTabStore && Component.logTabStore.createPodTab) {
        const result = Component.logTabStore.createPodTab({
          selectedPod: pod,
          selectedContainer: selectedContainer,
        });
        console.log("[K-MENU-LOGS] Created pod logs tab successfully. Result:", result);
      } else {
        console.error("[K-MENU-LOGS] logTabStore.createPodTab not available");
        console.error("[K-MENU-LOGS] Available Component properties:", Object.keys(Component || {}));
        throw new Error("Log tab creation API not available");
      }
    } catch (error) {
      console.error("[K-MENU-LOGS] Failed to open pod logs:", error);
      console.error("[K-MENU-LOGS] Error stack:", error instanceof Error ? error.stack : "No stack");

      // Try to show error notification
      const Notifications = (Renderer as any).Component?.Notifications;
      if (Notifications?.error) {
        Notifications.error(`Failed to open logs: ${error instanceof Error ? error.message : String(error)}`);
      }

      throw error;
    }
  }
}
