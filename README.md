# 🎓 MentorLagbe API — Smart Tuition & Mentorship Platform

The backend REST API for **MentorLagbe**, a tuition and mentorship platform that connects students with qualified tutors.

This service handles tuition listings, student applications, tutor applicant management, Pro plan payment verification, and admin operations. Authentication is provided by **Better Auth** on the frontend, and this API verifies the resulting JWT access tokens.

---

## 🌐 Live API

🔗 **API Base URL:** [https://mentorlagbe-backend.vercel.app](https://mentorlagbe-backend.vercel.app)

🔗 **Health Check:** [https://mentorlagbe-backend.vercel.app/](https://mentorlagbe-backend.vercel.app/)

🔗 **Frontend:** [https://mentorlagbe-frontend.vercel.app](https://mentorlagbe-frontend.vercel.app)

---

## 📸 Overview

MentorLagbe lets students discover tuition opportunities, apply for tuition, and track their applications. Tutors can post tuition listings, manage applicants, and upgrade to Pro. Admins can manage users, approve or reject tuition posts, and monitor transactions and revenue.

The backend is a single Express application backed by MongoDB. It exposes a role-protected REST API and verifies Better Auth JWTs using the frontend's JWKS endpoint.

---

## ✨ Features

- JWT authentication with remote JWKS verification.
- Role-based authorization for Students, Tutors, and Admins.
- Tuition listing creation, editing, deletion, and visibility controls.
- Admin tuition approval workflow: `pending`, `approved`, `rejected`.
- Public tuition search with keyword, subject, class, mode, location, sorting, and pagination.
- Student applications with duplicate prevention and cancellation.
- Tutor applicant management with accept/reject actions.
- Free and Pro plan limits enforced on the server.
- Stripe Checkout verification and automatic Pro plan activation.
- Payment records and admin transaction/revenue APIs.
- Admin user management, role changes, and cascade deletes.
- CORS support for the frontend application.

---

## 🛠️ Technology Stack

- **Node.js** with ES modules
- **Express.js 5**
- **MongoDB** via the official `mongodb` driver
- **jose** for JWT verification against Better Auth JWKS
- **Stripe** for checkout session verification
- **dotenv** for environment configuration
- **cors** for cross-origin requests
- **Vercel** for deployment

---

## 🔐 Authentication & Authorization

Authentication is handled by **Better Auth** in the frontend application. The frontend issues a JWT, and this backend verifies it.

### Request flow

```text
Next.js frontend
   │
   ├── Better Auth  ──►  MongoDB (user, session, account)
   │        │
   │        └── JWT (audience: mentorlagbe-api)
   │
   └── Backend API  ──►  Verifies JWT via JWKS
            │
            └── MongoDB (tuitions, applications, payments)
```

### Protected request header

```http
Authorization: Bearer <jwt-access-token>
```

### Verification rules

- The JWT signature is verified with the JWKS from
  `BETTER_AUTH_URL/api/auth/jwks`, or from `AUTH_JWKS_URL` when provided.
- The token issuer must match `BETTER_AUTH_URL`.
- The token audience must be `mentorlagbe-api`.
- The token subject (`sub`) is used to load the current user from the `user` collection.
- The user's `role` determines which routes are allowed.

### Roles

| Role | Access |
|------|--------|
| Student | Browse tuitions, apply, cancel pending applications, view own application stats, verify student payment |
| Tutor | Manage own tuitions, manage own applicants, verify tutor payment |
| Admin | Manage users, roles, tuitions, approvals, transactions, and revenue |

Unauthorized requests return `401`. Authenticated users with the wrong role receive `403`.

---

## 🚀 Getting Started

### Prerequisites

- Node.js 20 or newer
- npm
- A MongoDB database
- A Stripe account with the same products used by the frontend
- The MentorLagbe frontend running (for Better Auth and JWKS)

### 1. Clone the Repository

```bash
git clone https://github.com/mdmahadih673/mentorlagbe-backend.git
```

### 2. Navigate to the Project Directory

```bash
cd mentorlagbe-backend
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the project root.

```env
PORT=5000
MONGODB_URL=your_mongodb_connection_string
STRIPE_SECRET_KEY=your_stripe_secret_key
BETTER_AUTH_URL=http://localhost:3000
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `PORT` | No | Server port. Defaults to `5000`. |
| `MONGODB_URL` | Yes | MongoDB connection string. The app uses the `mentorlagbe` database. |
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key used to retrieve and verify Checkout Sessions. |
| `BETTER_AUTH_URL` | Yes | Frontend URL. Used as the JWT issuer and to build the JWKS URL. |
| `AUTH_JWKS_URL` | No | Overrides the JWKS URL when it is not at `BETTER_AUTH_URL/api/auth/jwks`. |

> Never commit the `.env` file. It is already excluded by `.gitignore`.

### 5. Run the Server

```bash
node index.js
```

The API starts on `http://localhost:5000` by default.

Verify it is running:

```bash
curl http://localhost:5000/
```

Expected response:

```text
Hello World!
```

### 6. Connect the Frontend

Set the following variable in the frontend `.env.local`:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000
```

The backend and frontend must share the same Better Auth configuration. In particular, `BETTER_AUTH_URL` must point to the frontend origin so JWT issuers and JWKS URLs match.

---

## 📡 API Reference

**Base URL:** `http://localhost:5000` (local) or `https://mentorlagbe-backend.vercel.app` (production)

**Access legend:** Public · Student · Tutor · Admin · Owner (the authenticated user must own the resource)

### Health

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| `GET` | `/` | Public | Health check. Returns `Hello World!`. |

### Tuition Listings

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| `GET` | `/tuitions` | Public | List all approved and active tuitions. |
| `GET` | `/tuitions/search` | Public | Search, filter, sort, and paginate approved active tuitions. |
| `GET` | `/tuitions/:id` | Public | Get one approved and active tuition by ID. |
| `POST` | `/tuition` | Tutor | Create a tuition post. New posts start as `pending`. Free tutors are limited to 2 posts. |
| `PATCH` | `/tuitions/:id` | Tutor + Owner | Update allowed tuition fields. The post is sent back to `pending` for review. |
| `PATCH` | `/tuitions/:id/active` | Tutor + Owner | Toggle an approved tuition between active and closed. |
| `DELETE` | `/tuitions/:id` | Tutor + Owner | Delete a tuition and its related applications. |
| `GET` | `/my-tuitions/:teacherId` | Tutor + Owner | List all tuitions created by the authenticated tutor. |
| `GET` | `/tutor/tuition-count/:teacherId` | Tutor + Owner | Get the tutor's post count, plan, limit, and remaining posts. |

#### Search query parameters

| Parameter | Description |
|-----------|-------------|
| `q` | Keyword search across title, subject, class level, and tutor name. |
| `subject` | Filter by subject. Repeatable or comma-separated. |
| `class` | Filter by class level. Supports `Class 6–8`, `Class 9–10`, `HSC`, and `Admission`. Repeatable or comma-separated. |
| `mode` | Filter by `Online` or `Offline`. Repeatable or comma-separated. |
| `location` | Filter by location. `Online` matches online tuitions; other values match offline locations. |
| `sort` | `newest` (default), `fee-low`, or `fee-high`. |
| `page` | Page number. Defaults to `1`. |
| `pageSize` | Results per page. Defaults to `6`, maximum `50`. |

#### Example

```http
GET /tuitions/search?q=math&class=Class%209%E2%80%9310&mode=Online&sort=fee-low&page=1
```

```json
{
  "success": true,
  "data": [
    {
      "_id": "67...",
      "title": "Math for Class 9–10",
      "subject": "Mathematics",
      "classLevel": "Class 9",
      "mode": "Online",
      "monthlyFee": 3000,
      "tutorEmail": "tutor@example.com"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 6,
  "totalPages": 1
}
```

### Student Applications

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| `POST` | `/applications` | Student | Apply for an approved active tuition. |
| `GET` | `/student/applications/:studentId` | Student + Owner | List the student's applications for tuitions that are still open. |
| `DELETE` | `/student/applications/:applicationId` | Student + Owner | Cancel a pending application. |
| `GET` | `/student/application-count/:studentId` | Student + Owner | Get application counts, plan, limit, and whether the student can apply. |

#### Apply request body

```json
{
  "tuitionId": "67...",
  "studentId": "67...",
  "studentPhone": "+8801XXXXXXXXX",
  "message": "I am interested in this tuition.",
  "preferredTime": "Evening after 6 PM"
}
```

`studentPhone` and `preferredTime` are required. The API rejects duplicate active applications for the same tuition with `409`.

### Tutor Applicants

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| `GET` | `/tutor/applications/:teacherId` | Tutor + Owner | List applications received for the tutor's tuitions. |
| `PATCH` | `/tutor/applications/:applicationId/status` | Tutor + Owner | Update an application to `pending`, `accepted`, or `rejected`. |
| `DELETE` | `/tutor/applications/:applicationId` | Tutor + Owner | Delete an application received by the tutor. |

#### Update status request body

```json
{
  "status": "accepted"
}
```

### Payments

Checkout Sessions are created by the frontend, then verified here after Stripe redirects the user back.

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| `POST` | `/payments/checkout-vetify` | Tutor + Owner | Verify a tutor Checkout Session, record the payment, and activate the Pro Tutor plan. |
| `POST` | `/payments/student/checkout-verify` | Student + Owner | Verify a student Checkout Session, record the payment, and activate the Pro Student plan. |

> The tutor route is currently spelled `checkout-vetify` in the API. The frontend calls this exact path.

#### Verify request body

```json
{
  "sessionId": "cs_test_...",
  "userId": "67..."
}
```

The API checks that the session is complete, paid, in `payment` mode, and belongs to the authenticated user. The student verification additionally requires a `USD` payment of exactly `$10.00`.

### Admin

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| `GET` | `/users` | Admin | List all users. |
| `PATCH` | `/users/:id/role` | Admin | Change a user's role to `student`, `tutor`, or `admin`. |
| `DELETE` | `/users/:id` | Admin | Delete a user and related sessions, accounts, applications, and tuitions. |
| `GET` | `/admin/tuitions` | Admin | List all tuitions, including pending and rejected posts. |
| `PATCH` | `/admin/tuitions/:id/status` | Admin | Set approval status to `pending`, `approved`, or `rejected`. |
| `DELETE` | `/admin/tuitions/:id` | Admin | Delete a tuition and its related applications. |
| `GET` | `/admin/applications/count` | Admin | Get the total number of applications. |
| `GET` | `/admin/transactions/students` | Admin | List student transactions. |
| `GET` | `/admin/transactions/tutors` | Admin | List tutor transactions. |
| `GET` | `/admin/transactions/revenue` | Admin | Get total revenue from paid transactions. |

#### Role update request body

```json
{
  "role": "tutor"
}
```

#### Approval status request body

```json
{
  "status": "approved"
}
```

---

## 🧠 Business Rules

- A new tuition post is created with `approvalStatus: "pending"` and `isActive: true`.
- Editing a tuition resets its approval status to `pending`.
- Only approved and active tuitions are publicly visible and searchable.
- Tutors can toggle `isActive` only on approved tuitions they own.
- Free tutors can create up to **2** tuition posts.
- Pro tutors have **unlimited** tuition posts.
- Free students can have up to **2** active applications (`pending` or `accepted`) on open tuitions.
- Pro students have **unlimited** active applications.
- Students cannot submit a second active application for the same tuition.
- Only `pending` applications can be cancelled by a student.
- A successful Stripe verification records a payment and sets the user's `plan` to `pro`.
- Deleting a user cascades to their sessions, accounts, applications, and owned tuitions.
- Deleting a tuition cascades to its applications.

---

## 🗂️ Data Model

The API uses the `mentorlagbe` MongoDB database.

| Collection | Purpose | Key fields |
|------------|---------|------------|
| `user` | Better Auth users | `name`, `email`, `role`, `plan`, `image` |
| `tuitions` | Tuition listings | `teacherId`, `title`, `subject`, `classLevel`, `mode`, `location`, `daysPerWeek`, `preferredTime`, `monthlyFee`, `description`, `bannerUrl`, `approvalStatus`, `isActive`, `createdAt`, `updatedAt` |
| `applications` | Student applications | `tuitionId`, `teacherId`, `studentId`, `studentName`, `studentEmail`, `studentPhone`, `message`, `preferredTime`, `status`, `createdAt`, `updatedAt` |
| `payments` | Stripe payments | `userId`, `userEmail`, `userName`, `userRole`, `planName`, `amount`, `currency`, `transactionId`, `stripeSessionId`, `paymentStatus`, `paidAt`, `updatedAt` |

> The `user`, `session`, and `account` collections are primarily managed by Better Auth. This API reads the user record for authorization and updates `role` and `plan` where needed.

---

## 🧾 Error Responses

Errors use a consistent JSON shape:

```json
{
  "success": false,
  "message": "A human-readable explanation"
}
```

| Status | Meaning |
|--------|---------|
| `400` | Invalid ID, missing fields, or invalid status/role |
| `401` | Missing, invalid, or expired token |
| `403` | Wrong role, plan limit reached, or resource not owned by the user |
| `404` | User, tuition, or application not found |
| `409` | Duplicate application or an application that can no longer be cancelled |
| `500` | Unexpected server error |

---

## 📁 Project Structure

```text
mentorlagbe-backend/
│
├── index.js          # Express app, auth middleware, and all API routes
├── package.json
├── .env              # Local environment variables (not committed)
├── .gitignore
└── README.md
```

The API currently lives in a single `index.js` file. Route modules and controllers are a planned refactor.

---

## 🚢 Deployment

This API is deployed on **Vercel**.

1. Import the repository into Vercel.
2. Add the environment variables:
   - `MONGODB_URL`
   - `STRIPE_SECRET_KEY`
   - `BETTER_AUTH_URL` — set to the deployed frontend URL, e.g. `https://mentorlagbe-frontend.vercel.app`
   - `AUTH_JWKS_URL` — optional, only if JWKS is served from a custom URL
3. Deploy.
4. Verify `GET /` returns `Hello World!`.
5. Set the frontend's `NEXT_PUBLIC_API_BASE_URL` to the deployed backend URL.

> `BETTER_AUTH_URL` must match the frontend origin exactly so JWT issuer validation and JWKS discovery succeed.

---

## 🔑 Demo Accounts

Accounts are created through the frontend at `/sign-up` as a Student or Tutor.

- **Admin access:** set a user's `role` to `admin` in the `user` collection, or use the admin user management UI.
- **Pro access:** complete the Stripe Checkout flow, or set `plan` to `pro` in the database for local testing.

Passwords and production secrets are never committed to this repository.

---

## 🔗 Project Links

| Resource | Link |
|----------|------|
| Live Website | [https://mentorlagbe-frontend.vercel.app](https://mentorlagbe-frontend.vercel.app) |
| Backend API | [https://mentorlagbe-backend.vercel.app](https://mentorlagbe-backend.vercel.app) |
| Client Repository | [https://github.com/mdmahadih673/mentorlagbe-frontend](https://github.com/mdmahadih673/mentorlagbe-frontend) |
| Server Repository | [https://github.com/mdmahadih673/mentorlagbe-backend](https://github.com/mdmahadih673/mentorlagbe-backend) |

---

## 🎯 Future Improvements

- Split `index.js` into routes, controllers, and services.
- Add request validation with Zod or Express Validator.
- Add rate limiting and request logging.
- Replace redirect-based payment verification with Stripe webhooks.
- Restrict CORS to the deployed frontend origin.
- Add automated tests for authorization and business rules.
- Add OpenAPI/Swagger documentation.
- Add server-side pagination and filtering for admin lists.
- Add monitoring and error tracking.
- Add token refresh and session revocation handling.

---

## 👨‍💻 Developer

**Md Mahadi Hasan**

- GitHub: [mdmahadih673](https://github.com/mdmahadih673)
- LinkedIn: [Md Mahadi Hasan](https://www.linkedin.com/in/md-mahadi-hasan-792ba8344/)

---

## 📜 License

This project was developed for educational purposes as part of Assignment 9 - Category 001.
