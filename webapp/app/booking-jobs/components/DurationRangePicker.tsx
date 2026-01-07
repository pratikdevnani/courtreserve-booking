'use client';

import { useMemo } from 'react';

interface DurationRangePickerProps {
  preferredDuration: number;
  minDuration: number;
  strictDuration: boolean;
  onChange: (values: { preferredDuration: number; minDuration: number; strictDuration: boolean }) => void;
}

const DURATION_OPTIONS = [
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '1.5 hours' },
  { value: 120, label: '2 hours' },
];

// Generate duration sequence from preferred to minimum
function generateDurationPreview(preferred: number, min: number, strict: boolean): number[] {
  if (strict) {
    return [preferred];
  }

  const durations: number[] = [];
  for (let d = preferred; d >= min; d -= 30) {
    durations.push(d);
  }
  return durations;
}

// Format duration for display
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours}hr`;
  }
  return `${hours}hr ${mins}min`;
}

export default function DurationRangePicker({
  preferredDuration,
  minDuration,
  strictDuration,
  onChange,
}: DurationRangePickerProps) {
  const previewDurations = useMemo(
    () => generateDurationPreview(preferredDuration, minDuration, strictDuration),
    [preferredDuration, minDuration, strictDuration]
  );

  // Filter min duration options to only show values <= preferred
  const minDurationOptions = DURATION_OPTIONS.filter((opt) => opt.value <= preferredDuration);

  return (
    <div className="space-y-4">
      {/* Preferred Duration */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          Preferred Duration
        </label>
        <select
          value={preferredDuration}
          onChange={(e) => {
            const newPreferred = Number(e.target.value);
            // Auto-adjust min if it's greater than new preferred
            const newMin = minDuration > newPreferred ? newPreferred : minDuration;
            onChange({ preferredDuration: newPreferred, minDuration: newMin, strictDuration });
          }}
          className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-blue-500 focus:border-blue-500"
        >
          {DURATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Strict Duration Toggle */}
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="strictDuration"
          checked={strictDuration}
          onChange={(e) =>
            onChange({
              preferredDuration,
              minDuration: e.target.checked ? preferredDuration : minDuration,
              strictDuration: e.target.checked,
            })
          }
          className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
        />
        <label htmlFor="strictDuration" className="text-sm text-gray-300">
          Strict duration (only book exact duration)
        </label>
      </div>

      {/* Minimum Duration (only shown if not strict) */}
      {!strictDuration && (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Minimum Acceptable Duration
          </label>
          <select
            value={minDuration}
            onChange={(e) =>
              onChange({ preferredDuration, minDuration: Number(e.target.value), strictDuration })
            }
            className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-blue-500 focus:border-blue-500"
          >
            {minDurationOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">
            Will try longer durations first, then fall back to shorter ones
          </p>
        </div>
      )}

      {/* Preview */}
      <div className="bg-gray-700/50 rounded-md p-3">
        <p className="text-xs text-gray-400 mb-2">
          {strictDuration ? 'Will only book:' : 'Will try these durations (longest first):'}
        </p>
        <div className="flex flex-wrap gap-2">
          {previewDurations.map((duration, index) => (
            <span
              key={duration}
              className={`px-2 py-1 text-xs rounded ${
                index === 0 ? 'bg-blue-600 text-white' : 'bg-gray-600 text-gray-300'
              }`}
            >
              {formatDuration(duration)}
              {index === 0 && !strictDuration && ' (preferred)'}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
