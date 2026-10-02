# Pennytor Backend


A modern fintech/investment platform built with **NestJS**, **Node.js**, and **TypeScript**.

#
## Tech Stacks

### Core
- **Next.js 16** — React framework (App Router with route groups)
- **React 19** / **React DOM 19**
- **TypeScript 5** (strict mode)

### State & Data
- **Zustand 5** — Lightweight state management
- **React Hook Form** + **Zod 4** — Form validation
- **Next.js Proxy** — Route protection middleware

### UI / Styling
- **Tailwind CSS v4** — Utility-first CSS framework
- **shadcn/ui** — Reusable Radix UI primitives
- **Radix UI** — Accessible dialog, dropdown-menu, avatar, label
- **Lucide React** + **React Icons** — Icons
- **class-variance-authority** — Variant-based component styling
- **clsx** + **tailwind-merge** — Conditional class merging

### Animation
- **Framer Motion** — Declarative animations

### Build / Dev Tools
- **React Compiler** (experimental) — Automatic memoization
- **ESLint 9** with `eslint-config-next`
- **PostCSS** with `@tailwindcss/postcss`

### Fonts
- **Poppins** — Primary font
- **Playfair Display** — Accent font

## Project Structure

```
app/
├── (auth)/            # Public auth routes (login, register, forgot/reset password)
├── (main)/            # Public marketing routes (landing page)
├── (user)/            # Protected routes (dashboard, profile, accounts)
└── layout.tsx         # Root layout with fonts and globals

components/
├── auth/              # Auth form components (Login, Register, OTP, ResetPassword)
├── User/              # Authenticated user components (Layout, Sidebar, Dashboard)
├── ui/                # Reusable shadcn/ui primitives
└── home/              # Landing page sections (Hero, Testimonials, FAQ)

services/              # API client and endpoint services
store/                 # Zustand stores (auth, dashboard, etc.)
types/                 # TypeScript interfaces
lib/                   # Zod validation schemas
utils/                 # Utility functions
proxy.ts               # Next.js route protection middleware
```

## Auth Flow

### Registration
1. User fills register form → `POST /api/auth/register`
2. OTP verification dialog opens → user enters 6-digit code
3. `POST /api/auth/verify-email` confirms the email
4. Redirect to `/login`

### Login
1. User submits credentials → `POST /api/auth/login`
2. Server sets `refresh_token` HttpOnly cookie (path: `/api/auth/refresh`)
3. Response returns `{ accessToken, user }`
4. Access token stored in Zustand (memory only — not persisted to localStorage)
5. User saved to localStorage + `auth_session` cookie set (for middleware)
6. Redirect to `/dashboard`

### Session Restoration
- On page refresh, `AuthGuard` calls `POST /api/auth/refresh`
- Refresh token cookie is sent automatically (HttpOnly)
- If valid, a new access token is returned and session is restored
- If expired, user is redirected to `/login`

### Token Refresh (401 Interceptor)
- When any API call returns 401, `services/api.ts` automatically:
  1. Calls `/auth/refresh` to get a new access token
  2. Queues concurrent 401s to avoid multiple refresh calls
  3. Retries the original request with the new token
  4. If refresh fails, clears auth and redirects to `/login`

### Logout
- **Log out** — revokes the current refresh token (single session)
- **Log out everywhere** — revokes all refresh tokens (all devices)
- Both clear: localStorage user, `auth_session` cookie, and redirect to `/login`

### Route Protection
- **Next.js Proxy** (`proxy.ts`) — checks for `auth_session` cookie on protected routes (`/dashboard`, `/profile`, etc.). Redirects to `/login` if missing. Also redirects authenticated users away from `/login`, `/register`.
- **AuthGuard** (client-side) — fallback that attempts session restoration via refresh token if no access token in memory.

## Environment Variables

```
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WHATSAPP_PHONE_NUMBER=...
NEXT_PUBLIC_WHATSAPP_MESSAGE=...
```

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

The backend must be running on `http://localhost:3001`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |

## Run migrations

```bash
npx prisma migrate dev --name init    # new DB
npx prisma migrate deploy             # existing DB
npx prisma generate                   # regenerate client
```


## For clean New DB 

# 1. Generate Prisma client
npx prisma generate

# 2. Push schema to your clean DB (creates all tables)
npx prisma migrate dev --name init

# 3. Seed initial data (admin/super-user users)
npx prisma db seed

# 4. Start the server:
npm run start:dev

# 5. Make sure your .env has:
DATABASE_URL="postgresql://username:password@localhost:5432/your_db_name"

## Backend

The backend is a **NestJS** API at `http://localhost:3001/api`. See `../backend/readme.md` for details...



test 1 2 3 4 5 6 7 8 9 
