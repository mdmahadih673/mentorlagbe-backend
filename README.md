# MentorLagbe API

Express and MongoDB API for MentorLagbe. It manages user roles, tuition listings, student applications, admin moderation, and Stripe payment verification.

## Tech stack

- Node.js with Express 5
- MongoDB
- Stripe

## Local setup

```bash
npm install
node index.js
```

For automatic restart during development, run `npx nodemon index.js` if nodemon is installed.

Set these environment variables in `.env`:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URL` | MongoDB connection string |
| `STRIPE_SECRET_KEY` | Stripe server secret key |
| `BETTER_AUTH_URL` | Frontend base URL that issues signed access tokens |
| `AUTH_JWKS_URL` | Optional URL for Better Auth's JWKS endpoint; defaults to `${BETTER_AUTH_URL}/api/auth/jwks` |
| `PORT` | Optional API port; defaults to `5000` |

The API uses the `mentorlagbe` database. The frontend connects through `NEXT_PUBLIC_API_BASE_URL`.
Private API routes verify short-lived JWTs against Better Auth's public signing keys and load the current role from MongoDB.

## Main API areas

- `/tuitions` — public approved listings and search; tutor-owned listing management is protected.
- `/applications` and `/student/applications` — student requests.
- `/tutor/applications` — tutor applicant management.
- `/admin` — admin-only users, tuition moderation, application counts, and transactions.
- `/payments` — Stripe payment verification and plan activation.

## Project links

- Live API: add the deployed API URL after deployment.
