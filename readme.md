# Pennytor Backend

Financial Investment Platform — NestJS Backend API

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 10.4 (TypeScript) |
| Database | PostgreSQL 15+ via Prisma 5.19 ORM |
| Authentication | JWT (HS256) + Passport + opaque refresh tokens (SHA-256-hashed) |
| Email | Brevo REST API + Handlebars templates |
| Validation | class-validator + class-transformer + Joi (env vars) |
| Security | helmet, bcrypt, rate limiting (@nestjs/throttler), HttpOnly cookies |
| API Docs | Swagger/OpenAPI (@nestjs/swagger) |

---

## Project Structure

```
backend/
├── prisma/
│   ├── schema.prisma              # Database schema (SOURCE OF TRUTH)
│   └── migrations/                # Auto-generated migration history
│
├── src/
│   ├── main.ts                    # App bootstrap (listen, middleware, Swagger)
│   ├── app.module.ts              # Root module — wires all modules together
│   │
│   ├── config/
│   │   ├── config.module.ts       # @nestjs/config with Joi env validation
│   │   └── validation.schema.ts   # Joi rules for every env variable
│   │
│   ├── database/
│   │   ├── prisma.module.ts       # @Global PrismaModule
│   │   ├── prisma.service.ts      # PrismaClient wrapper (connect/disconnect)
│   │   └── seed.ts                # Database seed (creates admin with a referral code)
│   │
│   ├── common/
│   │   ├── decorators/
│   │   │   ├── roles.decorator.ts           # @Roles() metadata decorator
│   │   │   └── is-strong-password.decorator.ts  # Custom password validation
│   │   └── filters/
│   │       └── http-exception.filter.ts     # Global exception handler
│   │
│   ├── guards/
│   │   └── roles.guard.ts         # Role-based authorization (prepared, not active)
│   │
│   └── modules/
│       ├── auth/                  # Authentication module (largest module)
│       │   ├── auth.module.ts
│       │   ├── auth.controller.ts  # 10 API routes
│       │   ├── auth.service.ts     # Core auth logic
│       │   ├── refresh-token.service.ts  # Opaque refresh token management
│       │   ├── guards/
│       │   │   └── jwt-auth.guard.ts
│       │   ├── strategies/
│       │   │   └── jwt.strategy.ts  # Passport JWT strategy (HS256)
│       │   └── dto/                # 9 DTOs with validation decorators
│       │
│       ├── users/
│       │   ├── users.module.ts
│       │   └── users.service.ts    # User CRUD + referral codes
│       │
│       ├── otp/
│       │   ├── otp.module.ts
│       │   └── otp.service.ts      # OTP generate/verify (bcrypt-hashed)
│       │
│       ├── mail/
│       │   ├── mail.module.ts
│       │   ├── mail.service.ts     # Brevo API email sender
│       │   └── templates/          # Handlebars email templates
│       │
│       └── audit/
│           ├── audit.module.ts     # @Global audit module
│           └── audit.service.ts    # Fire-and-forget audit logging
│
└── test/
    └── jest-e2e.json
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 15+
- A Brevo account (for transactional email)

### Installation

```bash
cd backend
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

**Required variables:**

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/pennytor` |
| `FRONTEND_URL` | Frontend origin for CORS | `http://localhost:3000` |
| `BREVO_API_KEY` | Brevo transactional email API key | `xkeysib-...` |
| `MAIL_FROM` | Sender email address | `no-reply@pennytor.com` |
| `JWT_ACCESS_SECRET` | HS256 signing key (64+ chars) | `openssl rand -base64 64` |

**Optional variables (with defaults):**

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development` / `production` / `test` |
| `PORT` | `3001` | Server port |
| `BCRYPT_SALT_ROUNDS` | `12` | Password hashing cost (10-15) |
| `OTP_EXPIRY_MINUTES` | `5` | OTP validity window |
| `OTP_MAX_ATTEMPTS` | `5` | Max OTP verification attempts |
| `OTP_LENGTH` | `6` | OTP digit count |
| `THROTTLE_TTL_SECONDS` | `60` | Rate limit window |
| `THROTTLE_LIMIT` | `10` | Max requests per window |
| `JWT_ACCESS_EXPIRY` | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRY_DAYS` | `30` | Refresh token lifetime (days) |
| `PASSWORD_RESET_EXPIRY_MINUTES` | `15` | Reset token lifetime |
| `ADMIN_EMAIL` | `admin@pennytor.com` | Admin email used by `npm run db:seed` |
| `ADMIN_PASSWORD` | `Admin@1234` | Admin password used by `npm run db:seed` |
| `ADMIN_FIRST_NAME` | `Admin` | Admin first name |
| `ADMIN_LAST_NAME` | `Pennytor` | Admin last name |

### Database Setup

```bash
# Generate Prisma client
npm run db:generate

# Run migrations (creates tables)
npm run db:migrate

# (Optional) Seed the database
npm run db:seed

# (Optional) Open Prisma Studio (visual DB browser)
npm run db:studio
```

### Running the App

```bash
# Development (with hot-reload)
npm run start:dev

# Production
npm run build
npm run start:prod
```

The server starts at `http://localhost:3001` by default.

### Swagger API Docs

Available at `http://localhost:3001/docs` in non-production environments.

---

## API Reference

All routes are prefixed with `/api`. Auth routes are under `/api/auth/`.

### Authentication Endpoints

| Method | Route | Rate Limit | Auth | Description |
|---|---|---|---|---|
| `POST` | `/api/auth/register` | 5/60s | No | Create a new account |
| `GET` | `/api/auth/check-email` | 30/60s | No | Real-time email availability check (used by the register form) |
| `POST` | `/api/auth/login` | 10/60s | No | Log in (sets refresh cookie) |
| `POST` | `/api/auth/verify-email` | 10/60s | No | Verify email with 6-digit OTP |
| `POST` | `/api/auth/refresh` | 10/60s | No | Refresh access token (reads cookie) |
| `POST` | `/api/auth/logout` | 10/60s | JWT | Log out (single or all sessions) |
| `POST` | `/api/auth/resend-otp` | 3/60s | No | Resend email verification OTP |
| `POST` | `/api/auth/forgot-password` | 3/60s | No | Request password reset link |
| `POST` | `/api/auth/reset-password` | 5/60s | No | Reset password with token |
| `POST` | `/api/auth/change-password` | 5/60s | JWT | Change password (authenticated) |

### Request/Response Details

#### POST /api/auth/register

```json
// Request Body
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "password": "Str0ng!Pass",
  "referralCode": "AB12CD34",             // required — user accounts must be invited
  "acceptTerms": true,              // required — must be true
  "marketingEmails": false          // optional
}

// Response 201 — created
{
  "message": "Registration successful. Please verify your email.",
  "userId": "uuid"
}

// Response 409 — email already registered (pre-check OR unique-constraint race)
{
  "statusCode": 409,
  "path": "/api/auth/register",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "message": "An account with this email already exists."
}
```

The email is **normalized (trim + lowercase)** at the DTO boundary before any lookup or insert. See [Email Uniqueness Check](#email-uniqueness-check) below.

#### GET /api/auth/check-email

```json
// Query Params
?email=john@example.com

// Response 200
{
  "available": true
}
```

Returns `{ "available": true }` when the email is free, `{ "available": false }` when a user with that email already exists. The email is normalized to lowercase before the indexed lookup. Throttled at 30/min to prevent mass enumeration. Used by the frontend register form to show live availability feedback and block submission of a taken email.

#### POST /api/auth/login

```json
// Request Body
{
  "email": "john@example.com",
  "password": "Str0ng!Pass"
}

// Response 200
{
  "message": "Login successful",
  "data": {
    "accessToken": "eyJhbGci...",
    "user": {
      "id": "uuid",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com",
      "role": "USER"
    }
  }
}

// Also sets HttpOnly cookie: refresh_token (30 days, path: /api)
// This cookie is sent on all /api/* routes
```

#### POST /api/auth/verify-email

```json
// Request Body
{
  "email": "john@example.com",
  "otp": "482917"
}

// Response 200
{
  "message": "Email verified successfully"
}
```

#### POST /api/auth/refresh

The refresh token is read from the `refresh_token` HttpOnly cookie (set during login).

```json
// Response 200
{
  "data": {
    "accessToken": "eyJhbGci..."
  }
}

// Sets new refresh_token cookie (token rotation, path: /api)
```

#### POST /api/auth/logout

```json
// Request Body
{
  "all": true    // optional — omit or set false to log out current session only
}

// Response 200
{
  "message": "Logged out"
}

// Clears refresh_token cookie

// Note: Logout with `all: false` reads the refresh_token cookie to revoke
// the current session. If the cookie is unavailable (e.g. cleared manually),
// it gracefully falls back to just clearing client state.
```

#### POST /api/auth/resend-otp

```json
// Request Body
{
  "email": "john@example.com"
}

// Response 200
{
  "message": "If the email exists and is unverified, a new OTP has been sent."
}
```

#### POST /api/auth/forgot-password

```json
// Request Body
{
  "email": "john@example.com"
}

// Response 200
{
  "message": "If the email exists, a password reset link has been sent."
}
```

#### POST /api/auth/reset-password

```json
// Request Body
{
  "email": "john@example.com",
  "token": "64-char-hex-token-from-email-link",
  "newPassword": "N3wStr0ng!Pass"
}

// Response 200
{
  "message": "Password has been reset"
}
```

#### POST /api/auth/change-password

```json
// Request Headers
Authorization: Bearer <accessToken>

// Request Body
{
  "currentPassword": "Str0ng!Pass",
  "newPassword": "N3wStr0ng!Pass"
}

// Response 200
{
  "message": "Password changed successfully. Please log in again."
}
```

> **Session behavior:** Password change revokes ALL refresh tokens (including the current session's). The user must log in again with the new password. This is intentional — a password change is a security-sensitive action that should invalidate every existing session.

## Email Uniqueness Check

Registration enforces email uniqueness through **normalization + indexed lookup + a database `UNIQUE` constraint + race-condition handling**. No application check alone can be safe, because a `SELECT` followed by an `INSERT` is not atomic.

### 1. Normalization

```
trim + lowercase  (e.g. "  JOHN@X.com " → "john@x.com")
```

Applied twice so both the stored and the queried values are canonical:

- **DTO boundary** — `@Transform(({ value }) => value.trim().toLowerCase())` on `RegisterDto.email`, enabled by `ValidationPipe({ transform: true })` in `main.ts`. This is what actually gets written to the DB.
- **Repository** — `UsersService.findByEmail()` re-normalizes before every `findUnique()` lookup (covers `/register` and `/check-email`), so the query and the stored value always agree.

Without normalization, the unique index would still let `Foo@x.com` and `foo@x.com` both insert, defeating the constraint.

### 2. Indexed lookup (no table scan)

```ts
await this.prisma.user.findUnique({ where: { email } });
```

The `email String @unique` column creates a **unique B-tree index** in PostgreSQL. `findUnique` is an indexed point lookup — O(log n) key-node visits, then one heap fetch — instead of an O(n) full table scan. Also, `findUnique` structurally cannot return more than one row, and the index itself enforces uniqueness at the database level.

### 3. Database constraint — the source of truth

```sql
-- equivalent of email String @unique
ALTER TABLE "users" ADD CONSTRAINT "users_email_key" UNIQUE ("email");
```

Application-level pre-checks are subject to a **TOCTOU race**: two requests that both `SELECT` (0 rows) and then both `INSERT` will both pass the app check. The database guarantees exactly one insert succeeds and the other hits the unique index (`Prisma P2002`), which is why the constraint is required.

### 4. Registration flow + race handling

```ts
// 1. Fast normalized pre-check
const existing = await this.usersService.findByEmail(dto.email);
if (existing) throw new ConflictException('An account with this email already exists.'); // 409

// 2. hash password → create user
try {
  user = await this.usersService.createWithConsent({ ... }); // $transaction
} catch (error) {
  // 3. Race safety net: two concurrent requests both passed step 1.
  if (error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === 'P2002'
      && (error.meta?.target as string[]).includes('email')) {
    throw new ConflictException('An account with this email already exists.'); // 409
  }
  throw error; // any other error → 500
}
```

The `P2002` catch converts what would otherwise be an unhandled `500` into the correct `409`. The `target.includes('email')` guard keeps unrelated unique collisions (e.g. `ownReferralCode`) from being misreported as "email exists".

### 5. Frontend integration (`RegisterForm.tsx`)

The frontend uses `GET /check-email` for **UX, not security**:

- Debounced (400ms) availability request as the user types.
- Live feedback: *checking…* → green *"This email is available"* → red *"This email is already registered"*.
- Submit is disabled while checking or when the email is taken.

The backend `UNIQUE` index remains the final authority: if the frontend is bypassed or two users race, `/register` still returns `409` and the form surfaces it via the `errorMsg` banner.

### Uniqueness error summary

| Case | Code | Message |
|---|---|---|
| Email already registered (pre-check) | `409` | `An account with this email already exists.` |
| Concurrent duplicate insert (P2002 race) | `409` | `An account with this email already exists.` |
| Invalid DTO / malformed email | `400` | validation message |
| Any other DB / infra error | rethrow → `500` | — |

---

### Standard Error Response

All errors follow this shape:

```json
{
  "statusCode": 400,
  "path": "/api/auth/register",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "message": "Validation failed: email must be an email"
}
```

---

## Database Schema

### ER Diagram

```
┌──────────┐     1:1      ┌──────────────┐
│   User   │─────────────>│ UserConsent  │
└──────────┘              └──────────────┘
     │
     ├──1:N──> Otp
     ├──1:N──> PasswordResetToken
     ├──1:N──> RefreshToken ──N:1──> Session
     ├──1:N──> Session
     └──1:N──> AuditLog
```

### Enums

| Enum | Values |
|---|---|
| `UserStatus` | `PENDING_VERIFICATION`, `ACTIVE`, `LOCKED`, `SUSPENDED`, `DELETED` |
| `Role` | `USER`, `ADMIN` |
| `OtpPurpose` | `EMAIL_VERIFY`, `PASSWORD_RESET`, `LOGIN_MFA` |
| `AuditAction` | `REGISTER`, `REGISTER_FAILED`, `EMAIL_VERIFIED`, `OTP_RESENT`, `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGOUT`, `LOGOUT_ALL`, `TOKEN_REFRESHED`, `TOKEN_REUSE_DETECTED`, `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_COMPLETED`, `PASSWORD_CHANGED`, `ACCOUNT_LOCKED`, `ACCOUNT_UNLOCKED` |

### Models

#### User (`users`)

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `firstName` | String | |
| `lastName` | String | |
| `email` | String | Unique, indexed |
| `passwordHash` | String | bcrypt-hashed |
| `emailVerified` | Boolean | Default: `false` |
| `status` | UserStatus | Default: `PENDING_VERIFICATION` |
| `role` | Role | Default: `USER` |
| `ownReferralCode` | String | Unique, 8-char hex |
| `referredBy` | String? | Referral code used at signup |
| `failedLoginAttempts` | Int | Default: `0` |
| `lockedUntil` | DateTime? | Set after 5 failed logins |
| `lastLoginAt` | DateTime? | |
| `createdAt` | DateTime | Auto |
| `updatedAt` | DateTime | Auto |

#### UserConsent (`user_consents`)

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `userId` | String | Unique FK → User (cascade delete) |
| `termsAccepted` | Boolean | |
| `termsAcceptedAt` | DateTime? | |
| `privacyPolicyAccepted` | Boolean | |
| `privacyPolicyAcceptedAt` | DateTime? | |
| `marketingEmails` | Boolean | |
| `createdAt` | DateTime | Auto |

#### Otp (`otps`)

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `userId` | String | FK → User (cascade delete) |
| `purpose` | OtpPurpose | |
| `otpHash` | String | bcrypt-hashed |
| `expiresAt` | DateTime | |
| `attempts` | Int | Default: `0` |
| `maxAttempts` | Int | Default: `5` |
| `consumedAt` | DateTime? | Null = unconsumed |
| `createdAt` | DateTime | Auto |

**Index:** `(userId, purpose)` composite

#### PasswordResetToken (`password_reset_tokens`)

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `userId` | String | FK → User (cascade delete) |
| `tokenHash` | String | bcrypt-hashed 32-byte random |
| `expiresAt` | DateTime | |
| `consumedAt` | DateTime? | Null = unconsumed |
| `createdAt` | DateTime | Auto |

#### RefreshToken (`refresh_tokens`)

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `userId` | String | FK → User (cascade delete) |
| `tokenHash` | String | Unique, SHA-256-hashed |
| `expiresAt` | DateTime | |
| `ipAddress` | String? | |
| `userAgent` | String? | |
| `revokedAt` | DateTime? | Null = active |
| `replacedByTokenId` | String? | Self-referential FK (token chain) |
| `sessionId` | String? | FK → Session (set null on delete) |
| `createdAt` | DateTime | Auto |

#### Session (`sessions`)

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `userId` | String | FK → User (cascade delete) |
| `deviceLabel` | String? | e.g. "Chrome on Windows" |
| `ipAddress` | String? | |
| `userAgent` | String? | |
| `lastActiveAt` | DateTime | Auto |
| `revokedAt` | DateTime? | |
| `createdAt` | DateTime | Auto |

#### AuditLog (`audit_logs`)

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `userId` | String? | FK → User (set null on delete) |
| `action` | AuditAction | |
| `ipAddress` | String? | |
| `userAgent` | String? | |
| `metadata` | Json? | Structured event details |
| `createdAt` | DateTime | Auto |

**Indexes:** `(userId)`, `(action)`

---

## Security Design

### Authentication Flow

```
Register ──> Verify Email (OTP) ──> Login ──> Access Token + Refresh Token
                                                    │
                                    ┌───────────────┴───────────────┐
                                    │  Access Token (JWT, 15m)      │
                                    │  - Sent via Authorization hdr │
                                    │  - Payload: { sub, role }     │
                                    │  - Algorithm: HS256 (pinned)  │
                                    └───────────────────────────────┘
                                    ┌───────────────────────────────┐
                                    │  Refresh Token (opaque, 30d)  │
                                    │  - HttpOnly cookie            │
                                    │  - SHA-256-hashed in DB       │
                                    │  - Rotated on every use       │
                                    │  - Theft detection built-in   │
                                    └───────────────────────────────┘
```

### Key Security Features

| Feature | Implementation |
|---|---|
| **Password hashing** | bcrypt with configurable salt rounds (default 12) |
| **OTP hashing** | bcrypt — raw OTPs never stored |
| **Refresh tokens** | Opaque 64-byte random, SHA-256-hashed, HttpOnly cookie |
| **Token rotation** | Every refresh creates new token, links old via `replacedByTokenId` |
| **Theft detection** | If a revoked token is replayed, ALL user tokens are revoked |
| **Brute-force protection** | Account locks after 5 failed logins for 15 minutes |
| **Rate limiting** | Per-route throttling on all auth endpoints (3–30 req/60s) |
| **Email uniqueness** | Normalized indexed lookup + DB `UNIQUE` index + `P2002` race handling → `409` |
| **No email enumeration** | `resend-otp` and `forgot-password` return identical messages regardless of existence. Exception: `register` / `check-email` disclose whether an email exists — acceptable for open signup and rate-limited (5/min register, 30/min check-email). Use the generic "If this email is available…" message pattern instead if you need to prevent enumeration. |
| **JWT algorithm pinning** | HS256 enforced, token header `alg` is ignored |
| **Minimal JWT payload** | Only `{ sub, role }` — no stale data |
| **Security headers** | helmet middleware (X-Frame-Options, HSTS, etc.) |
| **Password change = revoke all** | Changing or resetting password revokes every active session, forcing re-login |
| **Consent tracking** | Terms and privacy policy acceptance recorded with timestamps |
| **Audit trail** | Every significant action logged with IP, user agent, metadata |

### Password Requirements

- Minimum 8 characters
- At least 1 uppercase letter
- At least 1 lowercase letter
- At least 1 digit
- At least 1 special character (non-alphanumeric)

### Hashing Strategy

| Secret type | Hash algorithm | Rationale |
|---|---|---|
| **User passwords** | bcrypt (12 rounds) | Low-entropy, user-chosen. Bcrypt's slow-hash property defends against brute-force. |
| **OTP codes** | bcrypt | Low-entropy (6 digits). Same reasoning as passwords. |
| **Password reset tokens** | bcrypt | 32-byte random hex (64 chars). Under bcrypt's 72-byte limit. Slow-hash adds defense if DB is leaked. |
| **Refresh tokens** | SHA-256 | 64-byte random hex (128 chars). **Exceeds bcrypt's 72-byte input limit** — bcrypt would silently truncate, halving effective entropy. SHA-256 has no length limit and is correct here because the token is already high-entropy (256 bits), so bcrypt's slow-hash property adds cost without meaningful security benefit. Deterministic hashing also enables direct DB lookup by hash instead of linear bcrypt.compare scans. |

---

## Modules & Services

### AuthModule

The central module. Owns all authentication endpoints.

**Dependencies:** UsersModule, OtpModule, MailModule, PassportModule, JwtModule

**Providers:**
- `AuthService` — Core auth business logic
- `RefreshTokenService` — Opaque refresh token lifecycle
- `JwtStrategy` — Passport JWT validation

**Exports:** JwtStrategy, PassportModule (for use by other modules)

### UsersModule

User CRUD operations and referral code management.

**Providers:**
- `UsersService` — findByEmail, findById, createWithConsent, markEmailVerified, updatePasswordHash, login tracking

### OtpModule

One-time password generation and verification.

**Providers:**
- `OtpService` — generate, verify (bcrypt-hashed, time-limited, attempt-limited)

### MailModule

Transactional email via Brevo REST API.

**Providers:**
- `MailService` — sendVerificationEmail, sendPasswordResetEmail (Handlebars templates)

### AuditModule (`@Global`)

Fire-and-forget audit logging. Failures are swallowed — never blocks user operations.

**Providers:**
- `AuditService` — log(userId, action, ipAddress, userAgent, metadata)

---

## Path Aliases

Defined in `tsconfig.json`:

```typescript
@common/*  → src/common/*
@config/*  → src/config/*
@modules/* → src/modules/*
@database/* → src/database/*
@shared/*  → src/shared/*
@/*        → src/*
```

---

## Scripts

| Command | Description |
|---|---|
| `npm run start:dev` | Start in development mode (watch) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start:prod` | Start compiled app |
| `npm run lint` | Lint + auto-fix |
| `npm run format` | Format with Prettier |
| `npm test` | Run unit tests |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Run dev migrations |
| `npm run db:migrate:prod` | Run production migrations |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:seed` | Seed database |
| `npm run db:reset` | Reset + re-run all migrations |

---

## Migration History

| Migration | Date | Changes |
|---|---|---|
| `20260718101805_init` | Jul 18, 2026 | Initial schema: User, UserConsent, Otp, AuditLog tables + enums |
| `20260718125916_add_role_to_users` | Jul 18, 2026 | Added `Role` enum and `role` column to users |
| `20260719181501_add_password_reset_tokens` | Jul 19, 2026 | Added `PasswordResetToken` table + new audit actions |

---

## Changelog

| Date | Change |
|---|---|
| Jul 22, 2026 | Added `PASSWORD_CHANGED` audit action. Changed refresh cookie path from `/api/auth/refresh` to `/api` so it's accessible on all API routes (fixes logout). Logout now gracefully handles missing cookie. |

## Future Work (Installed but Not Yet Active)

| Item | Status |
|---|---|
| `passport-local` strategy | Installed, no local strategy defined |
| `RolesGuard` + `@Roles()` | Implemented, not applied to any route yet. **Guard ordering note:** When wiring, `JwtAuthGuard` must run first so `request.user` is populated before `RolesGuard` reads `.role`: `@UseGuards(JwtAuthGuard, RolesGuard)` |
| `Session` model | Defined in Prisma schema, no SessionService. **`RefreshToken.sessionId` is always `null`** — no code creates Session rows yet. Whoever builds the "your devices" UI must also: (a) create Session rows during login, (b) populate `sessionId` on RefreshToken creation, (c) revoke Sessions alongside RefreshTokens in `changePassword`/`resetPassword`/`handleTheftDetection` transactions so the two models don't drift |
| `ACCOUNT_LOCKED` / `ACCOUNT_UNLOCKED` audit actions | Defined in enum but never logged. Account locking works (via `lockedUntil` field + `LOGIN_FAILED` audit), but dedicated lock/unlock audit events are not emitted. `ACCOUNT_UNLOCKED` is never triggered — the lock expires silently via time check, no code path logs the transition |
| `SUSPENDED` / `DELETED` user statuses | Defined in enum, no code path sets these |
| `LOGIN_MFA` OTP purpose | Reserved for future step-up auth |
| `nodemailer` | Installed, Brevo REST API used instead |

### Known Residual Risks (By Design)

| Risk | Why it exists | Mitigation |
|---|---|---|
| **JWT access token survives password change** | JWTs can't be revoked without a denylist (deliberately avoided per design). After password change, the old JWT is valid for up to 15 minutes. | 15-minute expiry is short enough to be acceptable. All refresh tokens are revoked immediately, so the attacker can't get a new access token. |
| **Session rows not revoked with RefreshTokens** | SessionService doesn't exist yet. `changePassword`/`resetPassword` transactions only revoke RefreshToken rows. | No code reads Session.revokedAt today. When SessionService is built, add `session.updateMany({ where: { userId }, data: { revokedAt: now } })` to the same transactions. |
