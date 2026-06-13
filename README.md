# ReflexNet

ReflexNet is a high-performance, multi-modal aim trainer designed for esports athletes and competitive tactical shooters. It bridges the gap between hardware telemetry and game engine physics to provide mathematically perfect sensitivity recommendations.

## Features

- Advanced Game Engine Physics: Supports multiple titles with exact Engine Yaw multipliers.
- Immersive 3D Arenas: Three.js environments with a strict 3D Grid Wall system.
- Flicking Drills: Randomized point-to-point target distributions.
- Micro-Adjustment Drills: Tightly clustered adjacent spawns for pixel-peeking.
- AI-Powered Telemetry Coach: Connects to the Groq API to analyze pathing efficiency and over-flicking.
- Hardware-Agnostic Setup: Maps polling rates to processing tick rates for precise tracking.

## Tech Stack

- Frontend: Vanilla TypeScript, Vite, Three.js (WebGL).
- Backend: Node.js, Express, CORS safety layer.
- Database & Auth: Supabase (PostgreSQL with Row-Level Security).
- AI Engine: Groq API (Llama3 / Mixtral).

## Getting Started

### Prerequisites

- Node.js (v18+)
- Supabase account
- Groq Cloud account

### Local Installation

1. Clone the repository:
   `git clone https://github.com/surya-cn/ReflexNet.git`
   `cd reflexnet`

2. Configure Environment Variables:
   Create a .env file in frontend/ and backend/.

   Backend .env:
   `PORT=10000`
   `SUPABASE_URL=your-supabase-project-url`
   `SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-secret`
   `GROQ_API_KEY=your-groq-api-key`

   Frontend .env:
   `VITE_SUPABASE_URL=your-supabase-project-url`
   `VITE_SUPABASE_ANON_KEY=your-supabase-anon-key`
   `VITE_API_BASE_URL=http://localhost:10000`

3. Run Locally:
   Backend:
   `cd backend && npm run dev`
   
   Frontend (separate terminal):
   `cd frontend && npm run dev`

## Deployment

### Backend (Render)

1. Create a Web Service on Render linking to this repository.
2. Set Root Directory to backend.
3. Set Build Command to npm install.
4. Set Start Command to npm start.
5. Add env variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GROQ_API_KEY).

### Frontend (Vercel)

1. Import into Vercel and set Root Directory to frontend.
2. Ensure Framework Preset is Vite.
3. Add env variables: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_BASE_URL (Live Render URL).
4. Click Deploy.
