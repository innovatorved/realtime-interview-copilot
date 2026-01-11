# Realtime Worker API - Complete Documentation

> Cloudflare Worker backend API for Realtime Interview Copilot.  
> **Version**: 0.1.0  
> **Production URL**: `https://realtime-worker-api-prod.vedgupta.in`

---

## Overview

The `realtime-worker-api` is a Cloudflare Worker that powers the backend of Realtime Interview Copilot. It handles:
- 🎤 Deepgram temporary API key generation
- 🤖 AI completion streaming via Google Gemini
- 🔐 User authentication with Better Auth
- 📊 LLM analytics tracking with PostHog

---

## Architecture

```
realtime-worker-api/
├── src/
│   ├── index.ts         # Main API routes & handlers
│   ├── auth.ts          # Better Auth configuration
│   ├── crypto.ts        # Password hashing utilities
│   ├── posthog.ts       # Analytics tracking
│   └── db/
│       ├── index.ts     # Drizzle ORM setup
│       └── schema.ts    # Database schema
├── drizzle/             # Database migrations
├── wrangler.toml        # Cloudflare config
└── package.json
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| ORM | Drizzle ORM |
| Auth | Better Auth |
| AI | Google Gemini API |
| Transcription | Deepgram API |
| Analytics | PostHog |

---

## Quick Start

### 1. Install Dependencies
```bash
cd realtime-worker-api
pnpm install
```

### 2. Configure Environment Variables
Create `.dev.vars` file:
```bash
DEEPGRAM_API_KEY=your_deepgram_key
GOOGLE_GENERATIVE_AI_API_KEY=your_google_ai_key
BETTER_AUTH_SECRET=your_auth_secret
BETTER_AUTH_URL=http://localhost:8787
POSTHOG_API_KEY=your_posthog_key      # Optional
POSTHOG_HOST=https://eu.i.posthog.com # Optional
GEMINI_MODEL=gemini-flash-lite-latest # Optional
```

### 3. Setup Database
```bash
# Create D1 database
npx wrangler d1 create realtime-interview-copilot-db

# Update wrangler.toml with database_id

# Generate migrations
npx drizzle-kit generate

# Apply migrations (local)
npx wrangler d1 migrations apply realtime-interview-copilot-db --local

# Apply migrations (production)
npx wrangler d1 migrations apply realtime-interview-copilot-db --remote
```

### 4. Run Development Server
```bash
pnpm dev
# or
npx wrangler dev
```

### 5. Deploy to Production
```bash
pnpm deploy
# or
npx wrangler deploy
```

---

## API Endpoints

### Base URLs
- **Development**: `http://localhost:8787`
- **Production**: `https://realtime-worker-api-prod.vedgupta.in`

---

### `POST /api/deepgram`

Generate a temporary Deepgram API key for client-side transcription.

**Request:**
```http
POST /api/deepgram
Content-Type: application/json
```

**Response:**
```json
{
  "key": "temporary_api_key_here",
  "key_id": "uuid",
  "comment": "Temporary API key",
  "scopes": ["usage:write"],
  "time_to_live_in_seconds": 60
}
```

**Error Response:**
```json
{
  "error": "Missing DEEPGRAM_API_KEY binding"
}
```

---

### `POST /api/completion`

Stream AI-generated responses using Google Gemini.

**Request:**
```http
POST /api/completion
Content-Type: application/json

{
  "bg": "Interview context (optional)",
  "flag": "copilot | summerizer",
  "prompt": "The conversation transcript"
}
```

**Flags:**
| Flag | Behavior |
|------|----------|
| `copilot` | Generates structured interview answers |
| `summerizer` | Generates conversation summary |
| *(other)* | Raw prompt to Gemini |

**Response (SSE Stream):**
```
data: {"text": "Here is my "}

data: {"text": "response..."}

data: [DONE]
```

**Error Response:**
```
data: {"error": "API Error: 500 Internal Server Error"}
```

---

### `POST /api/auth/*`

Better Auth endpoints for authentication.

| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/sign-up/email` | Register new user |
| `POST /api/auth/sign-in/email` | Login user |
| `POST /api/auth/sign-out` | Logout user |
| `GET /api/auth/session` | Get current session |

**Sign Up Example:**
```http
POST /api/auth/sign-up/email
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "securepassword"
}
```

---

## Database Schema

### Tables

#### `user`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key (UUID) |
| name | TEXT | User's display name |
| email | TEXT | Unique email address |
| emailVerified | INTEGER | Email verification status |
| isApproved | INTEGER | Admin approval status |
| image | TEXT | Profile image URL |
| createdAt | INTEGER | Timestamp |
| updatedAt | INTEGER | Timestamp |

#### `session`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key |
| expiresAt | INTEGER | Session expiry timestamp |
| token | TEXT | Unique session token |
| ipAddress | TEXT | Client IP |
| userAgent | TEXT | Client user agent |
| userId | TEXT | Foreign key to user |

#### `account`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key |
| accountId | TEXT | Provider account ID |
| providerId | TEXT | Auth provider name |
| userId | TEXT | Foreign key to user |
| password | TEXT | Hashed password |
| accessToken | TEXT | OAuth access token |
| refreshToken | TEXT | OAuth refresh token |

#### `verification`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key |
| identifier | TEXT | Verification identifier |
| value | TEXT | Verification value |
| expiresAt | INTEGER | Expiry timestamp |

---

## Environment Variables

### Required
| Variable | Description |
|----------|-------------|
| `DEEPGRAM_API_KEY` | Deepgram API key for transcription |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI API key for Gemini |
| `BETTER_AUTH_SECRET` | Secret for auth token signing |
| `BETTER_AUTH_URL` | Base URL for auth |
| `DB` | D1 database binding (auto-configured) |

### Optional
| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_MODEL` | `gemini-flash-lite-latest` | Gemini model to use |
| `POSTHOG_API_KEY` | - | PostHog API key for analytics |
| `POSTHOG_HOST` | `https://eu.i.posthog.com` | PostHog host URL |

---

## wrangler.toml Configuration

```toml
name = "realtime-worker-api-prod"
main = "src/index.ts"
compatibility_date = "2025-03-25"
compatibility_flags = ["nodejs_compat"]

[observability]
enabled = true

[[d1_databases]]
binding = "DB"
database_name = "realtime-interview-copilot-db"
database_id = "your-database-id-here"
migrations_dir = "drizzle"
```

---

## PostHog Analytics

The API tracks LLM generation events with:
- Trace ID
- Model name
- Input prompt
- Output response
- Latency
- Error status

Events are captured under:
- **Event**: `$ai_generation`
- **Provider**: `gemini`

---

## CORS Configuration

The API supports CORS with:
- Dynamic origin matching
- Credentials allowed
- Methods: `GET, POST, OPTIONS`
- Headers: `Content-Type, Authorization`
- Max age: 86400 seconds

---

## Commands Reference

```bash
# Development
pnpm dev                    # Start local server

# Database
npx drizzle-kit generate    # Generate migrations
npx drizzle-kit studio      # Open Drizzle Studio
npx wrangler d1 migrations apply <name> --local   # Apply local
npx wrangler d1 migrations apply <name> --remote  # Apply remote

# Deployment
pnpm deploy                 # Deploy to Cloudflare

# Utilities
npx wrangler whoami         # Check auth status
npx wrangler tail           # View live logs
```

---

## Troubleshooting

### Database Connection Issues
```bash
# Verify database exists
npx wrangler d1 list

# Check migrations
npx wrangler d1 migrations list <database-name>
```

### API Key Errors
- Verify environment variables in `.dev.vars` (local)
- Check Cloudflare dashboard secrets (production)

### CORS Issues
- Ensure client origin is allowed
- Check preflight OPTIONS handling

### Deployment Fails
```bash
# Re-login
npx wrangler login

# Check errors
npx wrangler deploy --dry-run
```
