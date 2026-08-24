export interface AgentHistoryRouteTarget {
  readonly id: number;
  isDestroyed(): boolean;
}

export type AgentHistoryRouteSnapshot<T extends AgentHistoryRouteTarget> = {
  target: T;
  active: boolean;
  token: string | null;
};

/**
 * Keeps a history job bound to the renderer that owns its in-memory state.
 * New jobs prefer the least-loaded live tab while exact follow-up calls keep
 * their original target even if the user selects a different tab.
 */
export class AgentHistoryRouteRegistry<T extends AgentHistoryRouteTarget> {
  private readonly routes = new Map<string, AgentHistoryRouteSnapshot<T>>();

  constructor(private readonly maxInactiveRoutes = 1024) {
    if (!Number.isSafeInteger(maxInactiveRoutes) || maxInactiveRoutes < 0) {
      throw new RangeError('maxInactiveRoutes must be a non-negative integer.');
    }
  }

  private pruneDestroyed(): void {
    for (const [historyId, route] of this.routes) {
      if (route.target.isDestroyed()) this.routes.delete(historyId);
    }
  }

  private pruneInactive(): void {
    let inactiveCount = 0;
    for (const route of this.routes.values()) {
      if (!route.active) inactiveCount += 1;
    }
    if (inactiveCount <= this.maxInactiveRoutes) return;

    for (const [historyId, route] of this.routes) {
      if (route.active) continue;
      this.routes.delete(historyId);
      inactiveCount -= 1;
      if (inactiveCount <= this.maxInactiveRoutes) break;
    }
  }

  get(historyId: string): T | null {
    this.pruneDestroyed();
    return this.routes.get(historyId)?.target ?? null;
  }

  getSnapshot(historyId: string): AgentHistoryRouteSnapshot<T> | null {
    this.pruneDestroyed();
    const route = this.routes.get(historyId);
    return route ? { ...route } : null;
  }

  isActive(historyId: string, target: T): boolean {
    this.pruneDestroyed();
    const route = this.routes.get(historyId);
    return route?.target === target && route.active;
  }

  chooseLeastLoaded(
    targets: readonly T[],
    preferredTarget: T | null
  ): T | null {
    this.pruneDestroyed();
    const liveTargets = targets.filter(target => !target.isDestroyed());
    if (!liveTargets.length) return null;

    const activeCounts = new Map<number, number>();
    for (const route of this.routes.values()) {
      if (!route.active || route.target.isDestroyed()) continue;
      activeCounts.set(
        route.target.id,
        (activeCounts.get(route.target.id) ?? 0) + 1
      );
    }
    const minimum = Math.min(
      ...liveTargets.map(target => activeCounts.get(target.id) ?? 0)
    );
    if (
      preferredTarget &&
      liveTargets.some(target => target.id === preferredTarget.id) &&
      (activeCounts.get(preferredTarget.id) ?? 0) === minimum
    ) {
      return preferredTarget;
    }
    return (
      liveTargets.find(
        target => (activeCounts.get(target.id) ?? 0) === minimum
      ) ?? null
    );
  }

  setActive(
    historyId: string,
    target: T,
    token: string | null = null
  ): AgentHistoryRouteSnapshot<T> | null {
    const previous = this.routes.get(historyId) ?? null;
    this.routes.delete(historyId);
    this.routes.set(historyId, { target, active: true, token });
    return previous ? { ...previous } : null;
  }

  /** Bind follow-up calls without counting the route as active work. */
  setInactive(
    historyId: string,
    target: T
  ): AgentHistoryRouteSnapshot<T> | null {
    const previous = this.routes.get(historyId) ?? null;
    this.routes.delete(historyId);
    this.routes.set(historyId, { target, active: false, token: null });
    this.pruneInactive();
    return previous ? { ...previous } : null;
  }

  /** Restore a superseded route only if this exact tentative start still owns it. */
  restoreIfToken(
    historyId: string,
    token: string,
    previous: AgentHistoryRouteSnapshot<T> | null
  ): boolean {
    const route = this.routes.get(historyId);
    if (route?.token !== token) return false;
    this.routes.delete(historyId);
    if (previous && !previous.target.isDestroyed()) {
      this.routes.set(historyId, { ...previous });
    }
    return true;
  }

  /** Mark only the exact renderer/start generation that reported terminal. */
  markInactiveByToken(historyId: string, target: T, token: string): boolean {
    const route = this.routes.get(historyId);
    if (route?.target !== target || route.token !== token) return false;
    return this.markInactive(historyId, target);
  }

  markInactive(historyId: string, target: T): boolean {
    const route = this.routes.get(historyId);
    if (route?.target !== target) return false;
    route.active = false;
    this.routes.delete(historyId);
    this.routes.set(historyId, route);
    this.pruneInactive();
    return true;
  }

  deleteIfTarget(historyId: string, target: T): boolean {
    const route = this.routes.get(historyId);
    if (route?.target !== target) return false;
    return this.routes.delete(historyId);
  }
}
