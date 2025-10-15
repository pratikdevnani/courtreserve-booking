import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'

// POST /api/accounts/test - Test account credentials
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password, venue } = body

    if (!email || !password || !venue) {
      return NextResponse.json(
        { error: 'Missing required fields: email, password, venue' },
        { status: 400 }
      )
    }

    // Validate venue
    if (!['sunnyvale', 'santa_clara'].includes(venue)) {
      return NextResponse.json(
        { error: 'Venue must be either "sunnyvale" or "santa_clara"' },
        { status: 400 }
      )
    }

    // Get the Python script path
    const ROOT_DIR = path.resolve(process.cwd(), '..')
    const scriptPath = venue === 'sunnyvale'
      ? path.join(ROOT_DIR, 'book_court_sunnyvale.py')
      : path.join(ROOT_DIR, 'book_court_santa_clara.py')

    // Test the login by running a minimal version of the script
    // We'll just try to login without actually booking anything
    const testResult = await testCredentials(scriptPath, email, password)

    if (testResult.success) {
      return NextResponse.json({
        success: true,
        message: 'Login successful! Credentials are valid.',
      })
    } else {
      return NextResponse.json(
        {
          success: false,
          error: testResult.error || 'Login failed. Please check your credentials.',
        },
        { status: 401 }
      )
    }
  } catch (error) {
    console.error('Error testing account:', error)
    return NextResponse.json(
      { error: 'Failed to test account credentials' },
      { status: 500 }
    )
  }
}

async function testCredentials(
  scriptPath: string,
  email: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    // Create a simple Python script that just tests login
    const testScript = `
import sys
import json
import requests

email = "${email.replace(/"/g, '\\"')}"
password = "${password.replace(/"/g, '\\"')}"
org_id = "13233" if "sunnyvale" in "${scriptPath}" else "13234"

try:
    s = requests.Session()
    s.headers.update({"User-Agent": "Mozilla/5.0"})

    # Try to login
    lp = f"https://app.courtreserve.com/Online/Account/LogIn/{org_id}"
    s.get(lp, allow_redirects=True)

    body = {"IsApiCall": True, "UserNameOrEmail": email, "Password": password}
    url = f"https://app.courtreserve.com/Online/Account/Login?id={org_id}"
    r = s.post(url,
              headers={"Content-Type": "application/json",
                       "Referer": lp,
                       "reactsubmit": "true"},
              data=json.dumps(body))

    result = r.json()
    if result.get("IsValid"):
        print("SUCCESS")
        sys.exit(0)
    else:
        print("INVALID_CREDENTIALS")
        sys.exit(1)
except Exception as e:
    print(f"ERROR: {str(e)}")
    sys.exit(2)
`

    const python = spawn('python3', ['-c', testScript])
    let output = ''
    let errorOutput = ''

    python.stdout.on('data', (data) => {
      output += data.toString()
    })

    python.stderr.on('data', (data) => {
      errorOutput += data.toString()
    })

    // Set a timeout of 15 seconds
    const timeout = setTimeout(() => {
      python.kill()
      resolve({
        success: false,
        error: 'Connection test timed out. Please try again.',
      })
    }, 15000)

    python.on('close', (code) => {
      clearTimeout(timeout)

      if (output.includes('SUCCESS')) {
        resolve({ success: true })
      } else if (output.includes('INVALID_CREDENTIALS')) {
        resolve({
          success: false,
          error: 'Invalid credentials. Please check your email and password.',
        })
      } else {
        resolve({
          success: false,
          error: errorOutput || 'Failed to connect. Please try again.',
        })
      }
    })
  })
}
