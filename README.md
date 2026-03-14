# Arfor

Arfor is a dark-first glass dashboard built with Next.js 16 and TypeScript. It combines:

- toggleable news categories
- a month calendar with add-event controls
- a recurring bill manager with perpetual due dates
- a stock watchlist with focused ticker news
- AI-style stock suggestions
- a weather widget plus a full weather page
- a dedicated mini-games page
- Supabase-ready Google auth scaffolding

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS v4
- Supabase SSR auth helpers
- Railway-friendly deployment setup

## Local setup

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## Auth

- `/login` contains the Google OAuth entry point.
- `/auth/callback` exchanges the auth code for a session.
- `src/proxy.ts` keeps the Supabase session fresh.

## Database

The first pass schema lives at:

- `supabase/migrations/202603140001_arfor_core.sql`

It includes tables for:

- profiles
- calendar events
- recurring bills
- stock watchlists

## Build

```bash
npm run build
```
