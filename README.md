# Court Booking Manager

A comprehensive web-based system for managing automated court reservations with support for multiple accounts, venues, and flexible scheduling.

## Features

- **Account Management**: Add and manage multiple booking accounts for different venues (Sunnyvale, Santa Clara)
- **Reservations Tracking**: View all reservations made by the system with filtering options
- **Booking Jobs**: Create one-time or recurring booking jobs with flexible configurations
- **Automated Scheduler**: Built-in cron scheduler that runs booking jobs automatically

## Quick Start

### Docker (Recommended)

```bash
cd webapp
docker-compose up -d
```

Access the web UI at: http://localhost:3000

### Local Development

```bash
cd webapp
npm install
npm run db:push
npm run dev
```

For detailed documentation, see [webapp/README.md](webapp/README.md)

## Project Structure

```
.
├── webapp/                    # Next.js web application (see webapp/README.md)
│   ├── app/                   # App router pages and API routes
│   ├── lib/                   # Shared utilities and scheduler
│   ├── prisma/               # Database schema
│   ├── scripts/              # Utility scripts
│   ├── Dockerfile            # Container configuration
│   └── docker-compose.yml    # Docker Compose setup
├── book_court_sunnyvale.py    # Sunnyvale booking script
└── book_court_santa_clara.py  # Santa Clara booking script
```

## Documentation

- [Webapp Documentation](webapp/README.md) - Complete guide for the web application
- [Python Booking Scripts](book_court_sunnyvale.py) - Standalone booking scripts

## License

MIT
