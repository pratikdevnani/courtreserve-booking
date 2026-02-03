'use client'

import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'

type Reservation = {
  id: string
  accountId: string
  venue: string
  courtId?: string
  date: string
  startTime: string
  duration: number
  bookedAt: string
  source: 'portal' | 'external'
  externalId?: string
  confirmationNumber?: string
  account: {
    id: string
    name: string
    email: string
  }
  bookingJob?: {
    id: string
    name: string
  }
}

export default function ReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)
  const [filterVenue, setFilterVenue] = useState<string>('')
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null)
  const [cancellationReason, setCancellationReason] = useState('')

  useEffect(() => {
    fetchReservations()
  }, [filterVenue])

  const fetchReservations = async () => {
    try {
      let url = '/api/reservations'
      if (filterVenue) {
        url += `?venue=${filterVenue}`
      }

      const res = await fetch(url)
      const data = await res.json()
      setReservations(data)
    } catch (error) {
      // Error handled silently - user sees empty state
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = (reservation: Reservation) => {
    setSelectedReservation(reservation)
    setCancellationReason('')
    setCancelModalOpen(true)
  }

  const confirmCancellation = async () => {
    if (!selectedReservation || !cancellationReason.trim()) {
      alert('Please provide a cancellation reason')
      return
    }

    try {
      const res = await fetch(`/api/reservations/${selectedReservation.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cancellationReason: cancellationReason.trim(),
        }),
      })

      if (res.ok) {
        setCancelModalOpen(false)
        setSelectedReservation(null)
        setCancellationReason('')
        await fetchReservations()
      } else {
        const error = await res.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      // Error shown via alert
      alert('Failed to delete reservation')
    }
  }

  const formatDateTime = (date: string, time: string) => {
    try {
      const [hours, minutes] = time.split(':')
      const dateTime = new Date(`${date}T${hours}:${minutes}:00`)
      return format(dateTime, 'MMM dd, yyyy - h:mm a')
    } catch {
      return `${date} ${time}`
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-300">Loading...</div>
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-3xl font-semibold text-gray-100">Reservations</h1>
          <p className="mt-2 text-sm text-gray-400">
            Upcoming reservations
          </p>
        </div>
        <div className="mt-4 sm:mt-0 sm:ml-16">
          <select
            value={filterVenue}
            onChange={(e) => setFilterVenue(e.target.value)}
            className="block rounded-md bg-gray-700 border-gray-600 text-gray-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
          >
            <option value="">All Venues</option>
            <option value="sunnyvale">Sunnyvale</option>
            <option value="santa_clara">Santa Clara</option>
          </select>
        </div>
      </div>

      <div className="mt-8 flow-root">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-gray-700 sm:rounded-lg">
              <table className="min-w-full divide-y divide-gray-700 bg-gray-800">
                <thead className="bg-gray-900">
                  <tr>
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-100">Account</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-100">Venue</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-100">Date & Time</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-100">Duration</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-100">Court</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-100">Booking Job</th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700 bg-gray-800">
                  {reservations.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">
                        No reservations found
                      </td>
                    </tr>
                  ) : (
                    reservations.map((reservation) => (
                      <tr key={reservation.id}>
                        <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm">
                          <div className="flex items-center gap-2">
                            <div>
                              <div className="font-medium text-gray-100">{reservation.account.name}</div>
                              <div className="text-gray-400">{reservation.account.email}</div>
                            </div>
                            {reservation.source === 'external' && (
                              <span className="inline-flex items-center rounded-md bg-blue-400/10 px-2 py-1 text-xs font-medium text-blue-400 ring-1 ring-inset ring-blue-400/30">
                                External
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-300 capitalize">
                          {reservation.venue.replace('_', ' ')}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-300">
                          {formatDateTime(reservation.date, reservation.startTime)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-300">
                          {reservation.duration} min
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-300">
                          {reservation.courtId || 'N/A'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-300">
                          {reservation.bookingJob ? (
                            <a
                              href={`/booking-jobs`}
                              className="text-indigo-400 hover:text-indigo-300"
                            >
                              {reservation.bookingJob.name}
                            </a>
                          ) : (
                            <span className="text-gray-500">Manual</span>
                          )}
                        </td>
                        <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                          <button
                            onClick={() => handleDelete(reservation)}
                            className="text-red-400 hover:text-red-300"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {reservations.length > 0 && (
        <div className="mt-4 text-sm text-gray-400">
          Total: {reservations.length} reservation{reservations.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Cancellation Modal */}
      {cancelModalOpen && selectedReservation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md border border-gray-700">
            <h2 className="text-xl font-semibold text-gray-100 mb-4">Cancel Reservation</h2>
            <div className="mb-4">
              <p className="text-sm text-gray-300 mb-2">
                You are about to cancel the following reservation:
              </p>
              <div className="bg-gray-900 rounded p-3 mb-3 text-sm">
                <div className="text-gray-300">
                  <strong>{selectedReservation.account.name}</strong> - {selectedReservation.venue.replace('_', ' ')}
                </div>
                <div className="text-gray-400">
                  {formatDateTime(selectedReservation.date, selectedReservation.startTime)} ({selectedReservation.duration} min)
                </div>
                {selectedReservation.courtId && (
                  <div className="text-gray-400">Court {selectedReservation.courtId}</div>
                )}
              </div>
              <label htmlFor="cancellationReason" className="block text-sm font-medium text-gray-300 mb-2">
                Cancellation Reason <span className="text-red-400">*</span>
              </label>
              <input
                id="cancellationReason"
                type="text"
                value={cancellationReason}
                onChange={(e) => setCancellationReason(e.target.value)}
                placeholder="e.g., Schedule conflict, Weather, etc."
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                autoFocus
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setCancelModalOpen(false)
                  setSelectedReservation(null)
                  setCancellationReason('')
                }}
                className="px-4 py-2 bg-gray-700 text-gray-300 rounded-md hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmCancellation}
                disabled={!cancellationReason.trim()}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
