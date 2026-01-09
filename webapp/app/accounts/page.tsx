'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Account = {
  id: string
  name: string
  email: string
  venue: string
  isResident: boolean
  active: boolean
  createdAt: string
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    venue: 'sunnyvale',
    isResident: true,
    active: true,
  })

  useEffect(() => {
    fetchAccounts()
  }, [])

  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/accounts')
      const data = await res.json()
      setAccounts(data)
    } catch (error) {
      // Error handled silently - user sees empty state
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      const url = editingId ? `/api/accounts/${editingId}` : '/api/accounts'
      const method = editingId ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (res.ok) {
        await fetchAccounts()
        setShowForm(false)
        setEditingId(null)
        setFormData({ name: '', email: '', password: '', venue: 'sunnyvale', isResident: true, active: true })
      } else {
        const error = await res.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      // Error shown via alert
      alert('Failed to save account')
    }
  }

  const handleEdit = (account: Account) => {
    setFormData({
      name: account.name,
      email: account.email,
      password: '', // Don't populate password for security
      venue: account.venue,
      isResident: account.isResident,
      active: account.active,
    })
    setEditingId(account.id)
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this account? This will also delete all associated reservations and booking jobs.')) {
      return
    }

    try {
      const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' })

      if (res.ok) {
        await fetchAccounts()
      } else {
        const error = await res.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      // Error shown via alert
      alert('Failed to delete account')
    }
  }

  const handleTestConnection = async () => {
    if (!formData.email || !formData.password) {
      alert('Please enter email and password first')
      return
    }

    setTesting(true)
    setTestResult(null)

    try {
      const res = await fetch('/api/accounts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          venue: formData.venue,
        }),
      })

      const data = await res.json()

      if (res.ok && data.success) {
        setTestResult({ success: true, message: data.message })
      } else {
        setTestResult({ success: false, message: data.error || 'Connection test failed' })
      }
    } catch (error) {
      // Error shown via testResult
      setTestResult({ success: false, message: 'Failed to test connection' })
    } finally {
      setTesting(false)
    }
  }

  const cancelEdit = () => {
    setShowForm(false)
    setEditingId(null)
    setTestResult(null)
    setFormData({ name: '', email: '', password: '', venue: 'sunnyvale', isResident: true, active: true })
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-300">Loading...</div>
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-3xl font-semibold text-gray-100">Accounts</h1>
          <p className="mt-2 text-sm text-gray-400">
            Manage booking accounts for different venues
          </p>
        </div>
        <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
          <button
            onClick={() => setShowForm(true)}
            className="block rounded-md bg-indigo-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
          >
            Add Account
          </button>
        </div>
      </div>

      {showForm && (
        <div className="mt-8 bg-gray-800 shadow rounded-lg p-6 border border-gray-700">
          <h2 className="text-lg font-medium text-gray-100 mb-4">
            {editingId ? 'Edit Account' : 'New Account'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300">Name</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="mt-1 block w-full rounded-md bg-gray-700 border-gray-600 text-gray-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300">Email</label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="mt-1 block w-full rounded-md bg-gray-700 border-gray-600 text-gray-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300">
                Password {editingId && '(leave blank to keep current)'}
              </label>
              <input
                type="password"
                required={!editingId}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="mt-1 block w-full rounded-md bg-gray-700 border-gray-600 text-gray-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
              />
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
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={formData.isResident}
                onChange={(e) => setFormData({ ...formData, isResident: e.target.checked })}
                className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
              />
              <label className="ml-2 text-sm text-gray-300">
                Sunnyvale Resident
                <span className="text-gray-400 text-xs ml-2">
                  (Residents can book 1 day further ahead)
                </span>
              </label>
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={formData.active}
                onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
              />
              <label className="ml-2 block text-sm text-gray-300">Active</label>
            </div>

            {/* Test Connection Section */}
            <div className="border-t border-gray-700 pt-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testing || !formData.email || !formData.password}
                  className="inline-flex items-center justify-center rounded-md bg-yellow-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-yellow-500 disabled:bg-gray-600 disabled:cursor-not-allowed"
                >
                  {testing ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Testing...
                    </>
                  ) : (
                    'Test Connection'
                  )}
                </button>
                {testResult && (
                  <span className={`text-sm font-medium ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
                    {testResult.success ? '✓ ' : '✗ '}
                    {testResult.message}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Test your credentials before saving to ensure they work correctly.
              </p>
            </div>

            <div className="flex space-x-3">
              <button
                type="submit"
                className="inline-flex justify-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
              >
                {editingId ? 'Update' : 'Create'}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
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
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-100">Email</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-100">Venue</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-100">Status</th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700 bg-gray-800">
                  {accounts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-sm text-gray-400">
                        No accounts yet. Click &quot;Add Account&quot; to create one.
                      </td>
                    </tr>
                  ) : (
                    accounts.map((account) => (
                      <tr key={account.id}>
                        <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-100">
                          {account.name}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-300">{account.email}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-300 capitalize">
                          {account.venue.replace('_', ' ')}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-300">
                          <span
                            className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                              account.active
                                ? 'bg-green-900 text-green-300'
                                : 'bg-red-900 text-red-300'
                            }`}
                          >
                            {account.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                          <button
                            onClick={() => handleEdit(account)}
                            className="text-indigo-400 hover:text-indigo-300 mr-4"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(account.id)}
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
    </div>
  )
}
