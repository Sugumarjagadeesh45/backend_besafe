# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **ride-booking and grocery delivery backend** built with Node.js, Express, MongoDB, and Socket.IO. It serves as the API backend for:
- User app (ride booking, grocery ordering)
- Driver app (ride management, location tracking)
- Admin dashboard (driver management, order management)

**Tech Stack:**
- Node.js + Express.js
- MongoDB (Mongoose ODM)
- Socket.IO (real-time communication)
- Firebase Cloud Messaging (push notifications)
- JWT authentication

## Development Commands

### Start the server
```bash
npm start
# Runs: node server.js
# Server starts on port 5001 (or PORT from .env)
```

### Install dependencies
```bash
npm install
```

## Environment Setup

Required environment variables (create `.env` file):
```
MONGODB_URI=mongodb://...
JWT_SECRET=your_jwt_secret
PORT=5001
NODE_ENV=development
BACKEND_URL=http://localhost:5001
```

Optional:
- Firebase Admin SDK configuration file: `firebase-service-account.json` (for FCM notifications)

## Architecture Overview

### Entry Points
1. **server.js** - Main entry point that:
   - Connects to MongoDB via `config/db.js`
   - Creates HTTP server
   - Initializes Socket.IO
   - Initializes ride prices
   - Initializes Firebase Admin SDK (optional, for FCM)
   - Starts server on configured port
   - Handles graceful shutdown (SIGINT/SIGTERM)

2. **app.js** - Express application setup with:
   - CORS configuration (supports multiple origins)
   - Middleware (morgan, express.json, express.urlencoded)
   - Static file serving (`/uploads`)
   - All route definitions (see Routes section below)
   - Many **direct endpoints** defined inline (not in route files)
   - **WARNING:** This file is massive (~4500+ lines with mixed concerns)

3. **socket.js** - Socket.IO configuration for real-time features
   - Driver location updates and room management
   - Ride request broadcasting
   - Real-time status updates
   - **WARNING:** This file is extremely large (~55k tokens)
   - **IMPORTANT:** The `init` function creates the Socket.IO instance from the HTTP server
   - Called from server.js: `socket.init(server)` where `server` is the HTTP server
   - Returns io instance via `getIO()` for use in controllers

### Key Models

**Driver Model** (`models/driver/driver.js`):
- Sequential driver ID generation (`dri10001`, `dri10002`, etc.)
- GeoJSON location tracking with 2dsphere index
- FCM token management for push notifications
- Vehicle type field: `PORT`, `TAXI`, `BIKE`
- Status: `Live` or `Offline`
- Wallet, earnings, ratings, ride statistics
- Working hours management fields (see Working Hours System below)

**Ride Model** (`models/ride.js`):
- Unique `RAID_ID` for each ride
- References to User and Driver
- Pickup/dropoff locations with coordinates
- Status flow: `pending` → `accepted` → `arrived` → `started` → `ongoing` → `completed` or `cancelled`
- Vehicle type matching (must match driver's vehicleType)
- OTP verification for ride start
- Rating and feedback system

**User/Registration Model** (`models/user/Registration.js`):
- Auto-generated customerId (6-digit, starts at 100000)
- Phone-based authentication
- Wallet system
- Profile and address management

**Order Model** (`models/Order.js`):
- Grocery/product orders
- Status tracking (pending → order_confirmed → processing → packed → shipped → out_for_delivery → delivered)

### Route Structure

Routes are registered in `app.js` around line 3078. Main route files:

- `/api/auth/*` - authRoutes.js (user/driver authentication)
- `/api/admin/*` - adminRoutes.js (admin dashboard operations)
- `/api/drivers/*` - driverRoutes.js (driver operations)
- `/api/rides/*` - rideRoutes.js (ride management)
- `/api/users/*` - userRoutes.js (user profile, addresses)
- `/api/wallet/*` - walletRoutes.js (wallet operations)
- `/api/orders/*` - orderRoutes.js (grocery orders)
- `/api/grocery/*` - groceryRoutes.js (grocery products)
- `/api/banners/*` - Banner.js (promotional banners)
- `/api/notifications/*` - notificationRoutes.js (FCM notifications)
- `/api/ride-prices/*` - ridePriceRoutes.js (fare calculation)
- `/api/route/*` - routeRoutes.js (route management)
- `/api/driver-location-history/*` - driverLocationHistoryRoutes.js (location history)
- `/api/test/*` - testRoutes.js (testing utilities)

**IMPORTANT:** Many critical endpoints are defined **directly in app.js** rather than in route files:
- `/api/admin/drivers` - Get all drivers (direct admin endpoint)
- `/api/admin/direct-wallet/:driverId` - Direct wallet updates
- `/api/admin/driver/:id/toggle` - Toggle driver status
- `/api/rides/book-ride-enhanced` - Enhanced ride booking with vehicle type filtering
- `/api/rides/book-ride-strict` - Strict vehicle type matching for ride requests
- `/api/drivers/update-status` - Update driver online/offline status
- `/api/drivers/available/:vehicleType` - Get available drivers by vehicle type
- `/api/auth/verify-phone` - Phone verification
- `/api/auth/register` - User registration
- `/api/auth/request-driver-otp` - Driver OTP request
- `/api/auth/get-complete-driver-info` - Complete driver info after login
- `/api/drivers/start-working-hours` - Start driver working hours timer
- `/api/drivers/stop-working-hours` - Stop driver working hours timer
- `/api/drivers/working-hours-status/:driverId` - Get working hours timer status
- `/api/drivers/purchase-extended-hours` - Purchase extended working hours (₹100)
- `/api/drivers/pause-working-hours` - Pause working hours timer
- `/api/drivers/resume-working-hours` - Resume working hours timer
- `/api/drivers/skip-warning` - Skip working hours warning
- `/api/admin/driver/:driverId/working-hours` - Admin update working hours limit
- `/api/orders/admin/orders` - Get all orders (admin)
- `/api/orders/admin/order-stats` - Get order statistics (admin)
- `/api/orders/admin/orders/update/:id` (also `/api/orders/admin/update/:id`, `/api/orders/admin/order/update-by-id/:id`) - Update order by ID (admin, multiple URL aliases)

Always check `app.js` for direct endpoint definitions before creating new route files.

### Critical Business Logic

**Vehicle Type Filtering (CRITICAL):**
When booking rides or sending notifications, drivers MUST be filtered by exact vehicle type match:
- User selects: `PORT`, `TAXI`, or `BIKE`
- System finds drivers where `vehicleType` === selected type (case-insensitive, uppercase in DB)
- Notifications sent ONLY to matching drivers
- Socket events sent ONLY to matching drivers

Example:
```javascript
const matchingDrivers = await Driver.find({
  status: 'Live',
  vehicleType: vehicleType.toUpperCase(), // Exact match
  fcmToken: { $exists: true, $ne: '' }
});
```

**Driver ID Generation:**
- Uses Counter model to generate sequential IDs
- Format: `dri10001`, `dri10002`, etc.
- See `Driver.generateDriverId()` static method

**Ride ID Generation:**
- Format: `RIDE{timestamp}{random3digits}`
- Must be unique and non-null
- Example: `RIDE1703123456789123`

**Customer ID Generation:**
- Uses Counter model with `customerId` key
- Format: 6-digit starting from 100001
- See user registration in `app.js`

### Real-Time Communication (Socket.IO)

Socket.IO handles:
- Driver location updates
- Ride request broadcasts (filtered by vehicle type)
- Ride status updates
- User location tracking during active rides
- Driver-to-room joining (`driver_${driverId}`)

**Key Socket Events:**
- `newRideRequest` - Sent to drivers when ride is booked (filtered by vehicle type)
- `newRideAvailable` - Alternative event name for ride notifications
- `rideCompleted` - Sent to user when ride is completed
- `locationUpdate` - Driver location updates
- `workingHoursWarning` - Warning notifications (1/3, 2/3, 3/3)
- `autoStopCompleted` - Driver forced offline due to expired working hours
- `driverOffline` - Driver goes offline (emitted by driver app)
- `driverOnline` - Driver goes online (emitted by driver app)

**Socket Rooms:**
- `driver_${driverId}` - Individual driver room for targeted messages
- Drivers join their own room on connection

### Firebase Cloud Messaging (FCM)

FCM is used for push notifications to driver apps:
- Initialized in `config/firebaseConfig.js`
- Requires `firebase-service-account.json` file
- Used for critical ride notifications when drivers might not have app open
- Notification service: `services/firebaseService.js`

### Working Hours Management System

**Overview:**
Drivers have an automatic working hours tracking system with:
- Backend countdown timer (12 or 24 hours, configurable per driver)
- 3-stage warning system with FCM notifications
- Automatic wallet deductions (₹100) for extended hours
- Auto-stop when time expires (driver set to Offline)
- Real-time timer updates via polling

**Service:** `services/workingHoursService.js`
- Maintains in-memory Map of active timers (driverId → intervalId)
- Updates every second, logs every minute
- Warnings at: 11h (1h remaining), 11.5h (30m remaining), 11:50h (10m remaining) for 12-hour shifts
- Auto-deduction: If driver skips all 3 warnings, ₹100 deducted automatically and 12 hours added
- Manual purchase: Driver can purchase extended hours at any warning (₹100 for 12 hours)

**Driver Model Fields:**
- `workingHoursLimit`: 12 or 24 hours (default: 12)
- `additionalWorkingHours`: Extra hours purchased
- `onlineStartTime`: When timer started
- `remainingWorkingSeconds`: Current remaining time
- `timerActive`: Boolean flag
- `warningsIssued`: Count (0-3)
- `lastWarningTime`: Timestamp of last warning
- `autoStopScheduled`: Flag for auto-stop
- `extendedHoursPurchased`: If driver purchased extra hours
- `walletDeducted`: If ₹100 was deducted
- `workingHoursDeductionAmount`: Amount to deduct (default: 100)

**Key Functions:**
- `startWorkingHoursTimer(driverId)` - Start timer when driver goes online
- `stopWorkingHoursTimer(driverId)` - Stop timer when driver goes offline
- `pauseWorkingHoursTimer(driverId)` - Pause timer (keeps remaining time)
- `resumeWorkingHoursTimer(driverId)` - Resume paused timer
- `purchaseExtendedHours(driverId, hours)` - Deduct ₹100, add hours, reset warnings
- `getTimerStatus(driverId)` - Get current timer status with formatted time

**Integration Points:**
- FCM notifications sent via `services/firebaseService.js`
- Socket.IO events: `workingHoursWarning`, `autoStopCompleted`
- Driver app should poll `/api/drivers/working-hours-status/:driverId` every 5 seconds

**Reference:** See `WORKING_HOURS_IMPLEMENTATION_GUIDE.md` for detailed implementation

### Authentication

**JWT-based authentication:**
- Users: Phone-based OTP → JWT token
- Drivers: Phone-based OTP → JWT token with driver info
- Admin: Standard login with credentials
- Middleware: `middleware/authMiddleware.js`
- Token format: `Bearer {token}`

### File Uploads

Static files served from `/uploads` directory:
- Driver documents (license, aadhar)
- Profile pictures
- Product images
- Created automatically if doesn't exist

## Database Patterns

**Counter Pattern:**
Used for sequential ID generation across multiple models:
- `models/user/customerId.js` - Customer IDs
- `models/user/counter.js` - Generic counter
- `Counter` schema in driver model - Driver IDs

**GeoJSON for Location:**
```javascript
location: {
  type: { type: String, enum: ["Point"], default: "Point" },
  coordinates: { type: [Number], required: true } // [longitude, latitude]
}
```
Always use `2dsphere` index for location-based queries.

## Common Pitfalls

1. **Vehicle Type Case Sensitivity:** Always uppercase vehicle types (`PORT`, `TAXI`, `BIKE`) when storing/querying
2. **RAID_ID Validation:** Never allow null or empty RAID_ID values
3. **Driver Notifications:** Always filter by vehicle type before sending notifications
4. **Location Coordinates:** GeoJSON uses `[longitude, latitude]` order (not lat, lng)
5. **Socket Room Naming:** Driver rooms use format `driver_${driverId}`
6. **FCM Token Validation:** Check token exists and length > 10 before sending
7. **Direct Endpoints:** Check `app.js` for inline endpoints before creating route files
8. **Working Hours Timers:** Timers are in-memory only - server restart clears all active timers (drivers need to restart)
9. **File Uploads:** Multer configuration in `app.js` - check storage settings before modifying upload logic

## Testing & Debugging

### Debug Endpoints
- `GET /api/debug/ride/:rideId` - Check ride details
- `GET /api/debug/drivers-by-vehicle` - List drivers grouped by vehicle type
- `GET /api/test-drivers` - Get all drivers with vehicle types
- `GET /api/orders/test-connection` - Test orders API connection

### Testing Working Hours System
For quick testing, modify warning thresholds in `services/workingHoursService.js`:
```javascript
// Change from hours to minutes for testing:
if (remainingHours <= 0.05) // Warning 1 at 3 minutes
if (remainingHours <= 0.03) // Warning 2 at 2 minutes
if (remainingHours <= 0.01) // Warning 3 at 30 seconds
```

### Manual Testing
Use Postman/curl to test endpoints:
```bash
# Start timer
POST http://localhost:5001/api/drivers/start-working-hours
Body: { "driverId": "dri10001" }

# Check status
GET http://localhost:5001/api/drivers/working-hours-status/dri10001

# Purchase extended hours
POST http://localhost:5001/api/drivers/purchase-extended-hours
Body: { "driverId": "dri10001", "additionalHours": 12 }
```

## Code Organization Notes

**app.js is massive (~4500+ lines):**
- Contains both route registrations AND direct endpoint definitions
- Many critical endpoints are NOT in separate route files
- When adding new endpoints, prefer creating route files for organization
- However, some legacy endpoints remain inline

**socket.js is very large:**
- Contains all real-time logic
- May need refactoring into smaller modules
- Handle with care when reading (use offset/limit parameters)

## Mongoose Connection

Database connection managed in `config/db.js`:
- Auto-reconnect enabled
- Connection event handlers for monitoring
- Graceful shutdown in server.js

## Logging & Console Output

Morgan HTTP logger used for request logging in dev mode.
Console logs use emojis for visual clarity:
- ✅ Success operations
- ❌ Errors
- 🔍 Searches/queries
- 📱 FCM notifications
- 🚗 Driver operations
- 📦 Orders
- 💰 Wallet/payments
- ⏱️ Working hours timer operations
- ⚠️ Working hours warnings
- 🛑 Auto-stop events
- 🚀 Server startup
- 🌐 CORS requests

## Services Layer

**Firebase Service** (`services/firebaseService.js`):
- FCM notification delivery to drivers
- Requires Firebase Admin SDK initialized
- Functions: `sendNotificationToDriver(token, title, body, data)`

**Notification Service** (`services/notificationService.js`):
- General notification handling
- May wrap Firebase service

**Working Hours Service** (`services/workingHoursService.js`):
- Timer management (in-memory Map)
- Warning system
- Wallet deduction logic
- Auto-stop functionality

## Important Files Not in Routes

- `initializeCounter.js` - Script to initialize Counter collection
- `config/db.js` - MongoDB connection with reconnection logic
- `config/firebaseConfig.js` - Firebase Admin SDK initialization
- `middleware/authMiddleware.js` - JWT authentication middleware
