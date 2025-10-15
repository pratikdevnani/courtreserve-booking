# Quick Start Guide

## Docker Setup (Recommended)

```bash
# Navigate to webapp directory
cd webapp

# Start the application
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the application
docker-compose down
```

Access the UI at: **http://localhost:3000**

## Local Development Setup

```bash
# Navigate to webapp directory
cd webapp

# Install dependencies
npm install

# Initialize database
npm run db:push

# Start development server
npm run dev
```

The scheduler will run automatically in the Docker container. For local development, you can optionally run it separately:

```bash
# In a separate terminal
npm run scheduler
```

## First Steps

### 1. Add an Account (2 minutes)

1. Go to http://localhost:3000/accounts
2. Click **"Add Account"**
3. Fill in:
   - **Name**: "My Main Account" (or any friendly name)
   - **Email**: Your CourtReserve email
   - **Password**: Your CourtReserve password
   - **Venue**: Select "Sunnyvale" or "Santa Clara"
4. Click **"Create"**

### 2. Create a Booking Job (3 minutes)

1. Go to http://localhost:3000/booking-jobs
2. Click **"Add Booking Job"**
3. Configure:
   - **Job Name**: "Weekly Pickleball"
   - **Account**: Select the account you just created
   - **Venue**: Match your account's venue
   - **Recurrence**: "Weekly"
   - **Slot Mode**: "Multi Slot"
   - **Days**: Click "Add Day" and select "Monday" and "Wednesday"
   - **Time Slots**: Click "Add Time Slot" and add "18:00", "18:30", "19:00"
4. Click **"Create Booking Job"**

### 3. View Results

Go to http://localhost:3000/reservations to see bookings made by the system.

## Example Configurations

### Weekly Evening Sessions
```
Name: Weekly Pickleball
Recurrence: Weekly
Slot Mode: Multi Slot
Days: Monday, Wednesday, Friday
Time Slots: 18:00, 18:30, 19:00
```
Books one court each day at the first available time.

### One-Time Weekend Booking
```
Name: Weekend Tournament
Recurrence: Once
Slot Mode: Single Slot
Days: 2025-01-20, 2025-01-21
Time Slots: 10:00, 11:00
```
Books ONE court across both days.

### Daily Morning Slots
```
Name: Morning Sessions
Recurrence: Weekly
Slot Mode: Multi Slot
Days: Monday, Tuesday, Wednesday, Thursday, Friday
Time Slots: 07:00, 07:30, 08:00
```
Books one court each weekday morning.

## How the Scheduler Works

- **Automatic**: Runs daily at noon (12:00 PM)
- **Smart**: Only runs jobs that are due based on their schedule
- **Persistent**: Records all booking attempts and results
- **Manual Trigger**: You can also manually trigger jobs from the UI

## Troubleshooting

### Database Issues
```bash
cd webapp
rm prisma/dev.db
npm run db:push
```

### View Database
```bash
cd webapp
npm run db:studio
```

### Test Python Scripts Manually
```bash
export CR_EMAIL_1=your@email.com
export CR_PASSWORD_1=yourpassword
export CR_DATE=2025-01-15
export CR_START_TIME=18:00
export DEBUG=1
python3 ../book_court_sunnyvale.py
```

### Docker Logs
```bash
docker-compose logs -f
```

## Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Explore the API endpoints
- Customize booking scripts for your needs
- Set up multiple accounts for different venues

## Support

For issues or questions:
- Check the logs: `docker-compose logs -f` (Docker) or terminal output (local)
- View the database: `npm run db:studio`
- Read the [README.md](README.md) for detailed documentation
