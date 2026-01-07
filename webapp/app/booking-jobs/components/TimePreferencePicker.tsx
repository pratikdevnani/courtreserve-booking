'use client';

import { useMemo } from 'react';

interface TimePreferencePickerProps {
  preferredTime: string;
  timeFlexibility: number;
  onChange: (values: { preferredTime: string; timeFlexibility: number }) => void;
}

// Generate time slots based on preferred time and flexibility
function generateTimeSlotPreview(preferredTime: string, flexibilityMinutes: number): string[] {
  if (!preferredTime || preferredTime.length < 5) return [];

  const [hours, minutes] = preferredTime.split(':').map(Number);
  const baseMinutes = hours * 60 + minutes;
  const slots: string[] = [];

  // Generate slots: preferred, then alternating before/after
  if (flexibilityMinutes === 0) {
    slots.push(preferredTime);
  } else {
    // Add slots at 30-minute intervals within flexibility window
    for (let offset = -flexibilityMinutes; offset <= flexibilityMinutes; offset += 30) {
      const slotMinutes = baseMinutes + offset;
      if (slotMinutes >= 0 && slotMinutes < 24 * 60) {
        const h = Math.floor(slotMinutes / 60);
        const m = slotMinutes % 60;
        slots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
      }
    }
  }

  return slots.sort();
}

// Format time for display (12-hour format)
function formatTime12Hour(time24: string): string {
  const [hours, minutes] = time24.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

export default function TimePreferencePicker({
  preferredTime,
  timeFlexibility,
  onChange,
}: TimePreferencePickerProps) {
  const previewSlots = useMemo(
    () => generateTimeSlotPreview(preferredTime, timeFlexibility),
    [preferredTime, timeFlexibility]
  );

  return (
    <div className="space-y-4">
      {/* Preferred Time */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          Preferred Time
        </label>
        <input
          type="time"
          value={preferredTime}
          onChange={(e) => onChange({ preferredTime: e.target.value, timeFlexibility })}
          className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-blue-500 focus:border-blue-500"
          required
        />
        {preferredTime && (
          <p className="mt-1 text-xs text-gray-400">
            {formatTime12Hour(preferredTime)}
          </p>
        )}
      </div>

      {/* Time Flexibility */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          Time Flexibility
        </label>
        <select
          value={timeFlexibility}
          onChange={(e) => onChange({ preferredTime, timeFlexibility: Number(e.target.value) })}
          className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-blue-500 focus:border-blue-500"
        >
          <option value={0}>Exact time only</option>
          <option value={30}>+/- 30 minutes</option>
          <option value={60}>+/- 1 hour</option>
          <option value={90}>+/- 1.5 hours</option>
        </select>
      </div>

      {/* Preview */}
      {previewSlots.length > 0 && (
        <div className="bg-gray-700/50 rounded-md p-3">
          <p className="text-xs text-gray-400 mb-2">Will try these time slots (in order):</p>
          <div className="flex flex-wrap gap-2">
            {previewSlots.map((slot, index) => (
              <span
                key={slot}
                className={`px-2 py-1 text-xs rounded ${
                  slot === preferredTime
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-600 text-gray-300'
                }`}
              >
                {formatTime12Hour(slot)}
                {slot === preferredTime && ' (preferred)'}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
