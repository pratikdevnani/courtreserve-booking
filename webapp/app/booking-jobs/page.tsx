'use client'

import { useEffect, useState } from 'react'
import TimePreferencePicker from './components/TimePreferencePicker'
import DurationRangePicker from './components/DurationRangePicker'
import SchedulerStatus from './components/SchedulerStatus'

type Account = {
  id: string
  name: string
  email: string
  venue: string
  active: boolean
}

type BookingJob = {
  id: string
  name: string
  accountId: string
  venue: string
  recurrence: string
  days: string
  active: boolean
  lastRun?: string
  nextRun?: string
  lastAttemptAt?: string
  lastAttemptStatus?: string | null
  lastAttemptMessage?: string | null
  lastAttemptDate?: string | null
  // New schema fields
  preferredTime?: string | null
  timeFlexibility?: number | null
  preferredDuration?: number | null
  minDuration?: number | null
  strictDuration?: boolean | null
  maxBookingsPerDay?: number | null
  priority?: number | null
  minNoticeHours?: number | null
  // Legacy fields (backward compat)
  slotMode?: string | null
  timeSlots?: string | null
  durations?: string | null
  // Relations
  account: {
    id: string
    name: string
    email: string
  }
  _count: {
    reservations: number
  }
}

type BookingAttempt = {
  date: string
  timeSlot: string
  success: boolean
  message: string
  courtId?: string
  duration?: number
}

type BookingRunHistory = {
  id: string
  bookingJobId: string
  startedAt: string
  completedAt: string | null
  status: string
  attempts: string
  successCount: number
  failureCount: number
  errorMessage: string | null
}

export default function BookingJobsPage() {
  const [bookingJobs, setBookingJobs] = useState<BookingJob[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form state with new schema
  const [formData, setFormData] = useState({
    name: '',
    accountId: '',
    venue: 'sunnyvale',
    recurrence: 'once',
    days: [] as string[],
    active: true,
    // New schema fields
    preferredTime: '18:00',
    timeFlexibility: 30,
    preferredDuration: 120,
    minDuration: 60,
    strictDuration: false,
    maxBookingsPerDay: 1,
    priority: 0,
    minNoticeHours: 6,
  })

  const [newDay, setNewDay] = useState('')
  const [runningScheduler, setRunningScheduler] = useState(false)
  const [selectedJobHistory, setSelectedJobHistory] = useState<string | null>(null)
  const [runHistory, setRunHistory] = useState<BookingRunHistory[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  useEffect(() => {
    fetchBookingJobs()
    fetchAccounts()
  }, [])

  const fetchBookingJobs = async () => {
    try {
      const res = await fetch('/api/booking-jobs')
      const data = await res.json()
      setBookingJobs(data)
    } catch (error) {
      // Error handled silently - user sees empty state
    } finally {
      setLoading(false)
    }
  }

  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/accounts')
      const data = await res.json()
      setAccounts(data.filter((a: Account) => a.active))
    } catch (error) {
      // Error handled silently
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validate required fields
    if (!formData.name.trim()) {
      alert('Please enter a job name')
      return
    }
    if (!formData.accountId) {
      alert('Please select an account')
      return
    }
    if (formData.days.length === 0) {
      alert('Please add at least one day')
      return
    }
    if (!formData.preferredTime || !/^\d{2}:\d{2}$/.test(formData.preferredTime)) {
      alert('Please enter a valid preferred time (HH:MM)')
      return
    }
    if (formData.minDuration > formData.preferredDuration) {
      alert('Minimum duration cannot exceed preferred duration')
      return
    }

    try {
      const url = editingId ? `/api/booking-jobs/${editingId}` : '/api/booking-jobs'
      const method = editingId ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (res.ok) {
        await fetchBookingJobs()
        resetForm()
      } else {
        const error = await res.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      // Error shown via alert
      alert('Failed to save booking job')
    }
  }

  const handleEdit = (job: BookingJob) => {
    // Detect if job uses new schema
    const hasNewSchema = job.preferredTime !== null && job.preferredTime !== undefined

    // Parse days - handle potential double-encoding
    let parsedDays: string[]
    try {
      const firstParse = JSON.parse(job.days)
      // If firstParse is a string, it was double-encoded
      parsedDays = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse
    } catch {
      parsedDays = []
    }

    if (hasNewSchema) {
      setFormData({
        name: job.name,
        accountId: job.accountId,
        venue: job.venue,
        recurrence: job.recurrence,
        days: parsedDays,
        active: job.active,
        preferredTime: job.preferredTime!,
        timeFlexibility: job.timeFlexibility ?? 30,
        preferredDuration: job.preferredDuration ?? 120,
        minDuration: job.minDuration ?? 60,
        strictDuration: job.strictDuration ?? false,
        maxBookingsPerDay: job.maxBookingsPerDay ?? 1,
        priority: job.priority ?? 0,
        minNoticeHours: job.minNoticeHours ?? 6,
      })
    } else {
      // Legacy job - convert to new schema for editing
      const timeSlots = job.timeSlots ? (JSON.parse(job.timeSlots) as string[]) : ['18:00']
      const durations = job.durations ? (JSON.parse(job.durations) as number[]) : [120]

      setFormData({
        name: job.name,
        accountId: job.accountId,
        venue: job.venue,
        recurrence: job.recurrence,
        days: parsedDays,
        active: job.active,
        preferredTime: timeSlots[0]?.split('-')[0] || '18:00',
        timeFlexibility: timeSlots.length > 1 ? 30 : 0,
        preferredDuration: durations[0] || 120,
        minDuration: durations[durations.length - 1] || 60,
        strictDuration: durations.length === 1,
        maxBookingsPerDay: 1,
        priority: 0,
        minNoticeHours: 6,
      })
    }

    setEditingId(job.id)
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this booking job?')) {
      return
    }

    try {
      const res = await fetch(`/api/booking-jobs/${id}`, { method: 'DELETE' })

      if (res.ok) {
        await fetchBookingJobs()
      } else {
        const error = await res.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      // Error shown via alert
      alert('Failed to delete booking job')
    }
  }

  const handleRunScheduler = async (mode: 'noon' | 'polling' | 'both') => {
    setRunningScheduler(true)

    try {
      const res = await fetch(`/api/scheduler/run?mode=${mode}`, { method: 'POST' })
      const data = await res.json()

      if (data.success) {
        const totals = data.totals || { success: 0, failure: 0, jobs: 0 }
        alert(
          `Scheduler (${mode}) completed!\n\n` +
            `Total Jobs: ${totals.jobs}\n` +
            `Success: ${totals.success}\n` +
            `Failed: ${totals.failure}\n\n` +
            `Check the reservations page to see any new bookings.`
        )
        await fetchBookingJobs() // Refresh to see updated lastRun times
      } else {
        alert(`Scheduler failed: ${data.error}`)
      }
    } catch (error) {
      // Error shown via alert
      alert('Failed to run scheduler')
    } finally {
      setRunningScheduler(false)
    }
  }

  const fetchRunHistory = async (jobId: string) => {
    setLoadingHistory(true)
    try {
      const res = await fetch(`/api/booking-jobs/${jobId}/history`)
      const data = await res.json()
      setRunHistory(Array.isArray(data) ? data : [])
    } catch (error) {
      // Error handled - show empty state
      setRunHistory([])
    } finally {
      setLoadingHistory(false)
    }
  }

  const handleViewHistory = async (jobId: string) => {
    if (selectedJobHistory === jobId) {
      setSelectedJobHistory(null)
      setRunHistory([])
    } else {
      setSelectedJobHistory(jobId)
      await fetchRunHistory(jobId)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'bg-green-900 text-green-300'
      case 'partial':
        return 'bg-yellow-900 text-yellow-300'
      case 'no_courts':
        return 'bg-blue-900 text-blue-300'
      case 'failed':
        return 'bg-red-900 text-red-300'
      default:
        return 'bg-gray-900 text-gray-300'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'success':
        return 'Success'
      case 'partial':
        return 'Partial'
      case 'no_courts':
        return 'No Courts'
      case 'failed':
        return 'Failed'
      default:
        return status
    }
  }

  const resetForm = () => {
    setShowForm(false)
    setEditingId(null)
    setFormData({
      name: '',
      accountId: '',
      venue: 'sunnyvale',
      recurrence: 'once',
      days: [],
      active: true,
      preferredTime: '18:00',
      timeFlexibility: 30,
      preferredDuration: 120,
      minDuration: 60,
      strictDuration: false,
      maxBookingsPerDay: 1,
      priority: 0,
      minNoticeHours: 6,
    })
    setNewDay('')
  }

  const addDay = () => {
    if (newDay && !formData.days.includes(newDay)) {
      setFormData({ ...formData, days: [...formData.days, newDay] })
      setNewDay('')
    }
  }

  const removeDay = (day: string) => {
    setFormData({ ...formData, days: formData.days.filter((d) => d !== day) })
  }

  // Format time for display (12-hour format)
  const formatTime12Hour = (time24: string): string => {
    const [hours, minutes] = time24.split(':').map(Number)
    const period = hours >= 12 ? 'PM' : 'AM'
    const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
    return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`
  }

  // Format duration for display
  const formatDuration = (minutes: number): string => {
    if (minutes < 60) return `${minutes}min`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return mins === 0 ? `${hours}hr` : `${hours}hr ${mins}min`
  }

  // Get job display info
  const getJobTimeDisplay = (job: BookingJob): string => {
    if (job.preferredTime) {
      let display = formatTime12Hour(job.preferredTime)
      if (job.timeFlexibility && job.timeFlexibility > 0) {
        display += ` (±${job.timeFlexibility}min)`
      }
      return display
    }
    // Legacy format
    try {
      const timeSlots = JSON.parse(job.timeSlots || '[]') as string[]
      return timeSlots.length > 0 ? `${timeSlots.length} slots` : 'Not set'
    } catch {
      return 'Invalid'
    }
  }

  const getJobDurationDisplay = (job: BookingJob): string => {
    if (job.preferredDuration) {
      let display = formatDuration(job.preferredDuration)
      if (!job.strictDuration && job.minDuration && job.minDuration < job.preferredDuration) {
        display += ` → ${formatDuration(job.minDuration)}`
      }
      return display
    }
    // Legacy format
    try {
      const durations = JSON.parse(job.durations || '[]') as number[]
      return durations.length > 0 ? durations.map(formatDuration).join(', ') : 'Not set'
    } catch {
      return 'Invalid'
    }
  }

  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

  // Determine if we should show weekday picker or date picker based on recurrence
  const showWeekdayPicker = formData.recurrence === 'weekly'

  // Helper: Get status badge styling
  const getLastAttemptStatusBadge = (status: string | null | undefined) => {
    switch (status) {
      case 'success':
        return { label: 'Success', className: 'bg-green-900 text-green-300' }
      case 'no_courts':
        return { label: 'No Courts', className: 'bg-yellow-900 text-yellow-300' }
      case 'window_closed':
        return { label: 'Too Early', className: 'bg-blue-900 text-blue-300' }
      case 'locked':
        return { label: 'Skipped', className: 'bg-gray-900 text-gray-400' }
      case 'error':
      default:
        return { label: 'Error', className: 'bg-red-900 text-red-300' }
    }
  }

  // Helper: Format relative time
  const formatRelativeTime = (dateStr: string): string => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} min ago`

    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`

    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-300">Loading...</div>
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-3xl font-semibold text-gray-100">Booking Jobs</h1>
          <p className="mt-2 text-sm text-gray-300">
            Manage automated booking jobs (one-time or recurring)
          </p>
        </div>
        <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
          <button
            onClick={() => setShowForm(true)}
            className="block rounded-md bg-green-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-green-500"
          >
            Add Booking Job
          </button>
        </div>
      </div>

      {/* Scheduler Status */}
      <div className="mt-6">
        <SchedulerStatus onRunScheduler={handleRunScheduler} isRunning={runningScheduler} />
      </div>

      {showForm && (
        <div className="mt-8 bg-gray-800 shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-100 mb-4">
            {editingId ? 'Edit Booking Job' : 'New Booking Job'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-300">Job Name</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="mt-1 block w-full rounded-md bg-gray-700 border-gray-600 text-gray-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                  placeholder="e.g., Weekly Pickleball"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300">Account</label>
                <select
                  required
                  value={formData.accountId}
                  onChange={(e) => setFormData({ ...formData, accountId: e.target.value })}
                  className="mt-1 block w-full rounded-md bg-gray-700 border-gray-600 text-gray-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                >
                  <option value="">Select account...</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.email}) - {account.venue}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300">Venue</label>
                <select
                  value={formData.venue}
                  onChange={(e) => setFormData({ ...formData, venue: e.target.value })}
                  className="mt-1 block w-full rounded-md bg-gray-700 border-gray-600 text-gray-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                >
                  <option value="sunnyvale">Sunnyvale</option>
                  <option value="santa_clara">Santa Clara</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300">Recurrence</label>
                <select
                  value={formData.recurrence}
                  onChange={(e) => {
                    const newRecurrence = e.target.value
                    // Clear days when switching recurrence type
                    setFormData({ ...formData, recurrence: newRecurrence, days: [] })
                    setNewDay('')
                  }}
                  className="mt-1 block w-full rounded-md bg-gray-700 border-gray-600 text-gray-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                >
                  <option value="once">Once (specific date)</option>
                  <option value="weekly">Weekly (recurring)</option>
                </select>
              </div>
            </div>

            {/* Days Configuration */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {showWeekdayPicker ? 'Days of Week' : 'Date to Book'}
              </label>
              <p className="text-xs text-gray-500 mb-3">
                {showWeekdayPicker
                  ? 'Select which days of the week to attempt booking (books 2 weeks ahead)'
                  : 'Select the specific date you want to book'}
              </p>

              <div className="flex gap-2 mb-3">
                {showWeekdayPicker ? (
                  <>
                    <select
                      value={newDay}
                      onChange={(e) => setNewDay(e.target.value)}
                      className="block rounded-md bg-gray-700 border-gray-600 text-gray-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border flex-1"
                    >
                      <option value="">Select weekday...</option>
                      {weekdays.map((day) => (
                        <option key={day} value={day}>
                          {day}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={addDay}
                      disabled={!newDay}
                      className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:bg-gray-600 disabled:cursor-not-allowed"
                    >
                      Add
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      type="date"
                      value={newDay.match(/\d{4}-\d{2}-\d{2}/) ? newDay : ''}
                      onChange={(e) => setNewDay(e.target.value)}
                      className="block rounded-md bg-gray-700 border-gray-600 text-gray-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border flex-1"
                    />
                    <button
                      type="button"
                      onClick={addDay}
                      disabled={!newDay}
                      className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:bg-gray-600 disabled:cursor-not-allowed"
                    >
                      Add
                    </button>
                  </>
                )}
              </div>

              {/* Selected days */}
              <div className="flex flex-wrap gap-2">
                {formData.days.map((day) => (
                  <span
                    key={day}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-900 px-3 py-1 text-sm font-semibold text-blue-300"
                  >
                    {day}
                    <button type="button" onClick={() => removeDay(day)} className="hover:text-blue-100">
                      ×
                    </button>
                  </span>
                ))}
                {formData.days.length === 0 && (
                  <p className="text-sm text-gray-500 italic">No days added yet</p>
                )}
              </div>
            </div>

            {/* Time Preferences */}
            <div className="border-t border-gray-700 pt-6">
              <h3 className="text-sm font-medium text-gray-200 mb-4">Time Preferences</h3>
              <TimePreferencePicker
                preferredTime={formData.preferredTime}
                timeFlexibility={formData.timeFlexibility}
                onChange={({ preferredTime, timeFlexibility }) =>
                  setFormData({ ...formData, preferredTime, timeFlexibility })
                }
              />
            </div>

            {/* Duration Preferences */}
            <div className="border-t border-gray-700 pt-6">
              <h3 className="text-sm font-medium text-gray-200 mb-4">Duration Preferences</h3>
              <DurationRangePicker
                preferredDuration={formData.preferredDuration}
                minDuration={formData.minDuration}
                strictDuration={formData.strictDuration}
                onChange={({ preferredDuration, minDuration, strictDuration }) =>
                  setFormData({ ...formData, preferredDuration, minDuration, strictDuration })
                }
              />
            </div>

            {/* Advanced Options */}
            <div className="border-t border-gray-700 pt-6">
              <h3 className="text-sm font-medium text-gray-200 mb-4">Advanced Options</h3>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Max Bookings Per Day
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={formData.maxBookingsPerDay}
                    onChange={(e) =>
                      setFormData({ ...formData, maxBookingsPerDay: parseInt(e.target.value) || 1 })
                    }
                    className="block w-full rounded-md bg-gray-700 border-gray-600 text-gray-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    How many bookings to make for this job per day
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Minimum Notice (hours)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={72}
                    value={formData.minNoticeHours}
                    onChange={(e) =>
                      setFormData({ ...formData, minNoticeHours: parseInt(e.target.value) || 0 })
                    }
                    className="block w-full rounded-md bg-gray-700 border-gray-600 text-gray-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    Polling mode won&apos;t book slots less than this many hours away
                  </p>
                </div>

                {formData.recurrence === 'weekly' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Priority (0-10)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={formData.priority}
                      onChange={(e) =>
                        setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })
                      }
                      className="block w-full rounded-md bg-gray-700 border-gray-600 text-gray-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                    />
                    <p className="mt-1 text-xs text-gray-400">
                      Higher priority jobs are processed first at noon
                    </p>
                  </div>
                )}

                <div className="flex items-center pt-4">
                  <input
                    type="checkbox"
                    checked={formData.active}
                    onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-600 text-indigo-600 focus:ring-indigo-500"
                  />
                  <label className="ml-2 block text-sm text-gray-100">Active</label>
                </div>
              </div>
            </div>

            <div className="flex space-x-3 pt-4">
              <button
                type="submit"
                className="inline-flex justify-center rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500"
              >
                {editingId ? 'Update' : 'Create'} Booking Job
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex justify-center rounded-md bg-gray-700 px-4 py-2 text-sm font-semibold text-gray-100 shadow-sm ring-1 ring-inset ring-gray-600 hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Jobs List */}
      <div className="mt-8 flow-root">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-gray-700 sm:rounded-lg">
              <table className="min-w-full divide-y divide-gray-700 bg-gray-800">
                <thead className="bg-gray-900">
                  <tr>
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-100">
                      Name
                    </th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-100">
                      Account
                    </th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-100">
                      Time
                    </th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-100">
                      Duration
                    </th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-100">
                      Status
                    </th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-100">
                      Latest Result
                    </th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700 bg-gray-800">
                  {bookingJobs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">
                        No booking jobs yet. Click &quot;Add Booking Job&quot; to create one.
                      </td>
                    </tr>
                  ) : (
                    bookingJobs.map((job) => (
                      <>
                        <tr key={job.id} className="hover:bg-gray-750">
                          <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm">
                            <div className="font-medium text-gray-100">{job.name}</div>
                            <div className="text-gray-400 text-xs">
                              {job.venue} • {job.recurrence}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-400">
                            {job.account.name}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-400">
                            {getJobTimeDisplay(job)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-400">
                            {getJobDurationDisplay(job)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-400">
                            <span
                              className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                                job.active
                                  ? 'bg-green-900 text-green-300'
                                  : 'bg-red-900 text-red-300'
                              }`}
                            >
                              {job.active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-3 py-4 text-sm">
                            {job.lastAttemptAt ? (
                              <div className="flex flex-col gap-0.5">
                                {/* Row 1: Status badge + date */}
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                      getLastAttemptStatusBadge(job.lastAttemptStatus).className
                                    }`}
                                  >
                                    {getLastAttemptStatusBadge(job.lastAttemptStatus).label}
                                  </span>
                                  {job.lastAttemptDate && (
                                    <span className="text-gray-500 text-xs">{job.lastAttemptDate}</span>
                                  )}
                                </div>

                                {/* Row 2: Message */}
                                {job.lastAttemptMessage && (
                                  <span
                                    className="text-gray-400 text-xs truncate max-w-[220px]"
                                    title={job.lastAttemptMessage}
                                  >
                                    {job.lastAttemptMessage}
                                  </span>
                                )}

                                {/* Row 3: Relative timestamp */}
                                <span className="text-gray-500 text-xs">
                                  {formatRelativeTime(job.lastAttemptAt)}
                                </span>
                              </div>
                            ) : (
                              <span className="text-gray-500">Never</span>
                            )}
                          </td>
                          <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6 space-x-3">
                            <button
                              onClick={() => handleViewHistory(job.id)}
                              className="text-blue-400 hover:text-blue-300"
                            >
                              {selectedJobHistory === job.id ? '▼ Hide' : '▶ History'}
                            </button>
                            <button
                              onClick={() => handleEdit(job)}
                              className="text-indigo-400 hover:text-indigo-300"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(job.id)}
                              className="text-red-400 hover:text-red-300"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                        {selectedJobHistory === job.id && (
                          <tr key={`${job.id}-history`}>
                            <td colSpan={7} className="px-4 py-4 bg-gray-900">
                              <div className="space-y-3">
                                <h3 className="text-sm font-semibold text-gray-100 mb-3">
                                  Run History
                                </h3>
                                {loadingHistory ? (
                                  <div className="text-sm text-gray-400">Loading history...</div>
                                ) : !Array.isArray(runHistory) || runHistory.length === 0 ? (
                                  <div className="text-sm text-gray-400">
                                    No run history yet. Run the scheduler to see results here.
                                  </div>
                                ) : (
                                  <div className="space-y-2 max-h-96 overflow-y-auto">
                                    {runHistory.map((run) => {
                                      let attempts: BookingAttempt[] = []
                                      try {
                                        attempts = JSON.parse(run.attempts)
                                      } catch (e) {
                                        // Invalid JSON - show empty attempts
                                      }
                                      return (
                                        <div
                                          key={run.id}
                                          className="bg-gray-800 rounded-lg p-3 border border-gray-700"
                                        >
                                          <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-3">
                                              <span
                                                className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusColor(run.status)}`}
                                              >
                                                {getStatusLabel(run.status)}
                                              </span>
                                              <span className="text-xs text-gray-400">
                                                {new Date(run.startedAt).toLocaleString()}
                                              </span>
                                            </div>
                                            <div className="text-xs text-gray-400">
                                              {run.successCount} success / {run.failureCount} failed
                                            </div>
                                          </div>
                                          {run.errorMessage && (
                                            <div className="text-xs text-red-400 mb-2">
                                              Error: {run.errorMessage}
                                            </div>
                                          )}
                                          {attempts.length > 0 ? (
                                            <div className="space-y-1">
                                              {attempts.map((attempt, idx) => (
                                                <div
                                                  key={idx}
                                                  className="flex items-center justify-between text-xs py-1 px-2 bg-gray-700 rounded"
                                                >
                                                  <div className="flex items-center gap-2">
                                                    <span
                                                      className={
                                                        attempt.success
                                                          ? 'text-green-400'
                                                          : 'text-gray-500'
                                                      }
                                                    >
                                                      {attempt.success ? '✓' : '✗'}
                                                    </span>
                                                    <span className="text-gray-300">
                                                      {attempt.date}
                                                    </span>
                                                    <span className="text-gray-400">
                                                      at {attempt.timeSlot}
                                                    </span>
                                                    {attempt.duration && (
                                                      <span className="text-gray-500">
                                                        ({attempt.duration}min)
                                                      </span>
                                                    )}
                                                  </div>
                                                  <div className="flex items-center gap-2">
                                                    {attempt.courtId && (
                                                      <span className="text-blue-400">
                                                        Court {attempt.courtId}
                                                      </span>
                                                    )}
                                                    <span
                                                      className={
                                                        attempt.success
                                                          ? 'text-green-400'
                                                          : 'text-gray-500'
                                                      }
                                                    >
                                                      {attempt.message}
                                                    </span>
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          ) : (
                                            <div className="text-xs text-gray-500 italic">
                                              No detailed attempts recorded
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
