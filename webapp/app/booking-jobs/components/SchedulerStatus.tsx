'use client';

import { useEffect, useState, useCallback } from 'react';

interface SchedulerState {
  isRunning: boolean;
  currentMode: string | null;
  lastNoonRun: string | null;
  lastPollingRun: string | null;
  activeLocks: number;
  uptimeSeconds: number | null;
}

interface SchedulerStatusProps {
  onRunScheduler?: (mode: 'noon' | 'polling' | 'both') => Promise<void>;
  isRunning?: boolean;
}

function formatTimeAgo(dateString: string | null): string {
  if (!dateString) return 'Never';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function formatUptime(seconds: number | null): string {
  if (seconds === null) return 'Not started';

  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

export default function SchedulerStatus({ onRunScheduler, isRunning = false }: SchedulerStatusProps) {
  const [state, setState] = useState<SchedulerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/scheduler/run');
      const data = await res.json();

      if (data.success) {
        setState(data.state);
        setError(null);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch scheduler state');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
    // Refresh every 30 seconds
    const interval = setInterval(fetchState, 30000);
    return () => clearInterval(interval);
  }, [fetchState]);

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-700 rounded w-1/3 mb-3"></div>
          <div className="h-3 bg-gray-700 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 border border-red-700">
        <h3 className="text-sm font-medium text-red-400 mb-1">Scheduler Status</h3>
        <p className="text-xs text-red-300">{error}</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-300">Scheduler Status</h3>
        <div className="flex items-center gap-2">
          {state?.isRunning ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              <span className="text-xs text-green-400">
                Running ({state.currentMode})
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-gray-500 rounded-full"></span>
              <span className="text-xs text-gray-400">Idle</span>
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm mb-4">
        <div>
          <p className="text-gray-500 text-xs">Last Noon Run</p>
          <p className="text-gray-300">{formatTimeAgo(state?.lastNoonRun || null)}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs">Last Polling Run</p>
          <p className="text-gray-300">{formatTimeAgo(state?.lastPollingRun || null)}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs">Active Locks</p>
          <p className="text-gray-300">{state?.activeLocks || 0}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs">Uptime</p>
          <p className="text-gray-300">{formatUptime(state?.uptimeSeconds || null)}</p>
        </div>
      </div>

      {/* Schedule Info */}
      <div className="bg-gray-700/50 rounded p-2 mb-4 text-xs">
        <p className="text-gray-400 mb-1">Schedule:</p>
        <ul className="text-gray-300 space-y-0.5">
          <li>Noon booking: 12:00 PM Pacific (prep at 11:59:50)</li>
          <li>Polling: Every 15 minutes</li>
        </ul>
      </div>

      {/* Manual Run Buttons */}
      {onRunScheduler && (
        <div className="flex gap-2">
          <button
            onClick={() => onRunScheduler('noon')}
            disabled={isRunning}
            className="flex-1 px-3 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded transition-colors"
          >
            Run Noon Mode
          </button>
          <button
            onClick={() => onRunScheduler('polling')}
            disabled={isRunning}
            className="flex-1 px-3 py-2 text-xs font-medium bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded transition-colors"
          >
            Run Polling
          </button>
          <button
            onClick={() => onRunScheduler('both')}
            disabled={isRunning}
            className="flex-1 px-3 py-2 text-xs font-medium bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded transition-colors"
          >
            Run Both
          </button>
        </div>
      )}
    </div>
  );
}
