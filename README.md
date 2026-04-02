# Fork & Fly

Fork & Fly is a food discovery app for travelers. The frontend is a static page in `public/`, and the backend search flow is available both as a local Express route and as a Vercel serverless function in `api/search.js`.

## Local setup

1. Install Node.js 18 or newer.
2. Install dependencies:

```bash
npm install
```

3. Add your API keys to `.env`:

```env
MEMORIES_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here
PORT=3000
```

4. Run locally with either option:

```bash
npm start
```

or

```bash
npm run dev
```

5. Open `http://localhost:3000`.

## Deploy to Vercel

1. Push this project to GitHub.
2. Import the repo into Vercel.
3. In Vercel project settings, add:

```env
MEMORIES_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here
```

4. Deploy.

Vercel serves [public/index.html](/Users/vidhatrihegde/Fork%20&%20Fly/public/index.html) at `/` and runs [api/search.js](/Users/vidhatrihegde/Fork%20&%20Fly/api/search.js) for `/api/search`.

## Project structure

```text
fork-and-fly/
├── api/
│   └── search.js
├── lib/
│   └── fork-and-fly.js
├── public/
│   └── index.html
├── .env
├── package.json
├── server.js
└── vercel.json
```

## Notes

- API keys stay server-side in local `.env` files or Vercel environment variables.
- The browser only calls `/api/search`.
- The shared backend logic lives in [lib/fork-and-fly.js](/Users/vidhatrihegde/Fork%20&%20Fly/lib/fork-and-fly.js).
- [vercel.json](/Users/vidhatrihegde/Fork%20&%20Fly/vercel.json) sets the Vercel function max duration to 60 seconds.
