/**
 * In-memory mutex lock manager for preventing duplicate bookings
 * With extensive logging for debugging
 */

import { createLogger } from '../logger';

const log = createLogger('Scheduler:LockManager');

interface Lock {
  holderId: string;
  acquiredAt: number;
  expiresAt: number;
}

export class LockManager {
  private locks = new Map<string, Lock>();
  private readonly LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    log.debug('LockManager initialized', { timeoutMs: this.LOCK_TIMEOUT_MS });
  }

  /**
   * Attempt to acquire a lock
   * @param key - Lock key (typically: accountId-venue-date)
   * @param holderId - ID of the entity requesting the lock (typically job ID)
   * @returns true if lock acquired, false if already locked
   */
  acquire(key: string, holderId: string): boolean {
    log.trace('Attempting to acquire lock', { key, holderId });

    const cleanupCount = this.cleanup(); // Remove expired locks first
    if (cleanupCount > 0) {
      log.debug('Cleaned up expired locks', { count: cleanupCount });
    }

    const existing = this.locks.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      // Already locked by someone else (or same holder)
      const remainingMs = existing.expiresAt - Date.now();
      log.debug('Lock acquisition FAILED - already held', {
        key,
        requestedBy: holderId,
        heldBy: existing.holderId,
        remainingMs,
        expiresAt: new Date(existing.expiresAt).toISOString(),
      });
      return false;
    }

    // Acquire the lock
    const now = Date.now();
    const expiresAt = now + this.LOCK_TIMEOUT_MS;

    this.locks.set(key, {
      holderId,
      acquiredAt: now,
      expiresAt,
    });

    log.info('Lock ACQUIRED', {
      key,
      holderId,
      expiresAt: new Date(expiresAt).toISOString(),
      activeLocks: this.locks.size,
    });

    return true;
  }

  /**
   * Release a lock
   * @param key - Lock key
   * @param holderId - ID of the lock holder (must match to release)
   */
  release(key: string, holderId: string): void {
    log.trace('Attempting to release lock', { key, holderId });

    const existing = this.locks.get(key);
    if (!existing) {
      log.debug('Lock release - no lock found', { key, holderId });
      return;
    }

    if (existing.holderId !== holderId) {
      log.warn('Lock release DENIED - holder mismatch', {
        key,
        requestedBy: holderId,
        actualHolder: existing.holderId,
      });
      return;
    }

    const heldForMs = Date.now() - existing.acquiredAt;
    this.locks.delete(key);

    log.info('Lock RELEASED', {
      key,
      holderId,
      heldForMs,
      remainingLocks: this.locks.size,
    });
  }

  /**
   * Check if a lock exists and is still valid
   */
  isLocked(key: string): boolean {
    const existing = this.locks.get(key);
    if (!existing) {
      log.trace('isLocked check - no lock', { key, result: false });
      return false;
    }

    if (existing.expiresAt <= Date.now()) {
      log.debug('isLocked check - lock expired, removing', {
        key,
        holderId: existing.holderId,
      });
      this.locks.delete(key);
      return false;
    }

    log.trace('isLocked check - lock active', {
      key,
      holderId: existing.holderId,
      remainingMs: existing.expiresAt - Date.now(),
      result: true,
    });
    return true;
  }

  /**
   * Get lock holder ID
   */
  getLockHolder(key: string): string | null {
    const existing = this.locks.get(key);
    if (!existing || existing.expiresAt <= Date.now()) {
      log.trace('getLockHolder - no valid lock', { key });
      return null;
    }
    log.trace('getLockHolder', { key, holderId: existing.holderId });
    return existing.holderId;
  }

  /**
   * Remove expired locks
   */
  private cleanup(): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, lock] of this.locks) {
      if (lock.expiresAt <= now) {
        log.trace('Cleaning up expired lock', {
          key,
          holderId: lock.holderId,
          expiredAgo: `${now - lock.expiresAt}ms`,
        });
        this.locks.delete(key);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  /**
   * Get number of active locks
   */
  getActiveLockCount(): number {
    this.cleanup();
    const count = this.locks.size;
    log.trace('getActiveLockCount', { count });
    return count;
  }

  /**
   * Get all active locks (for debugging)
   */
  getActiveLocks(): Array<{ key: string; holderId: string; acquiredAt: Date; expiresAt: Date }> {
    this.cleanup();
    const locks = Array.from(this.locks.entries()).map(([key, lock]) => ({
      key,
      holderId: lock.holderId,
      acquiredAt: new Date(lock.acquiredAt),
      expiresAt: new Date(lock.expiresAt),
    }));

    log.debug('getActiveLocks', {
      count: locks.length,
      locks: locks.map((l) => ({ key: l.key, holderId: l.holderId })),
    });

    return locks;
  }

  /**
   * Clear all locks (use with caution!)
   */
  clearAll(): void {
    const count = this.locks.size;
    this.locks.clear();
    log.warn('ALL LOCKS CLEARED', { previousCount: count });
  }
}
