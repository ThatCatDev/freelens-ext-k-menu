/**
 * K-Menu Command Palette - Vanilla JS implementation for Freelens
 */

import { Renderer } from "@freelensapp/extensions";
import { KMenuPreferencesStore } from "../../common/store";
import { NavigationService } from "../services/navigation-service";
import type { K8sResource } from "../services/k8s-resource-service";

interface KubeResource {
  kind: string;
  name: string;
  namespace?: string;
  uid: string;
  apiVersion: string;
}

interface SearchResult {
  resource: KubeResource;
  displayText: string;
  matchScore: number;
}

interface Filter {
  type: 'kind' | 'namespace' | 'node';
  value: string;
}

interface Command {
  id: string;
  label: string;
  description: string;
  requiresResource?: boolean;
  resourceTypes?: string[];
  execute: (resource?: KubeResource) => void;
}

export class KMenuPalette {
  private container: HTMLDivElement | null = null;
  private backdrop: HTMLDivElement | null = null;
  private modal: HTMLDivElement | null = null;
  private input: HTMLInputElement | null = null;
  private resultsList: HTMLDivElement | null = null;
  private loadingIndicator: HTMLDivElement | null = null;
  private filterTagsContainer: HTMLDivElement | null = null;
  private isOpen = false;
  private selectedIndex = 0;
  private results: SearchResult[] = [];
  private allResources: KubeResource[] = [];

  // Active filters
  private activeFilters: Filter[] = [];

  // Autocomplete state
  private autocompleteSuggestions: string[] = [];
  private autocompleteSelectedIndex: number = -1;
  private autocompleteFilterType: 'kind' | 'namespace' | 'node' | null = null;

  // Command mode state
  private isCommandMode = false;
  private availableCommands: Command[] = [];
  private selectedCommandIndex = 0;
  private activeCommand: Command | null = null;
  private commandSearchQuery: string = "";

  // Cluster-specific resource cache
  private resourceCache: Map<string, KubeResource[]> = new Map();
  private currentClusterId: string | null = null;

  // Debounce timer for search
  private searchDebounceTimer: number | null = null;
  private readonly DEBOUNCE_DELAY = 150; // ms

  private activeIframeSource: Window | null = null;

  constructor() {
    this.setupKeyboardListener();
    this.setupMessageListener();
    this.createDOM();
    // Don't initialize commands in constructor - Catalog API might not be ready yet
    // Commands will be initialized when palette is first opened
  }

  private setupMessageListener() {
    // Listen for messages from iframes
    window.addEventListener('message', (event) => {
      if (!event.data) return;

      switch (event.data.type) {
        case 'k-menu-toggle':
          console.log('[K-MENU] Received toggle request from iframe');
          // Remember which iframe requested the toggle (this is the active cluster context)
          this.activeIframeSource = event.source as Window;
          // Store the cluster ID from the message
          if (event.data.clusterId) {
            this.currentClusterId = event.data.clusterId;
            console.log('[K-MENU] Cluster ID:', this.currentClusterId);
          }
          this.toggle();
          break;
      }
    });

    // Track when iframes gain/lose focus to know which is active
    window.addEventListener('blur', () => {
      // When main window loses focus, check if an iframe gained focus
      setTimeout(() => {
        const activeElement = document.activeElement;
        if (activeElement && activeElement.tagName === 'IFRAME') {
          console.log('[K-MENU] Iframe gained focus');
          this.activeIframeSource = (activeElement as HTMLIFrameElement).contentWindow;

          // Try to extract cluster ID from iframe's src URL
          const iframe = activeElement as HTMLIFrameElement;
          if (iframe.src) {
            try {
              const url = new URL(iframe.src);
              const match = url.hostname.match(/^([a-f0-9]+)\.renderer\.freelens\.app$/);
              if (match) {
                this.currentClusterId = match[1];
                console.log('[K-MENU] Extracted cluster ID from iframe:', this.currentClusterId);
              }
            } catch (err) {
              console.warn('[K-MENU] Failed to parse iframe URL:', err);
            }
          }
        }
      }, 0);
    });
  }

  private async loadResourcesViaIPC(showLoading = true): Promise<void> {
    console.log("[K-MENU] Requesting resources from cluster iframe (showLoading:", showLoading, ")");

    // Only show loading indicator if not a background refresh
    if (showLoading) {
      if (this.loadingIndicator) {
        this.loadingIndicator.style.display = 'block';
      }
      if (this.resultsList) {
        this.resultsList.style.display = 'none';
      }
    }

    try {
      // If we have an active iframe source, request resources from it
      if (this.activeIframeSource) {
        const resources = await this.requestResourcesFromIframe(this.activeIframeSource);
        this.allResources = resources;
      } else {
        // No active iframe - we're in global mode, no resources available
        console.log("[K-MENU] No active cluster iframe - global mode");
        this.allResources = [];
      }

      // Cache the resources for this cluster
      if (this.currentClusterId) {
        const hadCache = this.resourceCache.has(this.currentClusterId);
        this.resourceCache.set(this.currentClusterId, this.allResources);
        console.log(`[K-MENU] ${hadCache ? '↻ Updated' : '💾 Cached'} ${this.allResources.length} resources`);
      }

      this.handleInput();
    } catch (error) {
      console.error('[K-MENU] Error loading resources:', error);
      this.allResources = [];
      this.handleInput();
    } finally {
      // Hide loading indicator
      if (this.loadingIndicator) {
        this.loadingIndicator.style.display = 'none';
      }
      if (this.resultsList) {
        this.resultsList.style.display = 'block';
      }
    }
  }

  private requestResourcesFromIframe(iframe: Window): Promise<KubeResource[]> {
    return new Promise((resolve, reject) => {
      const requestId = Math.random().toString(36).substring(7);
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Resource request timeout'));
      }, 10000); // 10 second timeout

      const messageHandler = (event: MessageEvent) => {
        if (event.data?.type === 'k-menu-resources-response' && event.data?.requestId === requestId) {
          cleanup();

          if (event.data.error) {
            reject(new Error(event.data.error));
          } else {
            resolve(event.data.resources || []);
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        window.removeEventListener('message', messageHandler);
      };

      window.addEventListener('message', messageHandler);

      // Send request to iframe
      console.log('[K-MENU] Sending resource request to iframe with ID:', requestId);
      iframe.postMessage({
        type: 'k-menu-get-resources',
        requestId: requestId
      }, '*');
    });
  }

  private buildNavigationCommands(): Command[] {
    const discoveredCommands: Command[] = [];

    // Add cluster switching commands (available from anywhere)
    console.log('[K-MENU] Current URL:', window.location.href);
    console.log('[K-MENU] Building cluster switching commands');

    try {
        const Catalog = Renderer.Catalog;
        console.log('[K-MENU] Catalog API available:', !!Catalog);
        console.log('[K-MENU] catalogEntities available:', !!Catalog?.catalogEntities);

        if (Catalog && Catalog.catalogEntities) {
          // Try to get catalog entities
          let clusters;
          try {
            clusters = Catalog.catalogEntities.getItemsForApiKind('entity.k8slens.dev/v1alpha1', 'KubernetesCluster');
            console.log('[K-MENU] Successfully retrieved clusters:', clusters);
          } catch (err) {
            console.warn('[K-MENU] Error getting catalog entities:', err);
            clusters = null;
          }

          // Add commands for each cluster
          if (Array.isArray(clusters) && clusters.length > 0) {
          clusters.forEach((cluster: any) => {
            console.log('[K-MENU] Processing cluster:', cluster);
            if (cluster && cluster.metadata && cluster.metadata.name) {
              const clusterName = cluster.metadata.name;
              // Try multiple possible ID fields
              const clusterId = cluster.id || cluster.metadata.uid || cluster.metadata.name;

              console.log(`[K-MENU] Cluster ID candidates - id: ${cluster.id}, uid: ${cluster.metadata.uid}, using: ${clusterId}`);

              discoveredCommands.push({
                id: `cluster-${clusterId}`,
                label: `cluster ${clusterName}`,
                description: `Switch to cluster: ${clusterName}`,
                requiresResource: false,
                execute: async () => {
                  console.log(`[K-MENU] Switching to cluster: ${clusterName} (${clusterId})`);

                  // Get the current cluster ID to check if we're switching
                  const currentClusterId = this.getClusterIdFromHostname();
                  const isCurrentCluster = currentClusterId === clusterId;

                  console.log(`[K-MENU] Current cluster: ${currentClusterId}, Target cluster: ${clusterId}`);

                  if (isCurrentCluster) {
                    console.log(`[K-MENU] Already in target cluster, no navigation needed`);
                    return;
                  }

                  // Use NavigationService for cluster navigation
                  try {
                    NavigationService.navigateToCluster(clusterId);
                  } catch (err) {
                    console.error(`[K-MENU] Navigation failed:`, err);
                    console.error(`[K-MENU] Error details:`, err);
                  }
                },
              });

              console.log(`[K-MENU] Added cluster command: /cluster ${clusterName}`);
            }
          });
        } else {
          console.log('[K-MENU] No clusters found or clusters is not an array');
          }
        } else {
          console.log('[K-MENU] Catalog or catalogEntities not available');
        }
      } catch (error) {
        console.warn('[K-MENU] Error building cluster commands:', error);
      }

    // Sort commands alphabetically by label
    discoveredCommands.sort((a, b) => a.label.localeCompare(b.label));

    console.log(`[K-MENU] Built ${discoveredCommands.length} navigation commands`);
    return discoveredCommands;
  }

  private initializeCommands() {
    // Dynamically build navigation commands from resource kinds
    const navigationCommands = this.buildNavigationCommands();

    this.availableCommands = [
      ...navigationCommands,
      // Resource action commands
      {
        id: 'logs',
        label: 'logs',
        description: 'View pod logs',
        requiresResource: true,
        resourceTypes: ['Pod'],
        execute: async (resource) => {
          if (resource && resource.kind === 'Pod') {
            console.log('[K-MENU] Opening logs for pod:', resource.name, 'in namespace:', resource.namespace);

            try {
              await this.openPodLogs(resource);
            } catch (error) {
              console.error('[K-MENU] Failed to open pod logs:', error);
              alert(`Failed to open logs: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        },
      },
      {
        id: 'describe',
        label: 'describe',
        description: 'Show detailed resource information',
        requiresResource: true,
        execute: (resource) => {
          if (resource) {
            console.log('[K-MENU] Describing resource:', resource.name);

            // Use stored cluster ID
            if (!this.currentClusterId) {
              console.error('[K-MENU] Not in cluster context');
              return;
            }

            // Use NavigationService for resource navigation
            NavigationService.navigateToResource(this.currentClusterId, resource as K8sResource);
          }
        },
      },
      {
        id: 'delete',
        label: 'delete',
        description: 'Delete the selected resource (requires confirmation)',
        requiresResource: true,
        execute: async (resource) => {
          if (resource) {
            const resourceName = resource.namespace
              ? `${resource.kind}/${resource.namespace}/${resource.name}`
              : `${resource.kind}/${resource.name}`;

            const confirmed = confirm(
              `⚠️ Are you sure you want to delete ${resourceName}?\n\nThis action cannot be undone.`
            );

            if (confirmed) {
              console.log('[K-MENU] Deleting resource:', resource.name);

              try {
                await this.deleteResource(resource);
                alert(`✓ Successfully deleted ${resourceName}`);
                // Refresh the resource list
                await this.refreshResources();
              } catch (err) {
                console.error('[K-MENU] Error deleting resource:', err);
                alert(`✗ Failed to delete ${resourceName}: ${err}`);
              }
            }
          }
        },
      },
      {
        id: 'refresh',
        label: 'refresh',
        description: 'Reload all resources from the cluster',
        requiresResource: false,
        execute: async () => {
          console.log('[K-MENU] Refreshing resources...');

          // Show loading indicator
          if (this.loadingIndicator) {
            this.loadingIndicator.style.display = 'block';
          }
          if (this.resultsList) {
            this.resultsList.style.display = 'none';
          }

          try {
            await this.refreshResources();
            alert('✓ Resources refreshed successfully!');
          } catch (err) {
            console.error('[K-MENU] Error refreshing:', err);
            alert(`✗ Failed to refresh resources: ${err}`);
          } finally {
            // Hide loading indicator
            if (this.loadingIndicator) {
              this.loadingIndicator.style.display = 'none';
            }
            if (this.resultsList) {
              this.resultsList.style.display = 'block';
            }
          }
        },
      },
    ];
  }

  private setupKeyboardListener() {
    console.log("[K-MENU] Setting up keyboard listener in main window");
    document.addEventListener("keydown", (event: KeyboardEvent) => {
      const preferences = KMenuPreferencesStore.getInstanceOrCreate<KMenuPreferencesStore>();

      // Check if K-Menu is enabled
      if (!preferences.enabled) {
        return;
      }

      // Parse the keyboard shortcut
      const shortcut = preferences.keyboardShortcut || "Cmd+K";
      if (this.matchesShortcut(event, shortcut)) {
        console.log("[K-MENU] Keyboard shortcut matched in main window:", shortcut);
        event.preventDefault();
        event.stopPropagation();
        this.toggle();
      }
    });
    console.log("[K-MENU] Keyboard listener set up successfully");
  }

  private matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
    // Parse shortcut like "Cmd+K", "Ctrl+Shift+P", etc.
    const parts = shortcut.toLowerCase().split("+").map(p => p.trim());
    const key = parts[parts.length - 1];
    const modifiers = parts.slice(0, -1);

    // Check if the key matches
    if (event.key.toLowerCase() !== key) {
      return false;
    }

    // Check modifiers
    const hasCmd = modifiers.includes("cmd") || modifiers.includes("meta");
    const hasCtrl = modifiers.includes("ctrl");
    const hasAlt = modifiers.includes("alt");
    const hasShift = modifiers.includes("shift");

    // On Mac, Cmd is metaKey, on Windows/Linux it's usually Ctrl
    const cmdPressed = event.metaKey || (hasCtrl && event.ctrlKey);
    const ctrlPressed = event.ctrlKey;
    const altPressed = event.altKey;
    const shiftPressed = event.shiftKey;

    // Match modifiers
    if (hasCmd && !cmdPressed) return false;
    if (hasCtrl && !ctrlPressed) return false;
    if (hasAlt && !altPressed) return false;
    if (hasShift && !shiftPressed) return false;

    // Make sure no extra modifiers are pressed
    if (!hasCmd && (event.metaKey || (event.ctrlKey && !hasCtrl))) return false;
    if (!hasCtrl && event.ctrlKey && !cmdPressed) return false;
    if (!hasAlt && event.altKey) return false;
    if (!hasShift && event.shiftKey) return false;

    return true;
  }

  private createDOM() {
    // Create container
    this.container = document.createElement("div");
    this.container.id = "k-menu-palette-container";
    this.container.style.cssText = "display: none;";

    // Create backdrop
    this.backdrop = document.createElement("div");
    this.backdrop.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 9999;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 20vh;
      animation: fadeIn 0.15s ease-out;
    `;

    // Create modal
    this.modal = document.createElement("div");
    this.modal.style.cssText = `
      background: #1e1e1e;
      border: 1px solid #333;
      border-radius: 8px;
      width: 600px;
      max-width: 90vw;
      max-height: 60vh;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      animation: slideDown 0.2s ease-out;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    `;

    // Create input container
    const inputContainer = document.createElement("div");
    inputContainer.style.cssText = `
      padding: 16px;
      border-bottom: 1px solid #333;
    `;

    // Create filter tags container
    this.filterTagsContainer = document.createElement("div");
    this.filterTagsContainer.style.cssText = `
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 8px;
      min-height: 0;
    `;
    this.filterTagsContainer.id = "k-menu-filter-tags";

    // Create input
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.placeholder = "Search resources or type / for commands (e.g., /pods, /services, /logs)";
    this.input.style.cssText = `
      width: 100%;
      background: transparent;
      border: none;
      outline: none;
      font-size: 16px;
      color: #fff;
      font-family: inherit;
      padding: 8px 0;
    `;
    this.input.addEventListener("input", () => this.handleInput());
    this.input.addEventListener("keydown", (e) => this.handleKeyDown(e));

    // Create autocomplete hint (shown below input)
    const autocompleteHint = document.createElement("div");
    autocompleteHint.style.cssText = `
      font-size: 12px;
      color: #666;
      margin-top: 4px;
      min-height: 16px;
    `;
    autocompleteHint.id = "k-menu-autocomplete-hint";

    inputContainer.appendChild(this.filterTagsContainer);
    inputContainer.appendChild(this.input);
    inputContainer.appendChild(autocompleteHint);

    // Create results list
    this.resultsList = document.createElement("div");
    this.resultsList.style.cssText = `
      overflow-y: auto;
      max-height: calc(60vh - 100px);
      padding: 8px 0;
    `;

    // Create loading indicator
    this.loadingIndicator = document.createElement("div");
    this.loadingIndicator.style.cssText = `
      padding: 32px 16px;
      text-align: center;
      color: #888;
      font-size: 14px;
      display: none;
    `;
    this.loadingIndicator.innerHTML = `
      <div style="display: inline-block; margin-bottom: 8px;">
        <div style="
          width: 24px;
          height: 24px;
          border: 3px solid #333;
          border-top-color: #888;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        "></div>
      </div>
      <div>Loading resources...</div>
    `;

    // Create hint
    const hint = document.createElement("div");
    hint.style.cssText = `
      padding: 12px 16px;
      font-size: 13px;
      color: #888;
      border-top: 1px solid #333;
    `;
    hint.innerHTML = `
      <span style="color: #666;">↑↓</span> Navigate
      <span style="color: #666; margin-left: 12px;">Enter</span> Open
      <span style="color: #666; margin-left: 12px;">Esc</span> Close
    `;

    // Assemble modal
    this.modal.appendChild(inputContainer);
    this.modal.appendChild(this.loadingIndicator);
    this.modal.appendChild(this.resultsList);
    this.modal.appendChild(hint);

    // Assemble backdrop
    this.backdrop.appendChild(this.modal);
    this.backdrop.addEventListener("click", (e) => {
      if (e.target === this.backdrop) {
        this.close();
      }
    });

    // Assemble container
    this.container.appendChild(this.backdrop);
    document.body.appendChild(this.container);

    // Add CSS animations
    const style = document.createElement("style");
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideDown {
        from { transform: translateY(-20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .k-menu-result-item {
        padding: 12px 16px;
        cursor: pointer;
        border-left: 3px solid transparent;
        transition: all 0.1s;
      }
      .k-menu-result-item:hover {
        background: #2a2a2a;
        border-left-color: #007acc;
      }
      .k-menu-result-item.selected {
        background: #2a2a2a;
        border-left-color: #007acc;
      }
      .k-menu-result-title {
        font-size: 14px;
        color: #fff;
        font-weight: 500;
        margin-bottom: 4px;
      }
      .k-menu-result-meta {
        font-size: 12px;
        color: #888;
      }
      .k-menu-result-kind {
        display: inline-block;
        padding: 2px 6px;
        background: #444;
        border-radius: 3px;
        font-size: 11px;
        margin-right: 8px;
        color: #aaa;
      }
      .k-menu-empty {
        padding: 32px 16px;
        text-align: center;
        color: #666;
        font-size: 14px;
      }
    `;
    document.head.appendChild(style);
  }

  public toggle() {
    console.log("[K-MENU] Toggle called, isOpen:", this.isOpen);
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  public async open() {
    console.log("[K-MENU] ========== OPENING PALETTE ==========");
    console.log("[K-MENU] Active iframe source:", !!this.activeIframeSource);
    console.log("[K-MENU] Current cluster ID:", this.currentClusterId);

    this.isOpen = true;
    if (this.container) {
      this.container.style.display = "block";
      console.log("[K-MENU] Container displayed");
    } else {
      console.error("[K-MENU] Container is null!");
    }

    // Focus input
    setTimeout(() => {
      if (this.input) {
        this.input.focus();
        console.log("[K-MENU] Input focused");
      } else {
        console.error("[K-MENU] Input is null!");
      }
    }, 100);

    // Initialize/refresh commands (including cluster switching)
    // Do this on every open to ensure Catalog API is available
    this.initializeCommands();

    // Check if we're in a cluster context
    // We're in cluster context if we have an active iframe (message was sent) or cluster ID is set
    const inCluster = this.activeIframeSource !== null || this.currentClusterId !== null;

    console.log("[K-MENU] In cluster context:", inCluster);

    // Load resources only if in a cluster context
    if (inCluster) {
      console.log("[K-MENU] Loading resources for cluster...");
      await this.loadResources();
    } else {
      console.log("[K-MENU] Global mode - no resources to load");
      // In global mode, just show the command list
      this.allResources = [];
    }

    this.renderResults();
    console.log("[K-MENU] ========== PALETTE OPENED ==========");
  }

  private getClusterIdFromHostname(): string | null {
    const hostname = window.location.hostname;
    console.log("[K-MENU] Extracting cluster ID from hostname:", hostname);

    const match = hostname.match(/^([a-f0-9]+)\.renderer\.freelens\.app$/);
    const clusterId = match ? match[1] : null;

    console.log("[K-MENU] Extracted cluster ID:", clusterId);
    return clusterId;
  }

  public close() {
    console.log("[K-MENU] Closing palette...");

    // Clear debounce timer
    if (this.searchDebounceTimer !== null) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }

    this.isOpen = false;
    if (this.container) {
      this.container.style.display = "none";
    }
    if (this.input) {
      this.input.value = "";
    }
    this.results = [];
    this.selectedIndex = 0;

    // Clear active filters
    this.activeFilters = [];
    this.renderFilterTags();
  }


  // Helper function to fetch with retry and exponential backoff
  private async fetchWithRetry<T>(
    fetchFn: () => Promise<T>,
    resourceKind: string,
    maxRetries: number = 3,
    initialDelayMs: number = 500
  ): Promise<T | null> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fetchFn();
      } catch (err) {
        if (attempt === maxRetries) {
          console.error(`[K-MENU] Failed to fetch ${resourceKind} after ${maxRetries + 1} attempts:`, err);
          return null;
        }

        const delayMs = initialDelayMs * Math.pow(2, attempt);
        console.warn(`[K-MENU] Failed to fetch ${resourceKind} (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delayMs}ms...`, err);

        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    return null;
  }

  private async loadResources() {
    // If we have an active cluster context, load resources via IPC
    if (this.activeIframeSource || this.currentClusterId) {
      // Check if we have cached resources for this cluster
      const hasCache = this.currentClusterId && this.resourceCache.has(this.currentClusterId);

      if (hasCache) {
        // Use cached resources immediately
        this.allResources = this.resourceCache.get(this.currentClusterId!)!;
        console.log(`[K-MENU] ✓ Using cache (${this.allResources.length} resources) - refreshing in background`);

        // Render results immediately with cached data
        this.renderResults();

        // Refresh in background (don't show loading, don't await)
        this.loadResourcesViaIPC(false);
      } else {
        // No cache, show loading and fetch
        console.log('[K-MENU] ✗ No cache - fetching resources');
        await this.loadResourcesViaIPC(true);
      }
      return;
    }

    // Otherwise, we're in the main window (catalog/no cluster context)
    console.log('[K-MENU] Not in cluster context - no resources to load');
    this.allResources = [];
    this.handleInput();
  }

  // Old implementation kept for reference - not used anymore
  // @ts-ignore
  private async loadResourcesOldImpl() {
    try {
      // Show loading indicator
      if (this.loadingIndicator) {
        this.loadingIndicator.style.display = 'block';
      }
      if (this.resultsList) {
        this.resultsList.style.display = 'none';
      }

      this.allResources = [];

      // Get all store properties from Renderer.K8sApi that end with 'Store'
      const K8sApi = Renderer.K8sApi as any;

      // Debug: log all keys
      const allKeys = Object.keys(K8sApi);
      console.log('[K-MENU] All K8sApi keys:', allKeys);

      const storeKeys = allKeys.filter(key => key.endsWith('Store'));
      console.log('[K-MENU] Store keys found:', storeKeys);

      // Manually build the stores list from known Freelens exports
      const stores = [
        // Workloads
        { store: K8sApi.podsStore, kind: 'Pod' },
        { store: K8sApi.deploymentStore, kind: 'Deployment' },
        { store: K8sApi.statefulSetStore, kind: 'StatefulSet' },
        { store: K8sApi.daemonSetStore, kind: 'DaemonSet' },
        { store: K8sApi.replicaSetStore, kind: 'ReplicaSet' },
        { store: K8sApi.jobStore, kind: 'Job' },
        { store: K8sApi.cronJobStore, kind: 'CronJob' },
        // Network
        { store: K8sApi.serviceStore, kind: 'Service' },
        { store: K8sApi.ingressStore, kind: 'Ingress' },
        { store: K8sApi.networkPolicyStore, kind: 'NetworkPolicy' },
        // Config & Storage
        { store: K8sApi.configMapStore, kind: 'ConfigMap' },
        { store: K8sApi.secretsStore, kind: 'Secret' },
        { store: K8sApi.persistentVolumeStore, kind: 'PersistentVolume' },
        { store: K8sApi.pvcStore, kind: 'PersistentVolumeClaim' },
        { store: K8sApi.storageClassStore, kind: 'StorageClass' },
        // Access Control
        { store: K8sApi.serviceAccountsStore, kind: 'ServiceAccount' },
        { store: K8sApi.roleStore, kind: 'Role' },
        { store: K8sApi.roleBindingStore, kind: 'RoleBinding' },
        { store: K8sApi.clusterRoleStore, kind: 'ClusterRole' },
        { store: K8sApi.clusterRoleBindingStore, kind: 'ClusterRoleBinding' },
        // Cluster
        { store: K8sApi.namespaceStore, kind: 'Namespace' },
        { store: K8sApi.nodesStore, kind: 'Node' },
        { store: K8sApi.limitRangeStore, kind: 'LimitRange' },
        { store: K8sApi.resourceQuotaStore, kind: 'ResourceQuota' },
      ].filter(({ store }) => store && store.api);

      console.log(`[K-MENU] Using ${stores.length} registered stores`);

      // Also try to add any additional stores we find dynamically
      storeKeys.forEach(key => {
        const store = K8sApi[key];
        if (store && store.api && store.api.kind) {
          const kind = store.api.kind;
          // Only add if not already in the list
          if (!stores.find(s => s.kind === kind)) {
            console.log(`[K-MENU] Found additional store: ${key} (${kind})`);
            stores.push({ store, kind });
          }
        }
      });

      // Fetch resources from each store with retry logic in parallel
      const fetchPromises = stores.map(async ({ store, kind }) => {
        console.log(`[K-MENU] Fetching ${kind}...`);

        // Use retry logic to fetch from store's API
        const items = await this.fetchWithRetry(
          async () => {
            if (!store || !store.api) {
              throw new Error(`Store or API not available for ${kind}`);
            }
            // Call the store's list method through its API
            return await store.api.list();
          },
          kind,
          3, // max retries
          500 // initial delay in ms (500ms, 1s, 2s)
        );

        console.log(`[K-MENU] Fetched ${items?.length || 0} ${kind} items`);

        if (items?.length) {
          return items.map((item: any) => ({
            kind,
            name: item.metadata?.name || item.getName?.() || 'unknown',
            namespace: item.metadata?.namespace || item.getNs?.() || undefined,
            uid: item.metadata?.uid || item.getId?.() || '',
            apiVersion: item.apiVersion || '',
          }));
        }

        return [];
      });

      // Wait for all fetches to complete
      const resourceArrays = await Promise.all(fetchPromises);

      // Flatten the arrays into a single list
      this.allResources = resourceArrays.flat();

      const breakdown = this.allResources.reduce((acc, r) => {
        acc[r.kind] = (acc[r.kind] || 0) + 1;
        return acc;
      }, {} as { [key: string]: number });

      console.log(`[K-MENU] Loaded ${this.allResources.length} total resources`);
      console.log(`[K-MENU] Resource breakdown:`, breakdown);

      const resourceTypes = Object.keys(breakdown).length;
      console.log(`[K-MENU] Found ${resourceTypes} different resource types`);

      if (resourceTypes === 0) {
        console.warn(`[K-MENU] No resources found. Check cluster connection.`);
      }

      // Cache the resources for this cluster
      if (this.currentClusterId) {
        this.resourceCache.set(this.currentClusterId, this.allResources);
        console.log(`[K-MENU] Cached resources for cluster ${this.currentClusterId}`);
      }
    } catch (err) {
      console.error("[K-MENU] Error loading resources:", err);
    } finally {
      // Hide loading indicator
      if (this.loadingIndicator) {
        this.loadingIndicator.style.display = 'none';
      }
      if (this.resultsList) {
        this.resultsList.style.display = 'block';
      }

      // Trigger initial search/render
      this.handleInput();
    }
  }

  // Method to refresh cache for current cluster
  public async refreshResources() {
    if (this.currentClusterId) {
      this.resourceCache.delete(this.currentClusterId);
      await this.loadResources();
      this.renderResults();
      console.log("[K-MENU] Resources refreshed");
    }
  }

  private handleInput() {
    // Update autocomplete hint
    this.updateAutocompleteHint();

    // Clear existing debounce timer
    if (this.searchDebounceTimer !== null) {
      clearTimeout(this.searchDebounceTimer);
    }

    // Debounce the search
    this.searchDebounceTimer = window.setTimeout(() => {
      this.performSearch();
      this.searchDebounceTimer = null;
    }, this.DEBOUNCE_DELAY);
  }

  private updateAutocompleteHint() {
    const query = this.input?.value || "";

    // Check if user is in command mode (starts with /)
    if (query.startsWith('/')) {
      this.isCommandMode = true;

      // Parse command with optional search query: /logs nginx
      const commandMatch = query.match(/^\/(\w+)(?:\s+(.+))?$/);

      if (commandMatch) {
        const commandName = commandMatch[1].toLowerCase();
        const searchQuery = commandMatch[2] || "";

        // Find matching command
        const matchingCommand = this.availableCommands.find(cmd =>
          cmd.id === commandName || cmd.label.toLowerCase().startsWith(commandName)
        );

        if (matchingCommand) {
          this.activeCommand = matchingCommand;

          // Check if the search query contains a filter pattern (kind:, namespace:, node:)
          const filterMatch = searchQuery.match(/^(kind|namespace|node):(.*)$/i);

          if (filterMatch) {
            const filterType = filterMatch[1].toLowerCase() as 'kind' | 'namespace' | 'node';
            const filterValue = filterMatch[2].trim();

            // Store filter type for keyboard navigation
            this.autocompleteFilterType = filterType;

            if (filterValue === "") {
              // Show suggestions for this filter type
              let suggestions: string[] = [];

              switch (filterType) {
                case 'kind':
                  // Only show kinds that match the command's resource types
                  if (matchingCommand.resourceTypes) {
                    suggestions = matchingCommand.resourceTypes.sort();
                  } else {
                    suggestions = Array.from(new Set(this.allResources.map(r => r.kind)))
                      .sort()
                      .slice(0, 10);
                  }
                  break;
                case 'namespace':
                  suggestions = Array.from(new Set(
                    this.allResources.filter(r => r.namespace).map(r => r.namespace!)
                  ))
                    .sort()
                    .slice(0, 10);
                  break;
                case 'node':
                  suggestions = Array.from(new Set(
                    this.allResources.filter(r => r.kind === 'Node').map(r => r.name)
                  ))
                    .sort()
                    .slice(0, 10);
                  break;
              }

              this.autocompleteSuggestions = suggestions;
              if (this.autocompleteSelectedIndex === -1 && suggestions.length > 0) {
                this.autocompleteSelectedIndex = 0;
              }
              this.renderAutocompleteHint();
              return;
            } else {
              // Show matching suggestions as user types
              let allValues: string[] = [];

              switch (filterType) {
                case 'kind':
                  if (matchingCommand.resourceTypes) {
                    allValues = matchingCommand.resourceTypes;
                  } else {
                    allValues = Array.from(new Set(this.allResources.map(r => r.kind)));
                  }
                  break;
                case 'namespace':
                  allValues = Array.from(new Set(
                    this.allResources.filter(r => r.namespace).map(r => r.namespace!)
                  ));
                  break;
                case 'node':
                  allValues = Array.from(new Set(
                    this.allResources.filter(r => r.kind === 'Node').map(r => r.name)
                  ));
                  break;
              }

              const suggestions = allValues
                .filter(v => v.toLowerCase().includes(filterValue.toLowerCase()))
                .sort()
                .slice(0, 10);

              this.autocompleteSuggestions = suggestions;
              if (this.autocompleteSelectedIndex === -1 && suggestions.length > 0) {
                this.autocompleteSelectedIndex = 0;
              }
              this.renderAutocompleteHint();
              return;
            }
          }

          // No filter pattern, just regular search query
          if (searchQuery) {
            // If command doesn't require a resource, just show filtered commands
            if (!matchingCommand.requiresResource) {
              this.activeCommand = null;
              this.commandSearchQuery = "";
              this.autocompleteFilterType = null;
              this.autocompleteSuggestions = [];
              this.autocompleteSelectedIndex = -1;
              this.renderCommandList();
              return;
            }

            // Command requires a resource, show resource list
            this.commandSearchQuery = searchQuery;
            this.autocompleteFilterType = null;
            this.autocompleteSuggestions = [];
            this.autocompleteSelectedIndex = -1;
            this.renderCommandResourceList();
            return;
          }
        }
      }

      // Just showing command list
      this.activeCommand = null;
      this.commandSearchQuery = "";
      this.autocompleteFilterType = null;
      this.autocompleteSuggestions = [];
      this.autocompleteSelectedIndex = -1;
      this.renderCommandList();
      return;
    } else {
      this.isCommandMode = false;
      this.activeCommand = null;
      this.commandSearchQuery = "";
    }

    // Check if user is typing a filter (kind:, namespace:, node:)
    const filterMatch = query.match(/^(kind|namespace|node):(.*)$/i);

    if (filterMatch) {
      const filterType = filterMatch[1].toLowerCase() as 'kind' | 'namespace' | 'node';
      const filterValue = filterMatch[2].trim();

      // Store filter type for keyboard navigation
      this.autocompleteFilterType = filterType;

      if (filterValue === "") {
        // Show suggestions for this filter type
        let suggestions: string[] = [];

        switch (filterType) {
          case 'kind':
            suggestions = Array.from(new Set(this.allResources.map(r => r.kind)))
              .sort()
              .slice(0, 10);
            break;
          case 'namespace':
            suggestions = Array.from(new Set(
              this.allResources.filter(r => r.namespace).map(r => r.namespace!)
            ))
              .sort()
              .slice(0, 10);
            break;
          case 'node':
            suggestions = Array.from(new Set(
              this.allResources.filter(r => r.kind === 'Node').map(r => r.name)
            ))
              .sort()
              .slice(0, 10);
            break;
        }

        this.autocompleteSuggestions = suggestions;
        if (this.autocompleteSelectedIndex === -1 && suggestions.length > 0) {
          this.autocompleteSelectedIndex = 0;
        }
        this.renderAutocompleteHint();
      } else {
        // Show matching suggestions as user types
        let suggestions: string[] = [];

        switch (filterType) {
          case 'kind':
            suggestions = Array.from(new Set(this.allResources.map(r => r.kind)))
              .filter(k => k.toLowerCase().includes(filterValue.toLowerCase()))
              .sort()
              .slice(0, 8);
            break;
          case 'namespace':
            suggestions = Array.from(new Set(
              this.allResources.filter(r => r.namespace).map(r => r.namespace!)
            ))
              .filter(ns => ns.toLowerCase().includes(filterValue.toLowerCase()))
              .sort()
              .slice(0, 8);
            break;
          case 'node':
            suggestions = Array.from(new Set(
              this.allResources.filter(r => r.kind === 'Node').map(r => r.name)
            ))
              .filter(n => n.toLowerCase().includes(filterValue.toLowerCase()))
              .sort()
              .slice(0, 8);
            break;
        }

        this.autocompleteSuggestions = suggestions;
        if (this.autocompleteSelectedIndex === -1 && suggestions.length > 0) {
          this.autocompleteSelectedIndex = 0;
        }
        this.renderAutocompleteHint();
      }
    } else {
      // Reset autocomplete state
      this.autocompleteSuggestions = [];
      this.autocompleteSelectedIndex = -1;
      this.autocompleteFilterType = null;

      const hintElement = document.getElementById("k-menu-autocomplete-hint");
      if (hintElement) {
        hintElement.textContent = "";
      }
    }
  }

  private renderAutocompleteHint() {
    const hintElement = document.getElementById("k-menu-autocomplete-hint");
    if (!hintElement) return;

    if (this.autocompleteSuggestions.length === 0) {
      hintElement.textContent = "";
      return;
    }

    // Render suggestions with selected one highlighted
    hintElement.innerHTML = `${this.autocompleteSuggestions.map((s, index) => {
      const isSelected = index === this.autocompleteSelectedIndex;
      return `<span style="
        color: ${isSelected ? '#fff' : '#888'};
        background: ${isSelected ? '#3a3a3a' : 'transparent'};
        cursor: pointer;
        margin-right: 8px;
        padding: 2px 6px;
        border-radius: 3px;
        font-weight: ${isSelected ? 'bold' : 'normal'};
      ">${s}</span>`;
    }).join("")}`;

    // Add click handlers to suggestions
    hintElement.querySelectorAll("span").forEach((span, index) => {
      span.addEventListener("click", () => {
        if (this.autocompleteFilterType) {
          this.addFilter(this.autocompleteFilterType, this.autocompleteSuggestions[index]);
        }
      });
    });
  }

  private addFilter(type: 'kind' | 'namespace' | 'node', value: string) {
    // Check if filter already exists
    const exists = this.activeFilters.some(f => f.type === type && f.value === value);
    if (exists) return;

    // Add the filter
    this.activeFilters.push({ type, value });

    // Clear input and autocomplete state
    if (this.input) {
      this.input.value = "";
    }
    this.autocompleteSuggestions = [];
    this.autocompleteSelectedIndex = -1;
    this.autocompleteFilterType = null;

    // Update UI
    this.renderFilterTags();
    this.performSearch();
    this.updateAutocompleteHint();

    // Focus input
    this.input?.focus();
  }

  private removeFilter(type: 'kind' | 'namespace' | 'node', value: string) {
    this.activeFilters = this.activeFilters.filter(f => !(f.type === type && f.value === value));
    this.renderFilterTags();
    this.performSearch();
  }

  private renderFilterTags() {
    if (!this.filterTagsContainer) return;

    // Clear existing tags
    this.filterTagsContainer.innerHTML = "";

    // Hide container if no filters
    if (this.activeFilters.length === 0) {
      this.filterTagsContainer.style.minHeight = "0";
      this.filterTagsContainer.style.marginBottom = "0";
      return;
    }

    this.filterTagsContainer.style.minHeight = "";
    this.filterTagsContainer.style.marginBottom = "8px";

    // Create tags for each filter
    this.activeFilters.forEach(filter => {
      const tag = document.createElement("div");
      tag.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: #3a3a3a;
        color: #e1e1e1;
        border: 1px solid #555;
        padding: 4px 10px;
        border-radius: 4px;
        font-size: 12px;
        cursor: default;
        transition: all 0.2s;
      `;

      const label = document.createElement("span");
      label.textContent = `${filter.type}:${filter.value}`;

      const removeBtn = document.createElement("span");
      removeBtn.textContent = "×";
      removeBtn.style.cssText = `
        cursor: pointer;
        font-size: 18px;
        font-weight: bold;
        opacity: 0.6;
        line-height: 1;
        margin-left: 2px;
        transition: opacity 0.2s;
      `;
      removeBtn.addEventListener("mouseenter", () => {
        removeBtn.style.opacity = "1";
        tag.style.background = "#444";
        tag.style.borderColor = "#666";
      });
      removeBtn.addEventListener("mouseleave", () => {
        removeBtn.style.opacity = "0.6";
        tag.style.background = "#3a3a3a";
        tag.style.borderColor = "#555";
      });
      removeBtn.addEventListener("click", () => {
        this.removeFilter(filter.type, filter.value);
      });

      tag.appendChild(label);
      tag.appendChild(removeBtn);
      this.filterTagsContainer?.appendChild(tag);
    });
  }

  private performSearch() {
    // Don't run search in command mode
    if (this.isCommandMode) {
      return;
    }

    const query = this.input?.value || "";

    // Start with all resources
    let filteredResources = this.allResources;

    // Apply active filters
    this.activeFilters.forEach(filter => {
      switch (filter.type) {
        case 'kind':
          filteredResources = filteredResources.filter(r =>
            r.kind.toLowerCase() === filter.value.toLowerCase()
          );
          break;
        case 'namespace':
          filteredResources = filteredResources.filter(r =>
            r.namespace?.toLowerCase() === filter.value.toLowerCase()
          );
          break;
        case 'node':
          // For node filter, we'd need to know which resources are on which node
          // For now, just match the node name if the resource is a Pod
          // This would require additional data from the API
          filteredResources = filteredResources.filter(r =>
            r.kind === 'Node' && r.name.toLowerCase() === filter.value.toLowerCase()
          );
          break;
      }
    });

    // If no query, just show filtered results
    if (!query) {
      this.results = filteredResources.slice(0, 50).map(resource => ({
        resource,
        displayText: this.getDisplayText(resource),
        matchScore: 1,
      }));
    } else {
      // Support space-separated search terms
      const searchTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 0);

      this.results = filteredResources
        .map(resource => {
          const displayText = this.getDisplayText(resource);
          const displayTextLower = displayText.toLowerCase();
          const nameLower = resource.name.toLowerCase();
          const kindLower = resource.kind.toLowerCase();
          const namespaceLower = resource.namespace?.toLowerCase() || '';

          // Check if all search terms match
          let totalScore = 0;

          for (const term of searchTerms) {
            // Try exact substring match first (higher score)
            if (displayTextLower.includes(term)) {
              totalScore += 10;
            } else if (nameLower.includes(term)) {
              totalScore += 8;
            } else if (kindLower.includes(term)) {
              totalScore += 6;
            } else if (namespaceLower.includes(term)) {
              totalScore += 5;
            } else {
              // Try fuzzy match as fallback
              const fuzzyScore = this.fuzzyMatch(displayTextLower, term);
              if (fuzzyScore > 0) {
                totalScore += fuzzyScore * 2;
              } else {
                // If any term doesn't match, return 0
                return {
                  resource,
                  displayText,
                  matchScore: 0,
                };
              }
            }
          }

          return {
            resource,
            displayText,
            matchScore: totalScore,
          };
        })
        .filter(result => result.matchScore > 0)
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, 50);
    }

    this.selectedIndex = 0;
    this.renderResults();
  }

  private fuzzyMatch(text: string, query: string): number {
    let score = 0;
    let queryIndex = 0;

    for (let i = 0; i < text.length && queryIndex < query.length; i++) {
      if (text[i] === query[queryIndex]) {
        score += 1;
        queryIndex++;
      }
    }

    if (queryIndex === query.length) {
      // All query characters found
      return score / query.length;
    }

    return 0;
  }

  private getDisplayText(resource: KubeResource): string {
    if (resource.namespace) {
      return `${resource.kind}/${resource.namespace}/${resource.name}`;
    }
    return `${resource.kind}/${resource.name}`;
  }

  private renderResults() {
    if (!this.resultsList) return;

    this.resultsList.innerHTML = "";

    if (this.results.length === 0) {
      const empty = document.createElement("div");
      empty.className = "k-menu-empty";
      empty.textContent = this.allResources.length === 0
        ? "Loading resources..."
        : "No resources found";
      this.resultsList.appendChild(empty);
      return;
    }

    this.results.forEach((result, index) => {
      const item = document.createElement("div");
      item.className = "k-menu-result-item";
      if (index === this.selectedIndex) {
        item.classList.add("selected");
      }

      const title = document.createElement("div");
      title.className = "k-menu-result-title";
      title.textContent = result.resource.name;

      const meta = document.createElement("div");
      meta.className = "k-menu-result-meta";

      const kindBadge = document.createElement("span");
      kindBadge.className = "k-menu-result-kind";
      kindBadge.textContent = result.resource.kind;

      meta.appendChild(kindBadge);
      if (result.resource.namespace) {
        meta.appendChild(document.createTextNode(result.resource.namespace));
      }

      item.appendChild(title);
      item.appendChild(meta);

      item.addEventListener("click", () => {
        this.selectResult(index);
      });

      this.resultsList!.appendChild(item);
    });
  }

  private handleKeyDown(event: KeyboardEvent) {
    // Command mode navigation
    if (this.isCommandMode) {
      // Check if we're in autocomplete mode (showing filter suggestions)
      if (this.autocompleteFilterType && this.autocompleteSuggestions.length > 0) {
        switch (event.key) {
          case "Tab":
          case "ArrowDown":
            event.preventDefault();
            this.autocompleteSelectedIndex = Math.min(
              this.autocompleteSelectedIndex + 1,
              this.autocompleteSuggestions.length - 1
            );
            this.renderAutocompleteHint();
            return;

          case "ArrowUp":
            event.preventDefault();
            this.autocompleteSelectedIndex = Math.max(this.autocompleteSelectedIndex - 1, 0);
            this.renderAutocompleteHint();
            return;

          case "Enter":
            event.preventDefault();
            // Add the selected suggestion as a filter
            if (this.autocompleteSelectedIndex >= 0 &&
                this.autocompleteFilterType &&
                this.autocompleteSuggestions[this.autocompleteSelectedIndex]) {
              this.addFilter(
                this.autocompleteFilterType,
                this.autocompleteSuggestions[this.autocompleteSelectedIndex]
              );
              // Clear the input after the command and show resources
              const commandMatch = this.input?.value.match(/^\/(\w+)/);
              if (commandMatch && this.input) {
                this.input.value = `/${commandMatch[1]} `;
                this.commandSearchQuery = "";
                this.autocompleteFilterType = null;
                this.autocompleteSuggestions = [];
                this.autocompleteSelectedIndex = -1;
                this.handleInput();
              }
            }
            return;

          case "Escape":
            event.preventDefault();
            if (this.input) {
              this.input.value = "";
            }
            this.isCommandMode = false;
            this.activeCommand = null;
            this.commandSearchQuery = "";
            this.autocompleteFilterType = null;
            this.autocompleteSuggestions = [];
            this.autocompleteSelectedIndex = -1;
            this.handleInput();
            return;
        }
      }

      // If we have an active command with search query, navigate through resources
      if (this.activeCommand && this.commandSearchQuery) {
        switch (event.key) {
          case "Escape":
            event.preventDefault();
            if (this.input) {
              this.input.value = "";
            }
            this.isCommandMode = false;
            this.activeCommand = null;
            this.commandSearchQuery = "";
            this.handleInput();
            return;

          case "ArrowDown":
            event.preventDefault();
            this.selectedIndex = Math.min(this.selectedIndex + 1, this.results.length - 1);
            this.renderCommandResourceList();
            this.scrollToSelected();
            return;

          case "ArrowUp":
            event.preventDefault();
            this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
            this.renderCommandResourceList();
            this.scrollToSelected();
            return;

          case "Enter":
            event.preventDefault();
            if (this.results[this.selectedIndex]) {
              this.executeCommandOnResource(this.results[this.selectedIndex].resource);
            }
            return;
        }
      } else {
        // Navigating through command list
        switch (event.key) {
          case "Tab":
            event.preventDefault();
            // Autocomplete the selected command
            this.autocompleteCommand();
            return;

          case "Escape":
            event.preventDefault();
            if (this.input) {
              this.input.value = "";
            }
            this.isCommandMode = false;
            this.handleInput();
            return;

          case "ArrowDown":
            event.preventDefault();
            this.selectedCommandIndex = Math.min(
              this.selectedCommandIndex + 1,
              this.availableCommands.length - 1
            );
            this.renderCommandList();
            return;

          case "ArrowUp":
            event.preventDefault();
            this.selectedCommandIndex = Math.max(this.selectedCommandIndex - 1, 0);
            this.renderCommandList();
            return;

          case "Enter":
            event.preventDefault();
            this.executeCommand(this.selectedCommandIndex);
            return;
        }
      }
    }

    // Check if we're in autocomplete mode (for filter tags like kind:, namespace:)
    if (this.autocompleteSuggestions.length > 0) {
      switch (event.key) {
        case "Tab":
          event.preventDefault();
          // Cycle through suggestions
          this.autocompleteSelectedIndex =
            (this.autocompleteSelectedIndex + 1) % this.autocompleteSuggestions.length;
          this.renderAutocompleteHint();
          return;

        case "Enter":
          event.preventDefault();
          // Add the selected suggestion as a filter
          if (this.autocompleteSelectedIndex >= 0 &&
              this.autocompleteFilterType &&
              this.autocompleteSuggestions[this.autocompleteSelectedIndex]) {
            this.addFilter(
              this.autocompleteFilterType,
              this.autocompleteSuggestions[this.autocompleteSelectedIndex]
            );
          }
          return;

        case "Escape":
          event.preventDefault();
          this.close();
          return;
      }
    }

    // Normal navigation mode
    switch (event.key) {
      case "Tab":
        event.preventDefault();
        // Autocomplete filter names (kind:, namespace:, node:)
        this.autocompleteFilterName();
        break;

      case "Escape":
        event.preventDefault();
        this.close();
        break;

      case "ArrowDown":
        event.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.results.length - 1);
        this.renderResults();
        this.scrollToSelected();
        break;

      case "ArrowUp":
        event.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.renderResults();
        this.scrollToSelected();
        break;

      case "Enter":
        event.preventDefault();
        this.selectResult(this.selectedIndex);
        break;
    }
  }

  private renderCommandList() {
    if (!this.resultsList) return;

    this.resultsList.innerHTML = "";

    const query = this.input?.value.substring(1).toLowerCase() || "";

    // Filter commands based on query - support space-separated search terms
    const searchTerms = query.split(/\s+/).filter(term => term.length > 0);

    const filteredCommands = this.availableCommands.filter(cmd => {
      const label = cmd.label.toLowerCase();
      const description = cmd.description.toLowerCase();

      // All search terms must match either label or description
      return searchTerms.every(term =>
        label.includes(term) || description.includes(term)
      );
    });

    if (filteredCommands.length === 0) {
      const empty = document.createElement("div");
      empty.className = "k-menu-empty";
      empty.textContent = "No commands found";
      this.resultsList.appendChild(empty);
      return;
    }

    filteredCommands.forEach((cmd, index) => {
      const item = document.createElement("div");
      item.className = "k-menu-result-item";
      if (index === this.selectedCommandIndex) {
        item.classList.add("selected");
      }

      const title = document.createElement("div");
      title.className = "k-menu-result-title";
      title.textContent = `/${cmd.label}`;

      const meta = document.createElement("div");
      meta.className = "k-menu-result-meta";
      meta.textContent = cmd.description;

      if (cmd.requiresResource) {
        const badge = document.createElement("span");
        badge.className = "k-menu-result-kind";
        badge.textContent = cmd.resourceTypes?.join(', ') || 'Requires selection';
        badge.style.marginLeft = "8px";
        meta.appendChild(badge);
      }

      item.appendChild(title);
      item.appendChild(meta);

      item.addEventListener("click", () => {
        this.executeCommand(index);
      });

      this.resultsList!.appendChild(item);
    });
  }

  private renderCommandResourceList() {
    if (!this.resultsList || !this.activeCommand) return;

    this.resultsList.innerHTML = "";

    // Filter resources based on command requirements and search query
    let filteredResources = this.allResources;

    // Apply active filters first (kind, namespace, node, etc.)
    this.activeFilters.forEach(filter => {
      switch (filter.type) {
        case 'kind':
          filteredResources = filteredResources.filter(r =>
            r.kind.toLowerCase() === filter.value.toLowerCase()
          );
          break;
        case 'namespace':
          filteredResources = filteredResources.filter(r =>
            r.namespace?.toLowerCase() === filter.value.toLowerCase()
          );
          break;
        case 'node':
          filteredResources = filteredResources.filter(r =>
            r.kind === 'Node' && r.name.toLowerCase() === filter.value.toLowerCase()
          );
          break;
      }
    });

    // Filter by resource type if command requires specific types
    if (this.activeCommand.resourceTypes) {
      filteredResources = filteredResources.filter(r =>
        this.activeCommand!.resourceTypes!.includes(r.kind)
      );
    }

    // Filter by search query
    if (this.commandSearchQuery) {
      const searchQuery = this.commandSearchQuery.toLowerCase();
      filteredResources = filteredResources.filter(r =>
        r.name.toLowerCase().includes(searchQuery) ||
        r.namespace?.toLowerCase().includes(searchQuery) ||
        r.kind.toLowerCase().includes(searchQuery)
      );
    }

    // Limit results
    filteredResources = filteredResources.slice(0, 50);

    if (filteredResources.length === 0) {
      const empty = document.createElement("div");
      empty.className = "k-menu-empty";
      empty.textContent = `No ${this.activeCommand.resourceTypes?.join(', ') || 'resources'} found matching "${this.commandSearchQuery}"`;
      this.resultsList.appendChild(empty);
      return;
    }

    // Show command header
    const header = document.createElement("div");
    header.style.cssText = `
      padding: 8px 16px;
      font-size: 12px;
      color: #888;
      border-bottom: 1px solid #333;
      background: #1a1a1a;
    `;
    header.textContent = `/${this.activeCommand.label.toLowerCase()} - Select a ${this.activeCommand.resourceTypes?.join(' or ') || 'resource'}`;
    this.resultsList.appendChild(header);

    filteredResources.forEach((resource, index) => {
      const item = document.createElement("div");
      item.className = "k-menu-result-item";
      if (index === this.selectedIndex) {
        item.classList.add("selected");
      }

      const title = document.createElement("div");
      title.className = "k-menu-result-title";
      title.textContent = resource.name;

      const meta = document.createElement("div");
      meta.className = "k-menu-result-meta";

      const kindBadge = document.createElement("span");
      kindBadge.className = "k-menu-result-kind";
      kindBadge.textContent = resource.kind;

      meta.appendChild(kindBadge);

      if (resource.namespace) {
        const nsBadge = document.createElement("span");
        nsBadge.className = "k-menu-result-namespace";
        nsBadge.textContent = resource.namespace;
        meta.appendChild(nsBadge);
      }

      item.appendChild(title);
      item.appendChild(meta);

      item.addEventListener("click", () => {
        this.executeCommandOnResource(resource);
      });

      this.resultsList!.appendChild(item);
    });

    // Update results for keyboard navigation
    this.results = filteredResources.map(resource => ({
      resource,
      displayText: this.getDisplayText(resource),
      matchScore: 1,
    }));
    this.selectedIndex = 0;
  }

  private executeCommandOnResource(resource: KubeResource) {
    if (!this.activeCommand) return;

    console.log("[K-MENU] Executing command on resource:", this.activeCommand.id, resource);

    // Check if resource type matches
    if (this.activeCommand.resourceTypes && !this.activeCommand.resourceTypes.includes(resource.kind)) {
      alert(`This command only works with ${this.activeCommand.resourceTypes.join(', ')} resources`);
      return;
    }

    this.activeCommand.execute(resource);
    this.close();
  }

  private autocompleteFilterName() {
    if (!this.input) return;

    const query = this.input.value.toLowerCase();

    // Only autocomplete if we're not already in a filter (no colon yet)
    if (query.includes(':')) return;

    // Available filter names
    const filterNames = ['kind:', 'namespace:', 'node:'];

    // Find matching filter names
    const matches = filterNames.filter(name =>
      name.toLowerCase().startsWith(query)
    );

    if (matches.length > 0) {
      // Autocomplete with the first match
      this.input.value = matches[0];
      console.log("[K-MENU] Autocompleted filter name to:", matches[0]);
      this.handleInput();
    }
  }

  private autocompleteCommand() {
    const query = this.input?.value.substring(1).toLowerCase() || "";

    // Get filtered commands with space-separated search
    const searchTerms = query.split(/\s+/).filter(term => term.length > 0);

    const filteredCommands = this.availableCommands.filter(cmd => {
      const label = cmd.label.toLowerCase();
      const description = cmd.description.toLowerCase();

      return searchTerms.every(term =>
        label.includes(term) || description.includes(term)
      );
    });

    // Get the currently selected command
    const command = filteredCommands[this.selectedCommandIndex];

    if (command && this.input) {
      // Autocomplete the input with the selected command
      this.input.value = `/${command.label}`;
      console.log("[K-MENU] Autocompleted to:", command.label);

      // Update the command list to reflect the new input
      this.handleInput();
    }
  }

  private executeCommand(index: number) {
    const query = this.input?.value.substring(1).toLowerCase() || "";
    console.log("[K-MENU] executeCommand called with index:", index, "query:", query);
    console.log("[K-MENU] Total available commands:", this.availableCommands.length);

    // Filter with space-separated search
    const searchTerms = query.split(/\s+/).filter(term => term.length > 0);

    const filteredCommands = this.availableCommands.filter(cmd => {
      const label = cmd.label.toLowerCase();
      const description = cmd.description.toLowerCase();

      return searchTerms.every(term =>
        label.includes(term) || description.includes(term)
      );
    });

    console.log("[K-MENU] Filtered commands:", filteredCommands.length, filteredCommands.map(c => c.label));

    const command = filteredCommands[index];
    if (!command) {
      console.warn("[K-MENU] No command found at index", index);
      return;
    }

    console.log("[K-MENU] Executing command:", command.id, command.label);

    // If command requires a resource, check if we have one selected
    if (command.requiresResource) {
      const selectedResult = this.results[this.selectedIndex];
      if (!selectedResult) {
        alert('Please select a resource first (use up/down arrows and Enter to select)');
        if (this.input) {
          this.input.value = "";
        }
        this.isCommandMode = false;
        this.handleInput();
        return;
      }

      // Check if resource type matches
      if (command.resourceTypes && !command.resourceTypes.includes(selectedResult.resource.kind)) {
        alert(`This command only works with ${command.resourceTypes.join(', ')} resources`);
        return;
      }

      command.execute(selectedResult.resource);
    } else {
      command.execute();
    }

    this.close();
  }

  private scrollToSelected() {
    const selected = this.resultsList?.querySelector(".selected");
    if (selected) {
      selected.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  private selectResult(index: number) {
    const result = this.results[index];
    if (!result) return;

    console.log("[K-MENU] Selected resource:", result.resource);
    this.navigateToResource(result.resource);
    this.close();
  }

  private navigateToResource(resource: KubeResource) {
    console.log("[K-MENU] Navigating to resource:", resource);

    try {
      // Use stored cluster ID
      if (!this.currentClusterId) {
        console.error("[K-MENU] Not in cluster context, cannot navigate to resource");
        return;
      }

      // Check if we have an active iframe
      if (!this.activeIframeSource) {
        console.error("[K-MENU] Cannot navigate: no active iframe");
        return;
      }

      // Send navigation request to cluster iframe
      console.log("[K-MENU] Sending navigation request to iframe");
      this.activeIframeSource.postMessage({
        type: 'k-menu-navigate-to-resource',
        clusterId: this.currentClusterId,
        resource: resource
      }, '*');
    } catch (err) {
      console.error("[K-MENU] Error navigating to resource:", err);
    }
  }


  private async deleteResource(resource: KubeResource): Promise<void> {
    console.log('[K-MENU] Requesting resource deletion from cluster iframe:', resource);

    if (!this.activeIframeSource) {
      throw new Error('No active cluster iframe');
    }

    await this.requestDeleteResourceFromIframe(this.activeIframeSource, resource as K8sResource);
    console.log('[K-MENU] Resource deleted successfully');
  }

  private async openPodLogs(resource: KubeResource): Promise<void> {
    console.log('[K-MENU] Requesting logs from cluster iframe:', resource);

    if (!this.activeIframeSource) {
      throw new Error('No active cluster iframe');
    }

    await this.requestLogsFromIframe(this.activeIframeSource, resource as K8sResource);
    console.log('[K-MENU] Logs opened successfully');
  }

  private requestDeleteResourceFromIframe(iframe: Window, resource: K8sResource): Promise<void> {
    return new Promise((resolve, reject) => {
      const requestId = Math.random().toString(36).substring(7);
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Delete request timeout'));
      }, 10000); // 10 second timeout

      const messageHandler = (event: MessageEvent) => {
        if (event.data?.type === 'k-menu-delete-response' && event.data?.requestId === requestId) {
          cleanup();

          if (event.data.error) {
            reject(new Error(event.data.error));
          } else {
            resolve();
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        window.removeEventListener('message', messageHandler);
      };

      window.addEventListener('message', messageHandler);

      // Send delete request to iframe
      console.log('[K-MENU] Sending delete request to iframe with ID:', requestId);
      iframe.postMessage({
        type: 'k-menu-delete-resource',
        requestId: requestId,
        resource: resource
      }, '*');
    });
  }

  private requestLogsFromIframe(iframe: Window, resource: K8sResource): Promise<void> {
    return new Promise((resolve, reject) => {
      const requestId = Math.random().toString(36).substring(7);
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Logs request timeout'));
      }, 10000); // 10 second timeout

      const messageHandler = (event: MessageEvent) => {
        if (event.data?.type === 'k-menu-logs-response' && event.data?.requestId === requestId) {
          cleanup();

          if (event.data.error) {
            reject(new Error(event.data.error));
          } else {
            resolve();
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        window.removeEventListener('message', messageHandler);
      };

      window.addEventListener('message', messageHandler);

      // Send logs request to iframe
      console.log('[K-MENU] Sending logs request to iframe with ID:', requestId);
      iframe.postMessage({
        type: 'k-menu-open-logs',
        requestId: requestId,
        resource: resource
      }, '*');
    });
  }

  public destroy() {
    // Clear debounce timer
    if (this.searchDebounceTimer !== null) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }

    if (this.container) {
      this.container.remove();
    }
  }
}
