# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Taxi + Grocery Delivery Backend** built with Node.js, Express, MongoDB, and Socket.IO. It serves both a ride-hailing platform (supporting bikes, taxis, and porter vehicles) and a grocery ordering system through a single unified backend.

**Tech Stack:**
- Node.js + Express 5.x
- MongoDB with Mongoose ODM
- Socket.IO for real-time features
- Firebase Admin SDK for push notifications (FCM)
- JWT for authentication

## Running the Application

```bash
# Install dependencies
npm install

# Start the server
npm start

# Development server (default port 5001)
node server.js
```

The server will:
1. Connect to MongoDB using `MONGODB_URI` from `.env`
2. Initialize Firebase Admin SDK for FCM notifications
3. Start Socket.IO server for real-time features
4. Listen on port 5001 (or `PORT` env variable)

**Required environment variables:**
- `MONGODB_URI` - MongoDB connection string
- `JWT_SECRET` - Secret for JWT token signing
- Firebase credentials (see `.env` for details)

## Architecture Overview

### Core Entry Points

1. **server.js** - Application bootstrap
   - Initializes MongoDB connection
   - Creates HTTP server
   - Initializes Socket.IO
   - Starts working hours service
   - Sets up graceful shutdown handlers

2. **app.js** - Express application setup
   - Configures middleware (CORS, body-parser, morgan)
   - Defines direct endpoints for critical operations
   - Loads and mounts all route modules
   - Contains fallback implementations for admin operations

3. **socket.js** - Real-time WebSocket layer
   - Manages driver location updates
   - Handles ride request broadcasting
   - Manages driver-user real-time communication
   - Implements ride matching and notifications

### Vehicle Type System (CRITICAL)

The system enforces **strict vehicle type filtering** to ensure rides are only sent to matching vehicle types:

- Vehicle types: `bike`, `taxi`, `port` (always lowercase in database)
- Driver's `vehicleType` field is **immutable** after admin registration
- Ride requests filter drivers by exact vehicle type match
- Both Driver and Ride schemas auto-convert to lowercase

**Key endpoints for vehicle-type filtering:**
- `/api/rides/book-ride-enhanced` - Enhanced ride booking with vehicle type filtering
- `/api/rides/book-ride-strict` - Strict vehicle type matching
- `/api/drivers/available/:vehicleType` - Get available drivers by vehicle type

### Working Hours Management System

Located in `services/workingHoursService.js` - Manages driver working time limits:

- Default working hours: 12 or 24 hours (configurable per driver)
- Timer starts when driver goes Live
- Automatic warnings at specific intervals
- Auto-stop functionality after timer expires
- Extension purchase system (₹50 for half time, ₹100 for full time)
- Wallet integration for automatic deductions

**Key endpoints:**
- `/api/drivers/working-hours/start` - Start timer when driver goes online
- `/api/drivers/working-hours/stop` - Stop timer when driver goes offline
- `/api/drivers/working-hours/extend` - Purchase extended hours
- `/api/drivers/working-hours/add-half-time` - Add half time (based on shift config)
- `/api/drivers/working-hours/add-full-time` - Add full time (based on shift config)

### Real-Time Features (Socket.IO)

**Driver Events:**
- `updateLocation` - Driver location updates (continuous while Live)
- `rideAccepted` - Driver accepts a ride
- `rideArrived` - Driver arrives at pickup
- `rideStarted` - Ride journey begins
- `rideCompleted` - Ride ends with distance/fare

**User Events:**
- `rideRequest` - User requests a ride
- `trackDriver` - Real-time driver location tracking during ride
- `rideCompleted` - Receive bill and completion notification
- `billAlert` - Critical event for showing bill to user

**Admin Events:**
- `newOrder` - New grocery order notification
- Wallet updates, driver status changes

### Authentication & User Management

**User Registration Flow:**
1. Firebase phone OTP verification (client-side)
2. `/api/auth/verify-phone` - Check if user exists
3. `/api/auth/register` - Register new user with auto-generated customerId
4. JWT token issued with 30-day expiration

**Driver Authentication:**
1. Admin creates driver with vehicle type (immutable)
2. `/api/auth/request-driver-otp` - Verify driver exists by phone
3. Firebase OTP verification (client-side)
4. `/api/auth/get-complete-driver-info` - Get full driver data + JWT token

**Middleware:** `authenticateToken` middleware for protected routes

### Ride Lifecycle

1. **Booking:** User creates ride via `/api/rides/book-ride-enhanced`
   - Generates unique RAID_ID
   - Stores pickup/dropoff coordinates and addresses
   - Filters drivers by exact vehicle type match
   - Sends FCM notifications + Socket.IO events to matching drivers only

2. **Acceptance:** Driver accepts via Socket.IO `rideAccepted` event
   - Updates ride status to 'accepted'
   - Associates driver with ride
   - Notifies user via Socket.IO

3. **Journey:** Status progression: `arrived` → `started` → `ongoing`
   - Real-time location tracking via Socket.IO
   - User can track driver location

4. **Completion:** Driver completes ride via `/api/rides/simple-complete`
   - Calculates final fare using ride prices (per km)
   - Updates driver wallet
   - Emits `billAlert` event (CRITICAL - must emit first)
   - Emits `rideCompleted` event (without status to prevent premature navigation)

### Pricing System

**Dynamic Pricing Controller** (`controllers/ridePriceController.js`):
- Admin-configurable prices per vehicle type
- Prices stored in `RidePrice` model
- In-memory cache for fast access
- Initialize default prices on server start
- API: `/api/admin/ride-prices`

**Default prices (per km):**
- Bike: ₹15/km
- Taxi: ₹40/km
- Port: ₹75/km

### Wallet System

**Driver Wallet:**
- Located in `Driver.wallet` field
- Credits: Ride fare added on completion
- Debits: Working hours extensions, auto-deductions
- Transaction history in `Transaction` model
- Endpoints: `/api/admin/direct-wallet/:driverId`

**User Wallet:**
- Located in `Registration.wallet` field
- Credits: Ride cashback/loyalty (via `/api/wallet/pay-ride`)
- Endpoints: `/api/wallet/balance`, `/api/wallet/add-money`

### Order Management (Grocery)

**Order Models:** `models/Order.js`

**Order Status Flow:**
- `order_confirmed` → `processing` → `packed` → `shipped` → `out_for_delivery` → `delivered`

**Key Endpoints:**
- `/api/orders/create` - Place new order (auth required)
- `/api/orders/admin/orders` - Admin: fetch all orders (paginated)
- `/api/orders/admin/order-stats` - Admin: order statistics
- `/api/orders/admin/update/:id` - Admin: update order status

### Firebase Integration

**FCM Service** (`services/firebaseService.js`):
- Sends push notifications to drivers and users
- Multicast support for bulk notifications
- Used for ride requests, status updates, working hours warnings

**Configuration:**
- Firebase Admin SDK initialized in `config/firebaseConfig.js`
- Service account credentials in `.env`
- Graceful degradation if Firebase initialization fails

## Directory Structure

```
├── app.js                    # Express app configuration + direct endpoints
├── server.js                 # Server bootstrap
├── socket.js                 # Socket.IO real-time layer
├── config/
│   ├── db.js                # MongoDB connection
│   └── firebaseConfig.js    # Firebase initialization
├── controllers/             # Business logic
│   ├── adminController.js
│   ├── driverController.js  # (Note: driver/ subfolder exists)
│   ├── rideController.js
│   ├── ridePriceController.js
│   ├── orderController.js
│   ├── groceryController.js
│   └── walletController.js
├── models/
│   ├── driver/
│   │   ├── driver.js        # Driver schema (vehicleType immutable)
│   │   └── transaction.js   # Driver wallet transactions
│   ├── user/
│   │   ├── Registration.js  # User accounts
│   │   ├── customerId.js    # Auto-increment counter
│   │   └── ...
│   ├── ride.js              # Ride schema
│   ├── Order.js             # Grocery orders
│   ├── RidePrice.js         # Dynamic pricing
│   └── ...
├── routes/                  # Route handlers
│   ├── adminRoutes.js
│   ├── driverRoutes.js
│   ├── rideRoutes.js
│   ├── orderRoutes.js
│   ├── authRoutes.js
│   └── ...
├── services/
│   ├── firebaseService.js   # FCM notifications
│   ├── workingHoursService.js # Driver working hours timer
│   └── notificationService.js
├── middleware/              # Express middleware
└── uploads/                 # File uploads (static serving)
```

## Critical Implementation Details

### Vehicle Type Immutability

**DO NOT** update a driver's `vehicleType` after admin registration:
- Set once during driver creation by admin
- Never modified via FCM token updates, status changes, or driver app updates
- Any code attempting to update `vehicleType` post-registration should be removed

### Ride Completion Event Order

When completing rides, **always emit events in this order:**

```javascript
// 1. FIRST: billAlert (triggers bill display)
io.to(userId).emit("billAlert", { /* bill data */ });

// 2. SECOND: rideCompleted (triggers status updates)
io.to(userId).emit('rideCompleted', { /* WITHOUT status field */ });
```

Emitting in wrong order or including `status: 'completed'` in `rideCompleted` causes premature navigation before bill display.

### Socket.IO Room Naming

- Driver rooms: `driver_${driverId}`
- User rooms: User's MongoDB `_id` as string
- Broadcast to specific vehicle types: Individual emission to driver rooms, NOT to `allDrivers`

### MongoDB Schema Considerations

- Use lowercase for enums that need case-insensitive matching (`vehicleType`, `rideType`)
- Set `lowercase: true` on schema fields for auto-normalization
- Use GeoJSON `Point` for location fields with [longitude, latitude] order

### Error Handling Philosophy

- Server continues running even if MongoDB connection fails initially
- Socket.IO features remain available during DB downtime
- Firebase initialization errors are logged but don't crash server
- Graceful degradation over catastrophic failures

## Common Operations

### Adding a New Admin Endpoint

Many critical admin operations are defined directly in `app.js` before route loading:
- Direct driver wallet updates
- Driver status toggles
- Simple ride completion
- Admin driver listing

Check `app.js` first before modifying routes for admin operations.

### Testing Vehicle Type Filtering

Use debug endpoints:
- `/api/debug/drivers-by-vehicle` - Group drivers by vehicle type
- `/api/debug/vehicle-types` - Vehicle type statistics
- `/api/test/ride-vehicle-match` - Test ride matching for specific vehicle type

### Modifying Ride Prices

Prices are cached in-memory for performance:
1. Update via admin API: `/api/admin/ride-prices`
2. `ridePriceController.initializePrices()` is called on server start
3. `ridePriceController.getCurrentPrices()` returns in-memory cache

### Working with Socket.IO

1. Get IO instance: `const io = req.app.get('io');`
2. Emit to specific user: `io.to(userId).emit('eventName', data);`
3. Emit to specific driver: `io.to(`driver_${driverId}`).emit('eventName', data);`
4. Services can access IO after `workingHoursService.init(io)` is called

## Database Models Reference

**Key Model Relationships:**
- `Ride.user` → `Registration._id`
- `Ride.driver` → `Driver._id`
- `Order.userId` → `Registration._id`
- `Transaction.driver` → `Driver._id`

**Auto-increment Counters:**
- `customerId` counter for user registration
- `orderId` counter for grocery orders
- Located in `models/user/customerId.js` and `models/user/counter.js`

## Testing & Debugging

**Test Endpoints:**
- `/api/test-connection` - Verify API is live
- `/api/test-drivers` - List all drivers grouped by vehicle type
- `/api/orders/test-connection` - Verify order routes

**Logging:**
- Morgan middleware logs all HTTP requests
- Extensive console logging with emoji prefixes (🚗, ✅, ❌, 💰, etc.)
- Check working hours timer logs for driver session management

## Firebase Cloud Messaging (FCM)

**Notification Types:**
- `ride_request` - New ride available for drivers
- `ride_status` - Ride status changes for users
- `working_hours_warning` - Timer warnings for drivers

**Data Payload Requirements:**
- All values must be strings (convert numbers with `.toString()`)
- Avoid reserved keys like `sound` in data object
- Use `android.priority: 'high'` for critical notifications

## Important Notes

1. **Never force push to main/master** - The git status shows this is the main branch
2. **Vehicle Type Case Sensitivity** - Always use lowercase internally, display as uppercase in UI
3. **RAID_ID is required** - Rides cannot be created without a valid, unique RAID_ID
4. **Transaction History** - Driver wallet changes must create Transaction records
5. **Working Hours Timer** - Must be stopped/paused when driver goes offline to prevent incorrect deductions
6. **Socket.IO initialization** - `socket.init(server)` must be called before any socket operations
7. **Uploads Directory** - Served statically at `/uploads`, created automatically on startup
