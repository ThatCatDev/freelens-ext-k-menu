import { Renderer } from "@freelensapp/extensions";

export interface KubeResource {
  kind: string;
  name: string;
  namespace?: string;
  uid: string;
  apiVersion: string;
}

/**
 * Service for handling navigation in Freelens
 * Distinguishes between cluster-level navigation (parent window) and resource-level navigation (iframe)
 */
export class NavigationService {
  /**
   * Navigate to a cluster - should happen in parent window
   */
  static navigateToCluster(clusterId: string): void {
    console.log(`[K-MENU] Navigating to cluster: ${clusterId}`);

    // Check if we're in an iframe (cluster context)
    const inIframe = window.self !== window.top;
    console.log(`[K-MENU] In iframe context:`, inIframe);

    const targetPath = `/cluster/${clusterId}`;

    try {
      if (inIframe) {
        // We're in an iframe, need to navigate the parent window
        console.log(`[K-MENU] In iframe - trying to access parent navigation`);

        try {
          // Try to access parent window's Renderer API
          const parentWindow = window.parent as any;
          const parentRenderer = parentWindow?.LensExtensions?.Renderer;

          if (parentRenderer?.Navigation?.navigate) {
            console.log(`[K-MENU] Using parent window's Navigation.navigate`);
            parentRenderer.Navigation.navigate(targetPath);
          } else {
            console.warn(`[K-MENU] Parent Navigation not available, trying direct location change`);
            // Fallback: try changing parent location hash
            if (parentWindow?.location) {
              parentWindow.location.hash = `#${targetPath}`;
            }
          }
        } catch (parentErr) {
          console.error(`[K-MENU] Error accessing parent window:`, parentErr);
          // Last resort: try current window navigation
          Renderer.Navigation.navigate(targetPath);
        }
      } else {
        // We're in the main window
        console.log(`[K-MENU] Navigating current window (main context)`);
        Renderer.Navigation.navigate(targetPath);
      }
      console.log(`[K-MENU] Navigation initiated successfully`);
    } catch (err) {
      console.error(`[K-MENU] Navigation failed:`, err);
      throw err;
    }
  }

  /**
   * Navigate to a resource - should happen in cluster iframe
   * This assumes we're already in or navigating within a cluster context
   */
  static navigateToResource(_clusterId: string, resource: KubeResource): void {
    console.log("[K-MENU] Navigating to resource:", resource);

    try {
      const Navigation = (Renderer as any).Navigation;

      if (!Navigation || !Navigation.showDetails) {
        console.error("[K-MENU] Navigation.showDetails not available");
        throw new Error("Navigation API not available");
      }

      // Construct the selfLink for the resource
      const selfLink = this.constructSelfLink(resource);
      console.log("[K-MENU] Constructed selfLink:", selfLink);

      // showDetails expects a selfLink string
      console.log("[K-MENU] Calling Navigation.showDetails with selfLink:", selfLink);
      Navigation.showDetails(selfLink, false);
      console.log("[K-MENU] Navigation call completed");
    } catch (err) {
      console.error("[K-MENU] Error navigating to resource:", err);
      throw err;
    }
  }

  /**
   * Construct selfLink for a resource
   */
  private static constructSelfLink(resource: KubeResource): string {
    // Construct from apiVersion - this is the standard Kubernetes selfLink format
    const [group, version] = resource.apiVersion.includes("/")
      ? resource.apiVersion.split("/")
      : ["", resource.apiVersion];

    const apiBase = group ? `/apis/${group}/${version}` : `/api/${version}`;
    const plural = this.pluralize(resource.kind);

    if (resource.namespace) {
      return `${apiBase}/namespaces/${resource.namespace}/${plural}/${resource.name}`;
    } else {
      return `${apiBase}/${plural}/${resource.name}`;
    }
  }

  /**
   * Simple pluralization
   */
  private static pluralize(kind: string): string {
    const lower = kind.toLowerCase();

    // Special cases
    if (lower === "endpoints") return "endpoints";
    if (lower === "ingress") return "ingresses";
    if (lower.endsWith("class")) return lower + "es";
    if (lower.endsWith("policy")) return lower.slice(0, -1) + "ies";

    // Default pluralization
    if (lower.endsWith("s")) return lower + "es";
    if (lower.endsWith("y")) return lower.slice(0, -1) + "ies";
    return lower + "s";
  }
}
