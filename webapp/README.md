# Court Booking Manager - Web Application

A comprehensive web-based system for managing automated court reservations with support for multiple accounts, venues, and flexible scheduling.

## Features

- **Account Management**: Add and manage multiple booking accounts for different venues (Sunnyvale, Santa Clara)
- **Reservations Tracking**: View all reservations made by the system with filtering options
- **Booking Jobs**: Create one-time or recurring booking jobs with flexible configurations
- **Automated Scheduler**: Built-in cron scheduler that runs booking jobs automatically

## Quick Start with Docker

The easiest way to run the application:

```bash
# Build and start the application
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the application
docker-compose down
```

Access the web UI at: http://localhost:3000

## Local Development

### Prerequisites

- Node.js 20+
- Python 3.10+
- npm or yarn

### Setup

```bash
# Install dependencies
npm install

# Initialize database
npm run db:push

# Start development server
npm run dev

# In a separate terminal, start the scheduler (optional)
npm run scheduler
```

Access the UI at: http://localhost:3000

## Usage

### 1. Add Accounts

Navigate to **Accounts** page and add your CourtReserve credentials:
- Name (friendly identifier)
- Email and Password
- Venue (Sunnyvale or Santa Clara)

### 2. Create Booking Jobs

Navigate to **Booking Jobs** page and configure automated bookings:

**Job Configuration:**
- **Recurrence**: Once or Weekly
- **Slot Mode**: 
  - Single Slot: Books first available from your time list
  - Multi Slot: Books one slot per day specified
- **Days**: Weekday names or specific dates (YYYY-MM-DD)
- **Time Slots**: Preferred times in HH:MM format (e.g., 18:00, 18:30)

**Example: Weekly Monday/Wednesday**
```
Name: Weekly Pickleball
Recurrence: Weekly
Slot Mode: Multi Slot
Days: Monday, Wednesday
Time Slots: 18:00, 18:30, 19:00
```

### 3. View Reservations

Navigate to **Reservations** page to see all bookings made by the system.

## Architecture

- **Frontend**: Next.js 14 with TypeScript and Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: SQLite with Prisma ORM
- **Scheduler**: Node.js cron (runs daily at noon)
- **Booking Engine**: Python scripts for CourtReserve API integration

## Project Structure

```
webapp/
├── app/                      # Next.js App Router
│   ├── accounts/            # Account management UI
│   ├── reservations/        # Reservations UI
│   ├── booking-jobs/        # Booking jobs UI
│   └── api/                 # REST API endpoints
├── lib/                     # Shared utilities
│   ├── prisma.ts           # Database client
│   └── scheduler.ts        # Job scheduler logic
├── prisma/                  # Database schema
│   └── schema.prisma       # Prisma schema definition
├── scripts/                 # Utility scripts
│   └── start-scheduler.ts  # Standalone scheduler
├── Dockerfile              # Container configuration
├── docker-compose.yml      # Docker Compose setup
└── docker-entrypoint.sh    # Container startup script
```

## API Endpoints

### Accounts
- `GET /api/accounts` - List all accounts
- `POST /api/accounts` - Create account
- `PATCH /api/accounts/:id` - Update account
- `DELETE /api/accounts/:id` - Delete account

### Reservations
- `GET /api/reservations` - List reservations (supports `?venue=` and `?accountId=` filters)
- `POST /api/reservations` - Create reservation
- `DELETE /api/reservations/:id` - Delete reservation

### Booking Jobs
- `GET /api/booking-jobs` - List all booking jobs
- `POST /api/booking-jobs` - Create booking job
- `PATCH /api/booking-jobs/:id` - Update booking job
- `DELETE /api/booking-jobs/:id` - Delete booking job
- `POST /api/booking-jobs/:id/run` - Manually trigger a job

## Scheduler

The scheduler runs automatically every day at noon (12:00 PM) and:
1. Checks all active booking jobs
2. Determines which jobs need to run based on schedule
3. Executes Python booking scripts with job configuration
4. Records successful bookings in the database
5. Updates job status and next run time

### Manual Scheduler Execution

```bash
# Run scheduler once
npm run scheduler

# Or use the API
curl -X POST http://localhost:3000/api/booking-jobs/:id/run
```

## Docker Deployment

### Build and Run

```bash
# Using docker-compose (recommended)
docker-compose up -d

# Or build manually
docker build -t court-booking-manager .
docker run -d \
  --name court-booking \
  -p 3000:3000 \
  -v $(pwd)/data:/app/prisma \
  -v $(pwd)/data/cookies:/app/cookies \
  court-booking-manager
```

### Data Persistence

The Docker setup persists:
- **Database**: `./data/dev.db` (SQLite database)
- **Cookie Jars**: `./data/cookies/` (Session cookies for Python scripts)

## Environment Variables

Create a `.env` file:

```env
# Database
DATABASE_URL="file:./dev.db"

# Next.js
NODE_ENV=development
```

## Troubleshooting

### Database Issues

```bash
# Reset database
rm prisma/dev.db
npm run db:push

# View database
npm run db:studio
```

### Scheduler Not Running

Check logs:
```bash
docker-compose logs -f
```

Manually trigger:
```bash
npm run scheduler
```

### Python Script Errors

Test scripts manually:
```bash
export CR_EMAIL_1=your@email.com
export CR_PASSWORD_1=yourpassword
export CR_DATE=2025-01-15
export CR_START_TIME=18:00
export DEBUG=1
python3 ../book_court_sunnyvale.py
```

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run db:push` - Push schema changes to database
- `npm run db:studio` - Open Prisma Studio
- `npm run scheduler` - Start standalone scheduler

### Adding New Venues

1. Create a new Python booking script in parent directory
2. Update `lib/scheduler.ts` to include the new script path
3. Update venue options in UI components and API validation

## Security Notes

This is a single-user application designed for personal use:
- Passwords are stored in plain text (local SQLite)
- No authentication required for web UI
- Not suitable for multi-user or public deployment

For production use, implement:
- Password encryption
- User authentication
- HTTPS
- Environment-based secrets management

## License

MIT
