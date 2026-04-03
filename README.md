# Fork & Fly

Fork & Fly is a food discovery app for travelers.

Enter a destination, pick the platforms and food style you care about, and the app finds real food videos from Memories.ai and turns them into a travel food guide using Anthropic Claude.

Live app: https://fork-fly.vercel.app/

## Run locally

1. Install Node.js 18+
2. Install dependencies

```bash
npm install
```

3. Create a `.env` file in the project root

```env
MEMORIES_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here
PORT=3000
```

4. Start the app

```bash
npm start
```

5. Open `http://localhost:3000`

## Deploy on Vercel

1. Push this repo to GitHub
2. Import the repo in Vercel
3. Add these Environment Variables in Vercel Project Settings

```text
MEMORIES_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here
```

4. Deploy the project

## Project structure

```text
.
├── api/search.js
├── lib/fork-and-fly.js
├── public/index.html
├── server.js
├── package.json
├── vercel.json
└── README.md
```

## Notes

- API keys are never exposed in the browser
- Frontend code is in `public/index.html`
- Backend API route is `api/search.js`
- Shared backend logic is in `lib/fork-and-fly.js`
