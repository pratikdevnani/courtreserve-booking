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
      console.error('Error fetching reservations:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this reservation?')) {
      return
    }

    try {
      const res = await fetch(`/api/reservations/${id}`, { method: 'DELETE' })

      if (res.ok) {
        await fetchReservations()
      } else {
        const error = await res.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error('Error deleting reservation:', error)
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
            All reservations made by this software
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
                          <div className="font-medium text-gray-100">{reservation.account.name}</div>
                          <div className="text-gray-400">{reservation.account.email}</div>
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
                            onClick={() => handleDelete(reservation.id)}
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
    </div>
  )
}
