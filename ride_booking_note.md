# Ride Booking – Vehicle Type Based Driver Alert System

**Professional Requirement & Implementation Notes**

---

## Overview

The original codebase is working perfectly with proper vehicle type filtering.

Using the same logic and functions, a new project has been started for a ride booking application, and the implementation is almost complete.

However, a **critical issue** has been identified in the new project.

---

## Current Issue

When a user books a ride:

❌ **Problem 1:** The ride alert is sent to **all online drivers** (regardless of vehicle type)

❌ **Problem 2:** The vehicle type of all online drivers automatically changes to `taxi`, which should **NEVER** happen

This behavior is **incorrect** and breaks the core business logic.

---

## Correct Expected Behavior

### Step 1: User Selects Vehicle Type

When a user books a ride, the user **must** select a vehicle type:

- `taxi`
- `port`
- `bike`

⚠️ **CRITICAL:** Vehicle types must always be stored and compared in **lowercase only**.

### Step 2: Filter Matching Drivers

Only drivers who are:

1. ✅ **Online** (status: `Live` or `online`)
2. ✅ **Have the same vehicle type** as selected by the user

should receive the ride alert.

Drivers with other vehicle types **must NOT** receive the ride request.

### Step 3: Vehicle Type Immutability

A driver's vehicle type must **NEVER** change automatically:

❌ Not during ride booking
❌ Not during alert broadcasting
❌ Not during socket events
❌ Not during API calls
❌ Not during FCM token updates

✅ **Only changed via:**
- Driver profile update API (by driver)
- Admin panel update (by admin)
- Initial driver registration

---

## Correct Ride Alert Flow

### Step 1: User Books a Ride

User selects:
- Pickup location
- Drop location
- **Vehicle type** (`taxi` | `port` | `bike`)

Ride is created with the selected vehicle type.

### Step 2: Backend Filters Drivers

```javascript
// Fetch only online drivers with matching vehicle type
const matchingDrivers = await Driver.find({
  status: 'Live',
  vehicleType: ride.vehicleType.toLowerCase() // MUST match exactly
});
```

### Step 3: Send Ride Alert

- Send ride request **only to matching drivers**
- Other drivers must be **completely ignored**
- No notification, no socket event, no FCM push

---

## Important Backend Rules

### Vehicle Type Rules

✅ **DO:**
- Store vehicle types in lowercase (`taxi`, `port`, `bike`)
- Set vehicle type only during driver registration
- Filter drivers by exact vehicle type match before sending alerts
- Use case-insensitive comparison (convert to lowercase before comparison)

❌ **DO NOT:**
- Modify vehicle type during ride creation
- Update vehicle type in socket events
- Change vehicle type in notification logic
- Hardcode `taxi` anywhere in ride flow
- Send ride alerts to all drivers without filtering

### Vehicle Type Must Not Be Modified In:

1. ❌ Ride creation logic
2. ❌ Socket events (ride request, ride accepted, etc.)
3. ❌ FCM notification logic
4. ❌ Ride broadcast functions
5. ❌ Driver status update endpoints
6. ❌ FCM token update endpoints

---

## Example Database Structure

### Driver Model

```javascript
{
  "_id": "675abc123def456789",
  "driverId": "DRV001",
  "name": "John Doe",
  "phone": "9876543210",
  "status": "Live",
  "vehicleType": "bike",   // ✅ taxi | port | bike (lowercase only)
  "vehicleNumber": "MH12AB1234",
  "fcmToken": "fcm_token_here",
  "location": {
    "type": "Point",
    "coordinates": [72.8777, 19.0760] // [longitude, latitude]
  }
}
```

### Ride Model

```javascript
{
  "_id": "675xyz123abc456789",
  "RAID_ID": "RIDE1234567890",
  "user": "675user123",
  "vehicleType": "port",   // ✅ Selected by user (lowercase)
  "pickupLocation": {
    "type": "Point",
    "coordinates": [72.8777, 19.0760]
  },
  "dropoffLocation": {
    "type": "Point",
    "coordinates": [72.8877, 19.0860]
  },
  "pickupAddress": "123 Main St, Mumbai",
  "dropoffAddress": "456 Park Ave, Mumbai",
  "status": "searching",
  "fare": 250,
  "createdAt": "2024-01-06T10:30:00.000Z"
}
```

---

## Sample Backend Logic (Reference)

### ✅ CORRECT Implementation

```javascript
// 1. Create ride with user-selected vehicle type
const newRide = new Ride({
  RAID_ID: rideId,
  user: userId,
  vehicleType: req.body.vehicleType.toLowerCase(), // ✅ Normalize to lowercase
  pickupLocation: pickup,
  dropoffLocation: dropoff,
  status: 'searching'
});

await newRide.save();

// 2. Find ONLY matching drivers
const matchingDrivers = await Driver.find({
  status: 'Live',
  vehicleType: newRide.vehicleType, // ✅ Exact match
  fcmToken: { $exists: true, $ne: '' }
});

console.log(`Found ${matchingDrivers.length} ${newRide.vehicleType} drivers`);

// 3. Send alert ONLY to matching drivers
matchingDrivers.forEach(driver => {
  // Socket.IO
  io.to(`driver_${driver.driverId}`).emit('newRideRequest', {
    rideId: newRide.RAID_ID,
    vehicleType: newRide.vehicleType,
    pickup: newRide.pickupAddress,
    fare: newRide.fare
  });
});

// 4. Send FCM to matching drivers
const fcmTokens = matchingDrivers.map(d => d.fcmToken);
await sendNotificationToMultipleDrivers(
  fcmTokens,
  `New ${newRide.vehicleType} Ride`,
  `Pickup: ${newRide.pickupAddress}`
);
```

### ❌ INCORRECT Implementation (DO NOT USE)

```javascript
// ❌ WRONG: Sending to all online drivers
const allDrivers = await Driver.find({ status: 'Live' });

// ❌ WRONG: Not filtering by vehicle type
allDrivers.forEach(driver => {
  io.to(`driver_${driver.driverId}`).emit('newRideRequest', ride);
});

// ❌ WRONG: Modifying driver vehicle type during ride booking
await Driver.updateMany(
  { status: 'Live' },
  { $set: { vehicleType: 'taxi' } } // ❌ NEVER DO THIS
);

// ❌ WRONG: Broadcasting to all drivers room
io.to('allDrivers').emit('newRideRequest', ride); // ❌ No filtering
```

---

## Key APIs / Endpoints (Example)

### 1. Create Ride

```http
POST /api/rides/create
Content-Type: application/json
Authorization: Bearer <token>

{
  "pickup": {
    "lat": 19.0760,
    "lng": 72.8777,
    "address": "123 Main St, Mumbai"
  },
  "drop": {
    "lat": 19.0860,
    "lng": 72.8877,
    "address": "456 Park Ave, Mumbai"
  },
  "vehicleType": "bike"  // ✅ MUST be: taxi | port | bike
}
```

**Response:**
```json
{
  "success": true,
  "message": "Ride booked successfully! Searching for bike drivers...",
  "data": {
    "rideId": "RIDE1234567890",
    "vehicleType": "bike",
    "matchingDrivers": 5,
    "estimatedFare": 150,
    "status": "searching"
  }
}
```

### 2. Get Online Drivers (Filtered)

```http
GET /api/drivers/online?vehicleType=bike
```

**Response:**
```json
{
  "success": true,
  "vehicleType": "bike",
  "count": 5,
  "drivers": [
    {
      "driverId": "DRV001",
      "name": "John Doe",
      "vehicleType": "bike",
      "vehicleNumber": "MH12AB1234",
      "location": {
        "type": "Point",
        "coordinates": [72.8777, 19.0760]
      }
    }
  ]
}
```

### 3. Send Ride Alert (Socket Event)

```javascript
// Socket.IO Event
EVENT: 'newRideRequest'
TARGET: Individual driver rooms (driver_${driverId})

// Payload
{
  "rideId": "RIDE1234567890",
  "vehicleType": "bike",
  "pickup": {
    "lat": 19.0760,
    "lng": 72.8777,
    "address": "123 Main St, Mumbai"
  },
  "drop": {
    "lat": 19.0860,
    "lng": 72.8877,
    "address": "456 Park Ave, Mumbai"
  },
  "fare": 150,
  "distance": "5 km",
  "userName": "Customer Name",
  "userPhone": "9876543210"
}
```

---

## Testing & Verification

### Test Case 1: Bike Ride Booking

**Input:**
```json
{
  "vehicleType": "bike",
  "pickup": { "lat": 19.0760, "lng": 72.8777 },
  "drop": { "lat": 19.0860, "lng": 72.8877 }
}
```

**Expected Result:**
- ✅ Only drivers with `vehicleType: "bike"` receive the alert
- ✅ Taxi and port drivers DO NOT receive any notification
- ✅ No driver's vehicle type is changed
- ✅ Ride is created with `vehicleType: "bike"`

### Test Case 2: Port Ride Booking

**Input:**
```json
{
  "vehicleType": "port",
  "pickup": { "lat": 19.0760, "lng": 72.8777 },
  "drop": { "lat": 19.0860, "lng": 72.8877 }
}
```

**Expected Result:**
- ✅ Only drivers with `vehicleType: "port"` receive the alert
- ✅ Bike and taxi drivers DO NOT receive any notification
- ✅ No driver's vehicle type is changed
- ✅ Ride is created with `vehicleType: "port"`

### Test Case 3: Verify Driver Vehicle Type Persistence

**Before Ride:**
```
Driver A: vehicleType = "bike"
Driver B: vehicleType = "taxi"
Driver C: vehicleType = "port"
```

**After Ride Booking (vehicleType: "taxi"):**
```
Driver A: vehicleType = "bike"  ✅ Unchanged
Driver B: vehicleType = "taxi"  ✅ Unchanged (received alert)
Driver C: vehicleType = "port"  ✅ Unchanged
```

---

## Debug Endpoints for Testing

### 1. Check Drivers by Vehicle Type

```http
GET /api/debug/drivers-by-vehicle
```

**Response:**
```json
{
  "success": true,
  "totalDrivers": 15,
  "byVehicleType": {
    "bike": [
      { "driverId": "DRV001", "name": "John", "status": "Live" },
      { "driverId": "DRV002", "name": "Jane", "status": "Live" }
    ],
    "taxi": [
      { "driverId": "DRV003", "name": "Bob", "status": "Live" }
    ],
    "port": [
      { "driverId": "DRV004", "name": "Alice", "status": "Offline" }
    ]
  }
}
```

### 2. Test Ride-Vehicle Matching

```http
POST /api/test/ride-vehicle-match
Content-Type: application/json

{
  "vehicleType": "bike"
}
```

**Response:**
```json
{
  "success": true,
  "test": {
    "requestedVehicleType": "bike",
    "exactVehicleTypeMatches": 5,
    "allOnlineDrivers": 12,
    "matchesWithFCM": 4,
    "matchPercentage": "41.67%"
  },
  "conclusion": "For bike rides, notifications will be sent to 5 drivers (out of 12 total online drivers)"
}
```

---

## Common Mistakes to Avoid

### ❌ Mistake 1: Broadcasting to All Drivers

```javascript
// ❌ WRONG
io.emit('newRideRequest', ride); // Sends to everyone

// ✅ CORRECT
matchingDrivers.forEach(driver => {
  io.to(`driver_${driver.driverId}`).emit('newRideRequest', ride);
});
```

### ❌ Mistake 2: Updating Driver Vehicle Type

```javascript
// ❌ WRONG
await Driver.findOneAndUpdate(
  { driverId },
  { vehicleType: ride.vehicleType } // Never do this
);

// ✅ CORRECT
// Don't update vehicle type during ride operations
```

### ❌ Mistake 3: Case Sensitivity Issues

```javascript
// ❌ WRONG
driver.vehicleType === 'BIKE' // Won't match 'bike'

// ✅ CORRECT
driver.vehicleType === ride.vehicleType.toLowerCase()
```

### ❌ Mistake 4: Not Filtering Before Notification

```javascript
// ❌ WRONG
const drivers = await Driver.find({ status: 'Live' });
sendNotifications(drivers); // All drivers notified

// ✅ CORRECT
const drivers = await Driver.find({
  status: 'Live',
  vehicleType: ride.vehicleType
});
sendNotifications(drivers); // Only matching drivers
```

---

## Final Conclusion

The system **must** ensure that:

✅ **Vehicle type selection by the user strictly controls driver notifications**

✅ **Driver vehicle types remain unchanged during all ride operations**

✅ **Only relevant drivers receive ride alerts based on exact vehicle type match**

✅ **All vehicle type comparisons use lowercase normalization**

This logic should be followed **consistently** across:
- Backend APIs
- Socket events
- FCM notifications
- Database queries
- Frontend requests

---

## Reference: Working Implementation in Original Project

See the original codebase for working examples:

- **app.js** lines 352-557: `/api/rides/book-ride-enhanced` endpoint
- **app.js** lines 645-830: `/api/rides/book-ride-strict` endpoint
- **socket.js** lines 25-100: `sendFCMNotifications` function
- **models/driver/driver.js** line 20-25: Vehicle type schema definition
- **models/ride.js** line 30-35: Ride vehicle type schema

These implementations demonstrate the **correct** vehicle type filtering approach.

---

**Last Updated:** 2026-01-06
**Status:** Production-Ready Reference Document
