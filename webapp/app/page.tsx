export default function Home() {
  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-100 sm:text-6xl">
          Court Booking Manager
        </h1>
        <p className="mt-6 text-lg leading-8 text-gray-300">
          Manage your court reservation accounts, view bookings, and schedule automated booking jobs.
        </p>
        <div className="mt-10 flex items-center justify-center gap-x-6">
          <a
            href="/accounts"
            className="rounded-md bg-indigo-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            Manage Accounts
          </a>
          <a
            href="/booking-jobs"
            className="rounded-md bg-green-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600"
          >
            Create Booking Job
          </a>
          <a href="/reservations" className="text-sm font-semibold leading-6 text-indigo-400 hover:text-indigo-300">
            View Reservations <span aria-hidden="true">→</span>
          </a>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-3">
          <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
            <h3 className="text-lg font-semibold text-gray-100 mb-2">Accounts</h3>
            <p className="text-gray-400">Add and manage booking accounts with credentials for different venues.</p>
          </div>
          <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
            <h3 className="text-lg font-semibold text-gray-100 mb-2">Reservations</h3>
            <p className="text-gray-400">View all reservations made by this software and delete them if needed.</p>
          </div>
          <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
            <h3 className="text-lg font-semibold text-gray-100 mb-2">Booking Jobs</h3>
            <p className="text-gray-400">Schedule one-time or recurring bookings with custom time slots and days.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
