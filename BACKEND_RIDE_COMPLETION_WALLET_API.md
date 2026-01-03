# Backend API - Ride Completion & Wallet Credit

**Date**: 2025-12-31
**Purpose**: API specification for ride completion with automatic wallet credit
**Status**: Implementation Guide

---

## Overview

When a ride is completed, the system must:
1. Mark ride as completed in database
2. **Credit ride amount to user's wallet** (not driver's wallet)
3. Create transaction record
4. Return updated wallet balance to frontend
5. Send socket event to user with billing details

---

## API Endpoint Specification

### **POST `/api/rides/complete`**

**Description**: Complete a ride and credit amount to user's wallet

**Request Headers**:
```
Authorization: Bearer <driver_jwt_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "rideId": "RIDE1703123456789",
  "distance": 5.2,
  "duration": 18,
  "fareBreakdown": {
    "baseFare": 50,
    "distanceCharge": 52,
    "timeCharge": 18,
    "surcharge": 0
  },
  "totalAmount": 120,
  "endLocation": {
    "latitude": 12.9716,
    "longitude": 77.5946,
    "address": "MG Road, Bangalore"
  }
}
```

**Response** (Success):
```json
{
  "success": true,
  "message": "Ride completed successfully",
  "ride": {
    "rideId": "RIDE1703123456789",
    "status": "completed",
    "distance": 5.2,
    "duration": 18,
    "totalAmount": 120,
    "completedAt": "2025-12-31T10:30:00.000Z"
  },
  "user": {
    "userId": "user10001",
    "walletBalance": 1370,
    "previousBalance": 1250
  },
  "fareBreakdown": {
    "baseFare": 50,
    "distanceCharge": 52,
    "timeCharge": 18,
    "surcharge": 0,
    "total": 120
  }
}
```

**Response** (Error):
```json
{
  "success": false,
  "message": "Ride not found or already completed"
}
```

---

## Implementation

### 1. Controller Implementation

```javascript
// controllers/ride.controller.js

const Ride = require('../models/Ride');
const User = require('../models/user/Registration');
const Transaction = require('../models/user/Transaction');
const { getIO } = require('../socket');

/**
 * Complete ride and credit amount to user's wallet
 * POST /api/rides/complete
 */
const completeRide = async (req, res) => {
  try {
    const {
      rideId,
      distance,
      duration,
      fareBreakdown,
      totalAmount,
      endLocation
    } = req.body;

    // Validate request
    if (!rideId || !totalAmount) {
      return res.status(400).json({
        success: false,
        message: 'Ride ID and total amount are required'
      });
    }

    // Find ride
    const ride = await Ride.findOne({ RAID_ID: rideId })
      .populate('user')
      .populate('driver');

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      });
    }

    // Check if ride already completed
    if (ride.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Ride already completed'
      });
    }

    // Update ride details
    ride.status = 'completed';
    ride.distance = distance;
    ride.duration = duration;
    ride.fare = totalAmount;
    ride.fareBreakdown = fareBreakdown;
    ride.dropoffLocation = endLocation;
    ride.completedAt = new Date();

    await ride.save();

    // ✅ CREDIT AMOUNT TO USER'S WALLET (NOT DRIVER'S)
    const user = await User.findById(ride.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const previousBalance = user.wallet || 0;
    user.wallet = previousBalance + totalAmount;

    await user.save();

    // Create transaction record for user
    const transaction = new Transaction({
      userId: user._id,
      type: 'credit',
      category: 'ride_earning',
      amount: totalAmount,
      description: `Ride completed - ${distance} km in ${duration} mins`,
      balanceAfter: user.wallet,
      rideId: ride._id,
      date: new Date()
    });

    await transaction.save();

    console.log(`✅ Ride ${rideId} completed. User ${user.customerId} wallet credited: ₹${totalAmount}. New balance: ₹${user.wallet}`);

    // Send socket event to user
    const io = getIO();
    io.to(`user_${user._id}`).emit('rideCompleted', {
      rideId: ride.RAID_ID,
      distance: ride.distance,
      duration: ride.duration,
      fareBreakdown: ride.fareBreakdown,
      totalAmount: ride.fare,
      walletBalance: user.wallet,
      previousBalance: previousBalance,
      completedAt: ride.completedAt
    });

    // Response
    return res.json({
      success: true,
      message: 'Ride completed successfully',
      ride: {
        rideId: ride.RAID_ID,
        status: ride.status,
        distance: ride.distance,
        duration: ride.duration,
        totalAmount: ride.fare,
        completedAt: ride.completedAt
      },
      user: {
        userId: user.customerId,
        walletBalance: user.wallet,
        previousBalance: previousBalance
      },
      fareBreakdown: ride.fareBreakdown
    });

  } catch (error) {
    console.error('❌ Error completing ride:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to complete ride',
      error: error.message
    });
  }
};

module.exports = {
  completeRide
};
```

---

### 2. User Transaction Model

**File**: `models/user/Transaction.js`

```javascript
const mongoose = require('mongoose');

const userTransactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['credit', 'debit'],
    required: true
  },
  category: {
    type: String,
    enum: [
      'ride_earning',      // Money earned from completed rides
      'wallet_added',      // User added money to wallet
      'wallet_withdrawn',  // User withdrew money
      'refund',           // Refund for cancelled ride
      'bonus',            // Bonus/incentive
      'purchase'          // Purchase made using wallet
    ],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  balanceAfter: {
    type: Number,
    required: true
  },
  rideId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ride',
    default: null
  },
  date: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Index for efficient queries
userTransactionSchema.index({ userId: 1, date: -1 });

module.exports = mongoose.model('UserTransaction', userTransactionSchema);
```

---

### 3. User Model Update

**File**: `models/user/Registration.js`

Ensure the User model has a `wallet` field:

```javascript
const userSchema = new mongoose.Schema({
  customerId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  email: { type: String, default: '' },

  // ✅ Wallet field
  wallet: {
    type: Number,
    default: 0,
    min: 0
  },

  // Other fields...
});
```

---

### 4. Route Configuration

**File**: `routes/rideRoutes.js`

```javascript
const express = require('express');
const router = express.Router();
const { completeRide } = require('../controllers/ride.controller');
const { authenticateDriver } = require('../middleware/auth');

// POST /api/rides/complete
router.post('/complete', authenticateDriver, completeRide);

module.exports = router;
```

---

### 5. Socket Event for User

**File**: `socket.js`

Ensure users can join rooms and receive ride completion events:

```javascript
// When user connects
socket.on('userJoin', (userId) => {
  socket.join(`user_${userId}`);
  console.log(`✅ User ${userId} joined room: user_${userId}`);
});

// Ride completion event sent from controller
io.to(`user_${userId}`).emit('rideCompleted', {
  rideId: 'RIDE1703123456789',
  distance: 5.2,
  duration: 18,
  fareBreakdown: {
    baseFare: 50,
    distanceCharge: 52,
    timeCharge: 18,
    surcharge: 0
  },
  totalAmount: 120,
  walletBalance: 1370,
  previousBalance: 1250,
  completedAt: '2025-12-31T10:30:00.000Z'
});
```

---

## Testing

### Test 1: Complete Ride and Credit Wallet

```bash
# Complete ride
curl -X POST http://localhost:5001/api/rides/complete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <driver_jwt_token>" \
  -d '{
    "rideId": "RIDE1703123456789",
    "distance": 5.2,
    "duration": 18,
    "fareBreakdown": {
      "baseFare": 50,
      "distanceCharge": 52,
      "timeCharge": 18,
      "surcharge": 0
    },
    "totalAmount": 120,
    "endLocation": {
      "latitude": 12.9716,
      "longitude": 77.5946,
      "address": "MG Road, Bangalore"
    }
  }'

# Expected response:
# {
#   "success": true,
#   "user": {
#     "walletBalance": 1370,
#     "previousBalance": 1250
#   }
# }
```

### Test 2: Verify User Wallet

```bash
curl http://localhost:5001/api/users/wallet/user10001

# Expected:
# {
#   "success": true,
#   "walletBalance": 1370
# }
```

### Test 3: Verify Transaction Record

```bash
curl http://localhost:5001/api/users/transactions/user10001?page=1&limit=10

# Expected: Latest transaction shows:
# {
#   "type": "credit",
#   "category": "ride_earning",
#   "amount": 120,
#   "description": "Ride completed - 5.2 km in 18 mins"
# }
```

---

## Frontend Integration

### Listen for Ride Completion Event

```javascript
// In user app
useEffect(() => {
  const userId = await AsyncStorage.getItem('userId');

  // Join user room
  socket.emit('userJoin', userId);

  // Listen for ride completion
  socket.on('rideCompleted', (data) => {
    const {
      rideId,
      distance,
      duration,
      fareBreakdown,
      totalAmount,
      walletBalance,
      previousBalance
    } = data;

    console.log(`✅ Ride completed! Wallet credited: ₹${totalAmount}`);

    // Update wallet balance in state
    setUserWalletBalance(walletBalance);
    await AsyncStorage.setItem('userWalletBalance', walletBalance.toString());

    // Show billing alert
    showBillingAlert({
      distance,
      duration,
      fareBreakdown,
      totalAmount,
      walletBalance
    });
  });

  return () => {
    socket.off('rideCompleted');
  };
}, []);
```

---

## Database Schema Summary

### User Model
```javascript
{
  customerId: "user10001",
  name: "John Doe",
  phone: "9876543210",
  wallet: 1370,  // ✅ Credited after ride completion
  // ...
}
```

### Ride Model
```javascript
{
  RAID_ID: "RIDE1703123456789",
  user: ObjectId("..."),
  driver: ObjectId("..."),
  status: "completed",
  distance: 5.2,
  duration: 18,
  fare: 120,
  fareBreakdown: {
    baseFare: 50,
    distanceCharge: 52,
    timeCharge: 18,
    surcharge: 0
  },
  completedAt: "2025-12-31T10:30:00.000Z"
}
```

### User Transaction Model
```javascript
{
  userId: ObjectId("..."),
  type: "credit",
  category: "ride_earning",
  amount: 120,
  description: "Ride completed - 5.2 km in 18 mins",
  balanceAfter: 1370,
  rideId: ObjectId("..."),
  date: "2025-12-31T10:30:00.000Z"
}
```

---

## Expected Flow

```
1. Driver completes ride
   ↓
2. Driver app calls: POST /api/rides/complete
   ↓
3. Backend:
   - Marks ride as completed ✅
   - Credits ₹120 to user's wallet (1250 → 1370) ✅
   - Creates transaction record ✅
   - Sends socket event to user ✅
   ↓
4. User app receives 'rideCompleted' event
   ↓
5. User app:
   - Updates wallet balance to ₹1370 ✅
   - Shows professional billing alert ✅
   - Updates Profile screen ✅
   - Updates Wallet screen ✅
```

---

## Summary

**Backend Tasks**:
1. ✅ Create `POST /api/rides/complete` endpoint
2. ✅ Credit ride amount to **user's wallet** (not driver's)
3. ✅ Create user transaction record
4. ✅ Send socket event to user with billing details
5. ✅ Return updated wallet balance in response

**Expected Result**:
- ✅ Ride marked as completed
- ✅ User wallet credited immediately
- ✅ Transaction history updated
- ✅ User receives real-time notification
- ✅ Wallet balance updates in UI instantly

---

**Status**: Ready for Implementation
**Priority**: High
**Files to Create/Modify**:
- `controllers/ride.controller.js` - Complete ride logic
- `models/user/Transaction.js` - User transaction model
- `models/user/Registration.js` - Add wallet field
- `routes/rideRoutes.js` - Add route
- `socket.js` - User room joining

All specifications are complete. Backend team can start implementation immediately!
