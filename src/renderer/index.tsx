/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Renderer } from "@freelensapp/extensions";
import { KMenuPreferencesStore } from "../common/store";
import { KMenuPalette } from "./components/k-menu-palette";
import { KMenuPreferenceHint, KMenuPreferenceInput } from "./preferences/k-menu-preference";

export default class KMenuRenderer extends Renderer.LensExtension {
  private kMenuPalette: KMenuPalette | null = null;

  async onActivate() {
    console.log("[K-MENU] Extension activating...");
    KMenuPreferencesStore.getInstanceOrCreate().loadExtension(this);

    // Initialize K-Menu palette
    this.initKMenu();
  }

  async onDeactivate() {
    console.log("[K-MENU] Extension deactivating...");
    if (this.kMenuPalette) {
      this.kMenuPalette.destroy();
      this.kMenuPalette = null;
    }
  }

  private initKMenu() {
    console.log("[K-MENU] Initializing K-Menu palette...");

    // Wait for DOM to be ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.initKMenu());
      return;
    }

    // If in iframe, set up a keyboard listener that forwards to parent
    if (window.self !== window.top) {
      console.log("[K-MENU] Running in iframe - setting up keyboard forwarder");
      this.setupIframeKeyboardForwarder();
      return;
    }

    console.log("[K-MENU] Running in main window - creating K-Menu instance");

    try {
      // Create the K-Menu palette instance (only in main window)
      this.kMenuPalette = new KMenuPalette();
      console.log("[K-MENU] K-Menu palette initialized successfully in main window");
    } catch (err) {
      console.error("[K-MENU] Error initializing K-Menu:", err);
    }
  }

  private setupIframeKeyboardForwarder() {
    // In iframes, listen for the keyboard shortcut and forward to parent
    document.addEventListener("keydown", (event: KeyboardEvent) => {
      const preferences = KMenuPreferencesStore.getInstanceOrCreate<KMenuPreferencesStore>();

      if (!preferences.enabled) {
        return;
      }

      // Check if this matches the K-Menu shortcut
      const shortcut = preferences.keyboardShortcut || "Cmd+K";
      if (this.matchesShortcut(event, shortcut)) {
        console.log("[K-MENU] Keyboard shortcut detected in iframe, forwarding to parent");
        event.preventDefault();
        event.stopPropagation();

        // Extract cluster ID from current hostname
        const hostname = window.location.hostname;
        const match = hostname.match(/^([a-f0-9]+)\.renderer\.freelens\.app$/);
        const clusterId = match ? match[1] : null;

        // Send message to parent window to toggle K-Menu with cluster ID
        window.parent.postMessage(
          {
            type: "k-menu-toggle",
            clusterId: clusterId,
          },
          "*",
        );
      }
    });

    // Listen for resource requests from parent window
    window.addEventListener("message", async (event: MessageEvent) => {
      // Handle get resources request
      if (event.data?.type === "k-menu-get-resources") {
        console.log("[K-MENU-IFRAME] Received resource request from parent");

        try {
          // Import the service dynamically to avoid loading it in main window
          const { K8sResourceService } = await import("./services/k8s-resource-service");

          // Fetch resources from stores (which ARE available in cluster iframe)
          const resources = await K8sResourceService.getAllResources();

          console.log(`[K-MENU-IFRAME] Sending ${resources.length} resources back to parent`);

          // Send resources back to parent
          event.source?.postMessage(
            {
              type: "k-menu-resources-response",
              requestId: event.data.requestId,
              resources: resources,
            },
            { targetOrigin: "*" } as any,
          );
        } catch (err) {
          console.error("[K-MENU-IFRAME] Error fetching resources:", err);

          // Send error back to parent
          event.source?.postMessage(
            {
              type: "k-menu-resources-response",
              requestId: event.data.requestId,
              error: String(err),
            },
            { targetOrigin: "*" } as any,
          );
        }
        return;
      }

      // Handle delete resource request
      if (event.data?.type === "k-menu-delete-resource") {
        console.log("[K-MENU-IFRAME] Received delete request from parent");

        try {
          const { K8sResourceService } = await import("./services/k8s-resource-service");

          // Delete the resource
          await K8sResourceService.deleteResource(event.data.resource);

          console.log("[K-MENU-IFRAME] Resource deleted successfully");

          // Send success response back to parent
          event.source?.postMessage(
            {
              type: "k-menu-delete-response",
              requestId: event.data.requestId,
            },
            { targetOrigin: "*" } as any,
          );
        } catch (err) {
          console.error("[K-MENU-IFRAME] Error deleting resource:", err);

          // Send error back to parent
          event.source?.postMessage(
            {
              type: "k-menu-delete-response",
              requestId: event.data.requestId,
              error: String(err),
            },
            { targetOrigin: "*" } as any,
          );
        }
        return;
      }

      // Handle navigate to resource request
      if (event.data?.type === "k-menu-navigate-to-resource") {
        console.log("[K-MENU-IFRAME] Received navigation request from parent:", event.data.resource);

        try {
          const { NavigationService } = await import("./services/navigation-service");

          // Navigate to the resource (this happens in the iframe where navigation works)
          NavigationService.navigateToResource(event.data.clusterId, event.data.resource);

          console.log("[K-MENU-IFRAME] Navigation completed");
        } catch (err) {
          console.error("[K-MENU-IFRAME] Error navigating to resource:", err);
        }
        return;
      }

      // Handle open logs request
      if (event.data?.type === "k-menu-open-logs") {
        console.log("[K-MENU-IFRAME] Received logs request from parent:", event.data.resource);

        try {
          const { LogsService } = await import("./services/logs-service");

          // Open logs in the iframe where the log APIs work
          await LogsService.openPodLogs(event.data.resource);

          console.log("[K-MENU-IFRAME] Logs opened successfully");

          // Send success response back to parent
          event.source?.postMessage(
            {
              type: "k-menu-logs-response",
              requestId: event.data.requestId,
            },
            { targetOrigin: "*" } as any,
          );
        } catch (err) {
          console.error("[K-MENU-IFRAME] Error opening logs:", err);

          // Send error back to parent
          event.source?.postMessage(
            {
              type: "k-menu-logs-response",
              requestId: event.data.requestId,
              error: String(err),
            },
            { targetOrigin: "*" } as any,
          );
        }
        return;
      }
    });

    console.log("[K-MENU] Iframe keyboard forwarder and resource handler set up");
  }

  private matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
    const parts = shortcut
      .toLowerCase()
      .split("+")
      .map((p) => p.trim());
    const key = parts[parts.length - 1];
    const modifiers = parts.slice(0, -1);

    if (event.key.toLowerCase() !== key) {
      return false;
    }

    const hasCmd = modifiers.includes("cmd") || modifiers.includes("meta");
    const hasCtrl = modifiers.includes("ctrl");
    const hasAlt = modifiers.includes("alt");
    const hasShift = modifiers.includes("shift");

    const cmdPressed = event.metaKey || (hasCtrl && event.ctrlKey);
    const ctrlPressed = event.ctrlKey;
    const altPressed = event.altKey;
    const shiftPressed = event.shiftKey;

    if (hasCmd && !cmdPressed) return false;
    if (hasCtrl && !ctrlPressed) return false;
    if (hasAlt && !altPressed) return false;
    if (hasShift && !shiftPressed) return false;

    if (!hasCmd && (event.metaKey || (event.ctrlKey && !hasCtrl))) return false;
    if (!hasCtrl && event.ctrlKey && !cmdPressed) return false;
    if (!hasAlt && event.altKey) return false;
    if (!hasShift && event.shiftKey) return false;

    return true;
  }

  appPreferences = [
    {
      title: "K-Menu",
      components: {
        Input: () => <KMenuPreferenceInput />,
        Hint: () => <KMenuPreferenceHint />,
      },
    },
  ];
}
