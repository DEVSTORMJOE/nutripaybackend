# NutriPay Backend Routes

This document lists backend HTTP routes (paths, methods, access) to help frontend integration. Prefix for all routes is `/api`.

Authentication & Common
- JWT authentication: `middleware/authMiddleware` protects routes; include header `Authorization: Bearer <token>`.
- Role-based access: `middleware/roleMiddleware` expects role names like `student`, `sponsor`, `vendor`, `delivery`, `admin`.

## /api/auth
- POST /api/auth/register
  - Public. Register a new user.
  - Body: `{ name, email, password, role }` (role: 'student'|'sponsor'|'vendor'|'admin')
  - Response: created user info + token

- POST /api/auth/login
  - Public. Login user.
  - Body: `{ email, password }`
  - Response: `{ token, user }`

- GET /api/auth/me
  - Private (protect). Returns current user (requires Authorization header).
  - Response: user object (no password)

## /api/mealplans
- GET /api/mealplans
  - Public. Returns approved meal plans for listing (used by landing page / students).
  - Response: array of meal plans (includes vendor reference)

## /api/student
- GET /api/student/dashboard
  - Private, role('student'). Student dashboard summary.
  - Response: `{ balance, subscription, walletPublicKey }`

- POST /api/student/select-plan
  - Private, role('student'). Select/subscribe to a meal plan.
  - Body: `{ planId, sponsorId? }`
  - Response: subscription object

- POST /api/student/opt-out
  - Private, role('student'). Cancel active subscription.
  - Response: `{ message }`

- GET /api/student/schedule
  - Private, role('student'). Returns upcoming delivery schedule for student.
  - Response: array of `Delivery` objects

## /api/sponsor
- GET /api/sponsor/dashboard
  - Private, role('sponsor'). Sponsor's dashboard (balance, beneficiaries).
  - Response: `{ balance, beneficiaries }`

- POST /api/sponsor/fund-wallet
  - Private, role('sponsor'). Fund a student's wallet (performs Stellar payment in prototype).
  - Body: `{ studentId, amount }`
  - Response: `{ message, txHash }` or error

- GET /api/sponsor/student/:id
  - Private, role('sponsor'). Get student details for sponsor.
  - Response: `{ student, subscription }`

## /api/vendor
- GET /api/vendor/dashboard
  - Private, role('vendor'). Vendor dashboard stats (activePlans, activeSubscriptions, balance).

- POST /api/vendor/mealplans
  - Private, role('vendor'). Create a meal plan (creates pending approval plan).
  - Body: `{ name, price, description, meals }` where `meals` is array of { day, meal }

- GET /api/vendor/mealplans
  - Private, role('vendor'). Get meal plans for the vendor (management view).

- GET /api/vendor/orders
  - Private, role('vendor'). Get active orders/deliveries for the vendor.

- PUT /api/vendor/orders/:id
  - Private, role('vendor'). Update an order/delivery status (e.g., 'preparing','ready','delivered').
  - Body: `{ status }`

## /api/delivery
- GET /api/delivery/assigned
  - Private, role('delivery', 'vendor'). Get assigned deliveries for delivery agents (vendor may also view).

- POST /api/delivery/complete
  - Private, role('delivery'). Mark a delivery complete.
  - Body: `{ deliveryId }`

- GET /api/delivery/history
  - Private, role('delivery'). Get delivery history for agent.

## /api/wallet
- GET /api/wallet/balance
  - Private. Returns `{ balance, publicKey }` for the authenticated user's wallet.

- GET /api/wallet/transactions
  - Private. Returns transaction list for the authenticated user's wallet.

## /api/payment
- POST /api/payment/checkout
  - Private. Endpoint used for checkout/payments flows (calls into `paymentController`).
  - Body: payment details depending on frontend flow.

## /api/admin
- GET /api/admin/dashboard
  - Private, role('admin'). System stats (totalUsers, totalPlans, networkLiquidity).

- GET /api/admin/users
  - Private, role('admin'). List all users (no passwords).

- GET /api/admin/pending
  - Private, role('admin'). Returns pending vendors and pending meal plans for approvals.

- POST /api/admin/approve/mealplan
  - Private, role('admin'). Approve or reject a meal plan.
  - Body: `{ planId, status }` where status is 'approved' or 'rejected'.

- POST /api/admin/approve/vendor
  - Private, role('admin'). Approve or reject a vendor account.
  - Body: `{ vendorId, status }`

## /api/notifications
- GET /api/notifications
  - Private. Returns recent notifications aggregated from Transactions and Deliveries for the user.
  - Response: array of notification objects `{ type, title, message, time, meta }`.

## Models referenced
- User, Wallet, MealPlan, Subscription, Transaction, Delivery, Vendor — see `/backend/models` for schema details.

## Helpful notes for frontend engineer
- API base: default `http://localhost:5000/api`. The frontend client reads `REACT_APP_API_URL` to override (e.g., set to `http://localhost:5001/api`).
- Protect middleware: include `Authorization: Bearer <JWT>` header for protected routes.
- Role middleware: pass only users of matching role to role-protected endpoints.
- Payment & Stellar: backend uses a `stellarService` prototype that expects custodial secret keys for sponsor flows; in production sponsors should sign client-side.

## Dev utilities
- Seed admins: `backend/scripts/seedAdmins.js` — creates two admin users:
  - `admin@example.com` / `Admin@123`
  - `superadmin@example.com` / `SuperAdmin@123`
  Run: `cd backend && npm run seed:admins` (requires MongoDB running)

## Running the servers (local)
- Backend (defaults read from `backend/.env`):
  - `node server.js` or `PORT=5001 node server.js` to run on alternate port
- Frontend (set API base if backend port differs):
  - `REACT_APP_API_URL='http://localhost:5001/api' npm start`

If you want, I can also generate a small OpenAPI/Swagger spec from the controllers to use alongside this document.
