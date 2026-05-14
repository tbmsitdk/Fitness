# Garmin Fitness Analytics

A personal fitness analytics web app that ingests Garmin Connect data exports and provides trend analysis, AI-powered coaching, and longevity insights for running, walking, and cycling — all powered by Claude AI.

**No terminal required at any step.**

---

## Step 1 — Export your Garmin data

1. Go to [garmin.com](https://www.garmin.com) and sign in
2. Click your account icon (top right) → **Data Management** → **Export Your Data**
3. Click the **Export** button
4. Garmin will email you a link when the export is ready (can take up to 24 hours)
5. Download the ZIP file from the email link
6. Keep it handy — you'll upload it in the app after deployment

---

## Step 2 — Push this project to GitHub (no terminal needed)

1. Go to [github.com](https://github.com) and sign in
2. Click the **+** icon (top right) → **New repository**
3. Name it `garmin-fitness-app`, choose Public or Private, then click **Create repository**
4. On the next screen, click **"uploading an existing file"**
5. Drag and drop **all project files and folders** into the upload area
   - Make sure to include the `app/`, `components/`, `lib/`, `types/` folders and all config files
   - GitHub's uploader supports folders — drag the entire project folder
6. Add a commit message (e.g. "Initial commit") and click **Commit changes**

---

## Step 3 — Deploy on Vercel (no terminal needed)

1. Go to [vercel.com](https://vercel.com) and sign in (use "Continue with GitHub")
2. Click **Add New** → **Project**
3. Find and click **Import** next to `garmin-fitness-app`
4. Leave all settings as default — Vercel detects Next.js automatically
5. Click **Deploy** and wait ~2 minutes for the build to complete
6. Your app URL will appear once deployed (e.g. `garmin-fitness-app.vercel.app`)

---

## Step 4 — Add storage (Vercel dashboard)

Your app needs three Vercel storage services. Set them up from your project dashboard:

1. In your Vercel project, click the **Storage** tab
2. **Add Postgres database:**
   - Click **Create** → choose **Postgres**
   - Accept the default name and region, click **Create**
3. **Add Blob store:**
   - Click **Create** → choose **Blob**
   - Accept defaults, click **Create**
4. **Add KV store:**
   - Click **Create** → choose **KV**
   - Accept defaults, click **Create**

Vercel automatically adds all connection strings as environment variables — no copy-pasting needed.

---

## Step 5 — Add your Anthropic API key

The AI coaching features require a Claude API key.

1. Go to [console.anthropic.com](https://console.anthropic.com), sign in, and navigate to **API Keys**
2. Click **Create Key**, give it a name (e.g. "garmin-app"), and copy the key
3. In Vercel, open your project → **Settings** → **Environment Variables**
4. Click **Add New**:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** paste your API key
   - Leave **Environment** as "Production, Preview, Development"
   - Click **Save**
5. Go to **Deployments** → click the **⋯** (three dots) next to the latest deployment → **Redeploy**
   - This is required for the new environment variable to take effect

---

## Step 6 — Upload your Garmin data

1. Open your deployed app URL
2. Click the **Upload** tab (shown by default if no data exists yet)
3. Drop your Garmin export ZIP file into the upload area (or click to browse)
4. Wait while your data is parsed and stored — this takes 10–60 seconds depending on how many activities you have
5. Once complete, you'll be taken to the **Dashboard** automatically

---

## Features

### Dashboard (6+ chart types)
- **Weekly Training Volume** — stacked bar chart of km/hours by sport (running, cycling, walking), last 26 weeks
- **Training Load** — ATL/CTL/TSB area chart using 42-day / 7-day EWMA model, last 90 days
- **HR Zone Distribution** — horizontal bar chart of time in Garmin's 5 HR zones across all activities
- **Wellness Trends** — line charts for Resting HR, HRV (RMSSD), and Sleep hours (last 90 days)
- **Monthly Consistency** — grouped bar chart of active days per sport per month, last 12 months
- **Daily Steps** — bar chart with 10,000-step goal reference line, last 60 days
- **Personal Bests** — cards for fastest 5K/10K pace, longest run/ride, most elevation, peak power, and more

### AI Coach (claude-sonnet-4-5)
- **Weekly Summary** — plain-English analysis of your last 90 days of training
- **Recommendations** — up to 5 personalised, data-driven training recommendations
- **Injury Risk Flags** — warnings for load spikes >10%, HRV declines, ATL:CTL imbalances
- **Longevity Insights** — Zone 2 guidance, VO2max trends, recovery adequacy (Peter Attia framework)
- **Chat** — ask anything about your data in natural language; answers are grounded in your actual metrics
- **Caching** — AI summaries cached for 24 hours in Vercel KV to reduce API costs

### Data ingestion
- Parses Garmin Connect full data export ZIP
- Reads `Activities.csv` (all sport types)
- Reads wellness exports: daily steps, resting HR, HRV, sleep, stress score
- Auto-detects km vs miles units
- Stores all data in Vercel Postgres with upsert (re-uploading newer exports is safe)
- Original ZIP archived in Vercel Blob

---

## Architecture

```
garmin-fitness-app/
├── app/
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Single-page app with tab navigation
│   ├── globals.css
│   └── api/
│       ├── upload/         # ZIP ingestion → parse → Postgres
│       ├── activities/     # Read activities from Postgres
│       ├── wellness/       # Read wellness records from Postgres
│       ├── ai-summary/     # Generate/cache AI weekly summary
│       ├── chat/           # Streaming AI chat endpoint
│       └── init-db/        # Create tables if not exists
├── components/
│   ├── Upload.tsx          # Drag-and-drop upload UI
│   ├── Dashboard.tsx       # Charts and metrics dashboard
│   ├── AICoach.tsx         # Summary + chat interface
│   └── charts/             # Individual chart components (Recharts)
├── lib/
│   ├── db.ts               # Vercel Postgres helpers
│   ├── garmin-parser.ts    # ZIP/CSV parsing logic
│   ├── training-load.ts    # ATL/CTL/TSB, weekly volume, HR zones
│   └── ai.ts               # Claude API integration
└── types/index.ts          # Shared TypeScript types
```

**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind CSS · Recharts · Vercel (Postgres + Blob + KV) · Anthropic Claude API

---

## Environment variables

| Variable | Where it comes from |
|---|---|
| `ANTHROPIC_API_KEY` | Manually added in Vercel → Settings → Environment Variables |
| `POSTGRES_URL` | Auto-set when you add Vercel Postgres |
| `BLOB_READ_WRITE_TOKEN` | Auto-set when you add Vercel Blob |
| `KV_URL` | Auto-set when you add Vercel KV |

---

## Privacy

Your fitness data is stored in your own Vercel Postgres database, attached to your Vercel account. It is not shared with anyone. The Anthropic API receives only aggregated 90-day statistics (no raw GPS tracks or personal identifiers) to generate coaching insights.
