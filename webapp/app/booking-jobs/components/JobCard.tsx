'use client';

interface JobCardProps {
  job: {
    id: string;
    name: string;
    venue: string;
    recurrence: string;
    days: string;
    active: boolean;
    lastRun?: string | null;
    nextRun?: string | null;
    preferredTime?: string | null;
    timeFlexibility?: number | null;
    preferredDuration?: number | null;
    minDuration?: number | null;
    strictDuration?: boolean | null;
    maxBookingsPerDay?: number | null;
    timeSlots?: string | null; // Legacy
    durations?: string | null; // Legacy
    account: {
      email: string;
    };
    _count?: {
      reservations: number;
    };
  };
  onEdit: () => void;
  onDelete: () => void;
  onViewHistory: () => void;
  showHistory: boolean;
}

// Format time for display
function formatTime12Hour(time24: string): string {
  const [hours, minutes] = time24.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

// Format duration
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins === 0 ? `${hours}hr` : `${hours}hr ${mins}min`;
}

// Format relative time
function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return 'Never';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 0) {
    // Future
    const futureMins = Math.abs(diffMins);
    if (futureMins < 60) return `in ${futureMins}m`;
    const hours = Math.floor(futureMins / 60);
    if (hours < 24) return `in ${hours}h`;
    return `in ${Math.floor(hours / 24)}d`;
  }

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const hours = Math.floor(diffMins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function JobCard({
  job,
  onEdit,
  onDelete,
  onViewHistory,
  showHistory,
}: JobCardProps) {
  // Parse days for display
  const daysArray = (() => {
    try {
      return JSON.parse(job.days) as string[];
    } catch {
      return [];
    }
  })();

  // Determine time display (new schema vs legacy)
  const hasNewSchema = job.preferredTime !== null && job.preferredTime !== undefined;
  let timeDisplay = '';
  let durationDisplay = '';

  if (hasNewSchema) {
    timeDisplay = formatTime12Hour(job.preferredTime!);
    if (job.timeFlexibility && job.timeFlexibility > 0) {
      timeDisplay += ` (+/-${job.timeFlexibility}min)`;
    }

    durationDisplay = formatDuration(job.preferredDuration || 120);
    if (!job.strictDuration && job.minDuration && job.minDuration < (job.preferredDuration || 120)) {
      durationDisplay += ` - ${formatDuration(job.minDuration)}`;
    }
  } else {
    // Legacy format
    try {
      const timeSlots = JSON.parse(job.timeSlots || '[]') as string[];
      const durations = JSON.parse(job.durations || '[]') as number[];

      timeDisplay = timeSlots.length > 0 ? `${timeSlots.length} slots` : 'Not set';
      durationDisplay = durations.length > 0 ? durations.map(formatDuration).join(', ') : 'Not set';
    } catch {
      timeDisplay = 'Invalid';
      durationDisplay = 'Invalid';
    }
  }

  return (
    <div
      className={`bg-gray-800 rounded-lg border ${
        job.active ? 'border-gray-700' : 'border-gray-700/50 opacity-60'
      } overflow-hidden`}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-medium text-white">{job.name}</h3>
          <span
            className={`px-2 py-0.5 text-xs rounded ${
              job.active ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-400'
            }`}
          >
            {job.active ? 'Active' : 'Inactive'}
          </span>
          <span className="px-2 py-0.5 text-xs bg-gray-700 text-gray-300 rounded">
            {job.venue}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onViewHistory}
            className="p-1.5 text-gray-400 hover:text-blue-400 transition-colors"
            title="View history"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>
          <button
            onClick={onEdit}
            className="p-1.5 text-gray-400 hover:text-yellow-400 transition-colors"
            title="Edit"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 text-gray-400 hover:text-red-400 transition-colors"
            title="Delete"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        {/* Account */}
        <div>
          <p className="text-gray-500 text-xs mb-0.5">Account</p>
          <p className="text-gray-300 truncate">{job.account.email}</p>
        </div>

        {/* Days */}
        <div>
          <p className="text-gray-500 text-xs mb-0.5">
            {job.recurrence === 'weekly' ? 'Days' : 'Date'}
          </p>
          <p className="text-gray-300">
            {daysArray.length > 0
              ? daysArray.length > 2
                ? `${daysArray.slice(0, 2).join(', ')}...`
                : daysArray.join(', ')
              : 'Not set'}
          </p>
        </div>

        {/* Time */}
        <div>
          <p className="text-gray-500 text-xs mb-0.5">Time</p>
          <p className="text-gray-300">{timeDisplay}</p>
        </div>

        {/* Duration */}
        <div>
          <p className="text-gray-500 text-xs mb-0.5">Duration</p>
          <p className="text-gray-300">{durationDisplay}</p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 bg-gray-900/50 flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          <span className="text-gray-500">
            Last run: <span className="text-gray-400">{formatRelativeTime(job.lastRun)}</span>
          </span>
          {job._count && (
            <span className="text-gray-500">
              Reservations: <span className="text-gray-400">{job._count.reservations}</span>
            </span>
          )}
        </div>
        <span
          className={`px-2 py-0.5 rounded ${
            job.recurrence === 'weekly'
              ? 'bg-purple-900/50 text-purple-400'
              : 'bg-blue-900/50 text-blue-400'
          }`}
        >
          {job.recurrence === 'weekly' ? 'Weekly' : 'One-time'}
        </span>
      </div>
    </div>
  );
}
