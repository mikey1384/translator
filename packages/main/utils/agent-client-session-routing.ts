export interface AgentClientSessionRouteTarget {
  readonly id: number;
  isDestroyed(): boolean;
}

export interface AgentClientSessionBinding<
  T extends AgentClientSessionRouteTarget,
> {
  readonly clientSessionId: string;
  readonly routeToken: string;
  readonly target: T;
}

/**
 * Pins one packaged MCP helper process to one renderer workspace across the
 * helper's intentionally short-lived app-socket connections. Evicted or stale
 * leases fail closed instead of silently following the newly active tab.
 */
export class AgentClientSessionRouteRegistry<
  T extends AgentClientSessionRouteTarget,
> {
  private readonly routesBySession = new Map<
    string,
    AgentClientSessionBinding<T>
  >();
  private readonly routesByToken = new Map<
    string,
    AgentClientSessionBinding<T>
  >();

  constructor(
    private readonly createRouteToken: () => string,
    private readonly maxRoutes = 1024
  ) {
    if (!Number.isSafeInteger(maxRoutes) || maxRoutes < 1) {
      throw new RangeError('maxRoutes must be a positive integer.');
    }
  }

  private touch(binding: AgentClientSessionBinding<T>): void {
    this.routesBySession.delete(binding.clientSessionId);
    this.routesBySession.set(binding.clientSessionId, binding);
    this.routesByToken.delete(binding.routeToken);
    this.routesByToken.set(binding.routeToken, binding);
  }

  private insert(binding: AgentClientSessionBinding<T>): void {
    this.routesBySession.set(binding.clientSessionId, binding);
    this.routesByToken.set(binding.routeToken, binding);

    while (this.routesBySession.size > this.maxRoutes) {
      const oldest = this.routesBySession.values().next().value as
        | AgentClientSessionBinding<T>
        | undefined;
      if (!oldest) break;
      this.routesBySession.delete(oldest.clientSessionId);
      this.routesByToken.delete(oldest.routeToken);
    }
  }

  bind(
    clientSessionId: string,
    requestedRouteToken: string | null,
    targetForNewSession: T | null
  ): AgentClientSessionBinding<T> {
    const existing = this.routesBySession.get(clientSessionId) ?? null;

    if (requestedRouteToken) {
      const requested = this.routesByToken.get(requestedRouteToken) ?? null;
      if (
        !requested ||
        requested !== existing ||
        requested.clientSessionId !== clientSessionId
      ) {
        throw new Error(
          'Packaged agent workspace lease is stale or invalid. Restart the MCP helper.'
        );
      }
      this.touch(requested);
      return requested;
    }

    // A lost handshake response may make the exact same helper reconnect before
    // it learned its lease. Reuse that helper's binding instead of moving it.
    if (existing) {
      this.touch(existing);
      return existing;
    }

    if (!targetForNewSession || targetForNewSession.isDestroyed()) {
      throw new Error('No Translator tab is available for the agent session.');
    }

    const routeToken = this.createRouteToken();
    if (!routeToken || this.routesByToken.has(routeToken)) {
      throw new Error('Could not allocate a unique agent workspace lease.');
    }
    const binding = {
      clientSessionId,
      routeToken,
      target: targetForNewSession,
    };
    this.insert(binding);
    return binding;
  }

  resolve(routeToken: string): T {
    const binding = this.routesByToken.get(routeToken);
    if (!binding) {
      throw new Error(
        'Packaged agent workspace lease expired. Restart the MCP helper.'
      );
    }
    if (binding.target.isDestroyed()) {
      throw new Error(
        'The Translator tab owned by this agent session was closed. Restart the MCP helper to choose another tab.'
      );
    }
    this.touch(binding);
    return binding.target;
  }

  clear(): void {
    this.routesBySession.clear();
    this.routesByToken.clear();
  }

  size(): number {
    return this.routesBySession.size;
  }
}
