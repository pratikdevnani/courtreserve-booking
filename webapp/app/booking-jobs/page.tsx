'use client'

import { useEffect, useState } from 'react'

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
  slotMode: string
  days: string
  timeSlots: string
  durations: string
  active: boolean
  lastRun?: string
  nextRun?: string
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

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    accountId: '',
    venue: 'sunnyvale',
    recurrence: 'once',
    slotMode: 'single',
    days: [] as string[],
    timeSlots: [] as string[],
    durations: [120, 90, 60, 30],
    active: true,
  })

  const [newDay, setNewDay] = useState('')
  const [newTimeSlot, setNewTimeSlot] = useState('')
  const [newDuration, setNewDuration] = useState<number>(120) // Default 2 hours
  const [dayInputMode, setDayInputMode] = useState<'weekday' | 'date'>('weekday')
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
      console.error('Error fetching booking jobs:', error)
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
      console.error('Error fetching accounts:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (formData.days.length === 0) {
      alert('Please add at least one day')
      return
    }

    if (formData.timeSlots.length === 0) {
      alert('Please add at least one time slot')
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
      console.error('Error saving booking job:', error)
      alert('Failed to save booking job')
    }
  }

  const handleEdit = (job: BookingJob) => {
    setFormData({
      name: job.name,
      accountId: job.accountId,
      venue: job.venue,
      recurrence: job.recurrence,
      slotMode: job.slotMode,
      days: JSON.parse(job.days),
      timeSlots: JSON.parse(job.timeSlots),
      durations: JSON.parse(job.durations),
      active: job.active,
    })
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
      console.error('Error deleting booking job:', error)
      alert('Failed to delete booking job')
    }
  }

  const handleRunScheduler = async () => {
    if (!confirm('This will attempt to book all active booking jobs now. Continue?')) {
      return
    }

    setRunningScheduler(true)

    try {
      const res = await fetch('/api/scheduler/run', { method: 'POST' })
      const data = await res.json()

      if (data.success) {
        alert(`Scheduler executed successfully!\n\nCheck the reservations page to see any new bookings.`)
        await fetchBookingJobs() // Refresh to see updated lastRun times
      } else {
        alert(`Scheduler failed: ${data.error}`)
      }
    } catch (error) {
      console.error('Error running scheduler:', error)
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
      console.error('Error fetching run history:', error)
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
      slotMode: 'single',
      days: [],
      timeSlots: [],
      durations: [120, 90, 60, 30],
      active: true,
    })
    setNewDay('')
    setNewTimeSlot('')
    setNewDuration(120)
  }

  const addDay = () => {
    if (newDay && !formData.days.includes(newDay)) {
      setFormData({ ...formData, days: [...formData.days, newDay] })
      setNewDay('')
    }
  }

  const removeDay = (day: string) => {
    setFormData({ ...formData, days: formData.days.filter(d => d !== day) })
  }

  const addTimeSlot = () => {
    if (newTimeSlot) {
      // Combine time and duration in format "HH:MM-DURATION"
      const timeSlotWithDuration = `${newTimeSlot}-${newDuration}`
      if (!formData.timeSlots.includes(timeSlotWithDuration)) {
        setFormData({ ...formData, timeSlots: [...formData.timeSlots, timeSlotWithDuration].sort() })
        setNewTimeSlot('')
        setNewDuration(120) // Reset to default
      }
    }
  }

  const removeTimeSlot = (slot: string) => {
    setFormData({ ...formData, timeSlots: formData.timeSlots.filter(s => s !== slot) })
  }

  // Format time slot for display: "18:00-120" -> "18:00 (2h)"
  const formatTimeSlot = (slot: string) => {
    const [time, duration] = slot.split('-')

    // Backward compatibility: if no duration, just return the time
    if (!duration) {
      return time
    }

    const durationMins = parseInt(duration)
    const hours = durationMins / 60
    const displayDuration = hours >= 1
      ? hours % 1 === 0 ? `${hours}h` : `${hours}h`
      : `${durationMins}min`
    return `${time} (${displayDuration})`
  }

  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

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
          <p className="mt-1 text-xs text-gray-500">
            Scheduler runs automatically every day at noon (12:00 PM). You can also trigger it manually below.
          </p>
        </div>
        <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none flex gap-2">
          <button
            onClick={handleRunScheduler}
            disabled={runningScheduler}
            className="block rounded-md bg-yellow-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-yellow-500 disabled:bg-gray-600 disabled:cursor-not-allowed"
          >
            {runningScheduler ? 'Running...' : '▶ Run Now'}
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="block rounded-md bg-green-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-green-500"
          >
            Add Booking Job
          </button>
        </div>
      </div>

      {showForm && (
        <div className="mt-8 bg-gray-800 shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-100 mb-4">
            {editingId ? 'Edit Booking Job' : 'New Booking Job'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-6">
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
                  onChange={(e) => setFormData({ ...formData, recurrence: e.target.value })}
                  className="mt-1 block w-full rounded-md bg-gray-700 border-gray-600 text-gray-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                >
                  <option value="once">Once</option>
                  <option value="weekly">Weekly (Recurring)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300">Slot Mode</label>
                <select
                  value={formData.slotMode}
                  onChange={(e) => setFormData({ ...formData, slotMode: e.target.value })}
                  className="mt-1 block w-full rounded-md bg-gray-700 border-gray-600 text-gray-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                >
                  <option value="single">Single Slot (first available)</option>
                  <option value="multi">Multi Slot (one per day)</option>
                </select>
                <p className="mt-1 text-xs text-gray-400">
                  {formData.slotMode === 'single'
                    ? 'Books the first available slot from the days/times list'
                    : 'Books one slot for each day specified'}
                </p>
              </div>

              <div className="flex items-center pt-6">
                <input
                  type="checkbox"
                  checked={formData.active}
                  onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-600 text-indigo-600 focus:ring-indigo-500"
                />
                <label className="ml-2 block text-sm text-gray-100">Active</label>
              </div>
            </div>

            {/* Days Configuration */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Days to Book
              </label>
              <p className="text-xs text-gray-500 mb-3">
                You can mix weekdays (for recurring bookings) and specific dates (for one-time bookings)
              </p>

              {/* Tab Switcher */}
              <div className="flex gap-2 mb-3 border-b border-gray-700">
                <button
                  type="button"
                  onClick={() => setDayInputMode('weekday')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    dayInputMode === 'weekday'
                      ? 'border-indigo-500 text-indigo-400'
                      : 'border-transparent text-gray-400 hover:text-gray-300'
                  }`}
                >
                  By Weekday
                </button>
                <button
                  type="button"
                  onClick={() => setDayInputMode('date')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    dayInputMode === 'date'
                      ? 'border-indigo-500 text-indigo-400'
                      : 'border-transparent text-gray-400 hover:text-gray-300'
                  }`}
                >
                  By Specific Date
                </button>
              </div>

              {/* Input based on mode */}
              <div className="flex gap-2 mb-3">
                {dayInputMode === 'weekday' ? (
                  <>
                    <select
                      value={newDay}
                      onChange={(e) => setNewDay(e.target.value)}
                      className="block rounded-md bg-gray-700 border-gray-600 text-gray-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border flex-1"
                    >
                      <option value="">Select weekday...</option>
                      {weekdays.map((day) => (
                        <option key={day} value={day}>{day}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={addDay}
                      disabled={!newDay}
                      className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:bg-gray-600 disabled:cursor-not-allowed"
                    >
                      Add Weekday
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
                      Add Date
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
                    <button
                      type="button"
                      onClick={() => removeDay(day)}
                      className="hover:text-blue-100"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {formData.days.length === 0 && (
                  <p className="text-sm text-gray-500 italic">No days added yet</p>
                )}
              </div>
            </div>

            {/* Time Slots Configuration */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Time Slots</label>
              <p className="text-xs text-gray-500 mb-3">
                Select a start time and duration for each time slot
              </p>
              <div className="flex gap-2 mb-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-400 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={newTimeSlot}
                    onChange={(e) => setNewTimeSlot(e.target.value)}
                    className="block w-full rounded-md bg-gray-700 border-gray-600 text-gray-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-400 mb-1">Duration</label>
                  <select
                    value={newDuration}
                    onChange={(e) => setNewDuration(parseInt(e.target.value))}
                    className="block w-full rounded-md bg-gray-700 border-gray-600 text-gray-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                  >
                    <option value="120">2 hours</option>
                    <option value="90">1.5 hours</option>
                    <option value="60">1 hour</option>
                    <option value="30">30 minutes</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={addTimeSlot}
                  disabled={!newTimeSlot}
                  className="self-end rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:bg-gray-600 disabled:cursor-not-allowed"
                >
                  Add Time
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.timeSlots.map((slot) => (
                  <span
                    key={slot}
                    className="inline-flex items-center gap-1 rounded-full bg-green-900 px-3 py-1 text-sm font-semibold text-green-300"
                  >
                    {formatTimeSlot(slot)}
                    <button
                      type="button"
                      onClick={() => removeTimeSlot(slot)}
                      className="hover:text-green-100"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {formData.timeSlots.length === 0 && (
                  <p className="text-sm text-gray-400">No time slots added yet</p>
                )}
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                type="submit"
                className="inline-flex justify-center rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500"
              >
                {editingId ? 'Update' : 'Create'} Booking Job
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex justify-center rounded-md bg-gray-700 px-3 py-2 text-sm font-semibold text-gray-100 shadow-sm ring-1 ring-inset ring-gray-600 hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="mt-8 flow-root">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-gray-700 sm:rounded-lg">
              <table className="min-w-full divide-y divide-gray-700 bg-gray-800">
                <thead className="bg-gray-900">
                  <tr>
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-100">Name</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-100">Account</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-100">Type</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-100">Status</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-100">Last Run</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-100">Bookings</th>
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
                          <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-100">
                            {job.name}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-400">
                            {job.account.name}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-400 capitalize">
                            {job.recurrence}
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
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-400">
                            {job.lastRun ? new Date(job.lastRun).toLocaleString() : 'Never'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-400">
                            {job._count.reservations}
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
                                <h3 className="text-sm font-semibold text-gray-100 mb-3">Run History</h3>
                                {loadingHistory ? (
                                  <div className="text-sm text-gray-400">Loading history...</div>
                                ) : !Array.isArray(runHistory) || runHistory.length === 0 ? (
                                  <div className="text-sm text-gray-400">No run history yet. Run the scheduler to see results here.</div>
                                ) : (
                                  <div className="space-y-2 max-h-96 overflow-y-auto">
                                    {runHistory.map((run) => {
                                      let attempts: BookingAttempt[] = []
                                      try {
                                        attempts = JSON.parse(run.attempts)
                                      } catch (e) {
                                        console.error('Failed to parse attempts:', e)
                                      }
                                      return (
                                        <div key={run.id} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                                          <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-3">
                                              <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusColor(run.status)}`}>
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
                                                <div key={idx} className="flex items-center justify-between text-xs py-1 px-2 bg-gray-700 rounded">
                                                  <div className="flex items-center gap-2">
                                                    <span className={attempt.success ? 'text-green-400' : 'text-gray-500'}>
                                                      {attempt.success ? '✓' : '✗'}
                                                    </span>
                                                    <span className="text-gray-300">{attempt.date}</span>
                                                    <span className="text-gray-400">at {attempt.timeSlot}</span>
                                                    {attempt.duration && (
                                                      <span className="text-gray-500">({attempt.duration}min)</span>
                                                    )}
                                                  </div>
                                                  <div className="flex items-center gap-2">
                                                    {attempt.courtId && (
                                                      <span className="text-blue-400">Court {attempt.courtId}</span>
                                                    )}
                                                    <span className={attempt.success ? 'text-green-400' : 'text-gray-500'}>
                                                      {attempt.message}
                                                    </span>
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          ) : (
                                            <div className="text-xs text-gray-500 italic">No detailed attempts recorded</div>
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
