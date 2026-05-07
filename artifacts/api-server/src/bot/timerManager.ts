class TimerManager {
  private readonly timers = new Map<number, NodeJS.Timeout>();

  set(leagueId: number, ms: number, callback: () => void): void {
    this.clear(leagueId);
    const timer = setTimeout(callback, Math.max(ms, 0));
    this.timers.set(leagueId, timer);
  }

  clear(leagueId: number): void {
    const existing = this.timers.get(leagueId);
    if (existing !== undefined) {
      clearTimeout(existing);
      this.timers.delete(leagueId);
    }
  }

  clearAll(): void {
    for (const leagueId of [...this.timers.keys()]) {
      this.clear(leagueId);
    }
  }
}

export const timerManager = new TimerManager();
