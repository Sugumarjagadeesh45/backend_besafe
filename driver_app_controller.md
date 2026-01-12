




# DRIVER_APP_CONTROLLER.md

This file provides essential endpoints, configurations, and implementation notes for the **Driver Mobile App Frontend**. Use this as a reference when building or troubleshooting the driver application.

---

## 📋 Table of Contents

1. [Backend Configuration](#backend-configuration)
2. [Authentication Endpoints](#authentication-endpoints)
3. [Driver Status Management](#driver-status-management)
4. [Working Hours & Wallet](#working-hours--wallet)
5. [Ride Management](#ride-management)
6. [Socket.IO Integration](#socketio-integration)
7. [FCM Token Management](#fcm-token-management)
8. [Location Updates](#location-updates)
9. [Common Issues & Solutions](#common-issues--solutions)
10. [Critical Implementation Notes](#critical-implementation-notes)

---

## Backend Configuration

### Base URLs

```javascript
// Production/Staging
const BACKEND_URL = "https://your-ngrok-url.ngrok-free.app";
const API_BASE = `${BACKEND_URL}/api`;

// Local Development
const LOCAL_BACKEND = "http://localhost:5001";
const LOCAL_API = `${LOCAL_BACKEND}/api`;
```

### Required Headers

```javascript
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${JWT_TOKEN}`,
  'ngrok-skip-browser-warning': 'true', // Required for ngrok URLs
};
```

---

## Authentication Endpoints

### 1. Request Driver OTP

**Endpoint:** `POST /api/auth/request-driver-otp`

```javascript
const requestOTP = async (phoneNumber) => {
  const response = await fetch(`${API_BASE}/auth/request-driver-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber })
  });
  return await response.json();
};
```

**Response:**
```json
{
  "success": true,
  "exists": true,
  "message": "Driver exists. Proceed with Firebase OTP verification.",
  "driverId": "DRV001"
}
```

---

### 2. Get Complete Driver Info (After OTP Verification)

**Endpoint:** `POST /api/auth/get-complete-driver-info`

```javascript
const getDriverInfo = async (phoneNumber) => {
  const response = await fetch(`${API_BASE}/auth/get-complete-driver-info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber })
  });
  return await response.json();
};
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "driver": {
    "_id": "675abc123def456789",
    "driverId": "DRV001",
    "name": "John Doe",
    "phoneNumber": "9876543210",
    "vehicleType": "bike",
    "status": "Offline",
    "wallet": 500,
    "workingHoursLimit": 12,
    "remainingWorkingSeconds": 0,
    "timerActive": false,
    "fcmToken": "existing-token-if-any"
  }
}
```

**Store the token and driver data:**
```javascript
await AsyncStorage.setItem('authToken', response.token);
await AsyncStorage.setItem('driverData', JSON.stringify(response.driver));
```

---

## Driver Status Management

### 1. Go Online (Start Shift)

**⚠️ CRITICAL:** This deducts ₹100 from wallet for NEW shifts only. Resume scenarios don't charge.

**Endpoint:** `POST /api/drivers/working-hours/start`

```javascript
const goOnline = async (driverId) => {
  const response = await fetch(`${API_BASE}/drivers/working-hours/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ driverId })
  });
  return await response.json();
};
```

**Success Response (New Shift - ₹100 deducted):**
```json
{
  "success": true,
  "message": "Timer started successfully",
  "totalHours": 12,
  "remainingSeconds": 43200,
  "walletBalance": 400,
  "amountDeducted": 100
}
```

**Success Response (Resume - No deduction):**
```json
{
  "success": true,
  "message": "Existing session resumed - no wallet deduction",
  "remainingSeconds": 35000,
  "walletBalance": 400,
  "amountDeducted": 0
}
```

**Error Response (Insufficient Balance):**
```json
{
  "success": false,
  "message": "Insufficient wallet balance. Minimum ₹100 required to go online."
}
```

---

### 2. Go Offline (Stop Shift)

**Endpoint:** `POST /api/drivers/working-hours/stop`

```javascript
const goOffline = async (driverId) => {
  const response = await fetch(`${API_BASE}/drivers/working-hours/stop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ driverId })
  });
  return await response.json();
};
```

**Response:**
```json
{
  "success": true,
  "message": "Timer stopped successfully",
  "driverId": "DRV001",
  "remainingSeconds": 35000
}
```

**Note:** This PAUSES the timer, does NOT deduct wallet.

---

### 3. Update Driver Status (Live/Offline/onRide)

**Endpoint:** `PATCH /api/drivers/:driverId/status`

```javascript
const updateStatus = async (driverId, status) => {
  const response = await fetch(`${API_BASE}/drivers/${driverId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ status }) // "Live", "Offline", "onRide"
  });
  return await response.json();
};
```

**Valid Status Values:**
- `"Live"` - Driver is online and available for rides
- `"Offline"` - Driver is offline
- `"onRide"` - Driver is currently on a ride

---

## Working Hours & Wallet

### 1. Get Timer Status

**Endpoint:** `GET /api/drivers/working-hours/status/:driverId`

```javascript
const getTimerStatus = async (driverId) => {
  const response = await fetch(
    `${API_BASE}/drivers/working-hours/status/${driverId}`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );
  return await response.json();
};
```

**Response:**
```json
{
  "success": true,
  "timerActive": true,
  "remainingSeconds": 35420,
  "formattedTime": "9:50:20",
  "warningsIssued": 0,
  "extendedHoursPurchased": false,
  "walletBalance": 350
}
```

---

### 2. Extend Working Hours

**Endpoint:** `POST /api/drivers/working-hours/extend`

**Deducts:** ₹100 (default) or `driver.workingHoursDeductionAmount`

```javascript
const extendWorkingHours = async (driverId, additionalHours = 12) => {
  const response = await fetch(`${API_BASE}/drivers/working-hours/extend`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ driverId, additionalHours })
  });
  return await response.json();
};
```

**Response:**
```json
{
  "success": true,
  "message": "Extended hours purchased successfully",
  "additionalHours": 12,
  "amountDeducted": 100,
  "newBalance": 300,
  "remainingSeconds": 50400
}
```

---

### 3. Add Half Time

**Endpoint:** `POST /api/drivers/working-hours/add-half-time`

**Deducts:**
- ₹50 for 12-hour shift (adds 6 hours)
- ₹100 for 24-hour shift (adds 12 hours)

```javascript
const addHalfTime = async (driverId) => {
  const response = await fetch(`${API_BASE}/drivers/working-hours/add-half-time`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ driverId })
  });
  return await response.json();
};
```

---

### 4. Add Full Time

**Endpoint:** `POST /api/drivers/working-hours/add-full-time`

**Deducts:**
- ₹100 for 12-hour shift (adds 12 hours)
- ₹200 for 24-hour shift (adds 24 hours)

```javascript
const addFullTime = async (driverId) => {
  const response = await fetch(`${API_BASE}/drivers/working-hours/add-full-time`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ driverId })
  });
  return await response.json();
};
```

---

### 5. Get Wallet Balance

**Endpoint:** `GET /api/drivers/:driverId`

```javascript
const getWalletBalance = async (driverId) => {
  const response = await fetch(`${API_BASE}/drivers/${driverId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await response.json();
  return data.driver.wallet;
};
```

---

## Ride Management

### 1. Get Ride Details

**⚠️ CRITICAL FIX:** The frontend is trying multiple endpoints. Use this correct one:

**Endpoint:** `GET /api/rides/:rideId`

```javascript
const getRideDetails = async (rideId) => {
  const response = await fetch(`${API_BASE}/rides/${rideId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'ngrok-skip-browser-warning': 'true'
    }
  });
  return await response.json();
};
```

**Response:**
```json
{
  "success": true,
  "ride": {
    "_id": "675...",
    "RAID_ID": "RID003786",
    "user": {
      "_id": "user_id",
      "name": "sugumar",
      "phoneNumber": "9876543210",
      "customerId": "CUS0065"
    },
    "userName": "sugumar",
    "userMobile": "9876543210",
    "customerId": "CUS0065",
    "pickup": {
      "lat": 11.345991175126157,
      "lng": 77.72165279835463,
      "address": "Nachiyappa Veethi, Veerappanchatiram, Erode"
    },
    "drop": {
      "lat": 11.309913106787208,
      "lng": 77.73874450474977,
      "address": "Kollampalayam Bypass, Solar, Modakkurichi, Erode"
    },
    "vehicleType": "bike",
    "distance": 5.4,
    "fare": 81,
    "status": "searching",
    "otp": "0065"
  }
}
```

---

### 2. Accept Ride (Via Socket.IO)

**⚠️ Use Socket.IO, NOT REST API**

```javascript
socket.emit('rideAccepted', {
  rideId: 'RID003786',
  driverId: 'DRV001',
  driverName: 'John Doe',
  driverPhone: '9876543210',
  vehicleType: 'bike'
});
```

**Server will respond with:**
```javascript
socket.on('rideAcceptanceConfirmed', (data) => {
  console.log('Ride accepted:', data);
  // Navigate to ride screen
});
```

---

### 3. Mark Arrived at Pickup

**Endpoint:** `POST /api/rides/arrived`

```javascript
const markArrived = async (rideId, driverId) => {
  const response = await fetch(`${API_BASE}/rides/arrived`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ rideId, driverId })
  });
  return await response.json();
};
```

---

### 4. Start Ride (After OTP Verification)

**Endpoint:** `POST /api/rides/start`

```javascript
const startRide = async (rideId, driverId, otp) => {
  const response = await fetch(`${API_BASE}/rides/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ rideId, driverId, otp })
  });
  return await response.json();
};
```

**Response (OTP Correct):**
```json
{
  "success": true,
  "message": "Ride started successfully",
  "ride": { ... }
}
```

**Response (OTP Incorrect):**
```json
{
  "success": false,
  "message": "Invalid OTP"
}
```

---

### 5. Complete Ride

**⚠️ CRITICAL:** Use Socket.IO for ride completion to ensure proper bill display.

**Endpoint (Socket.IO):** Emit `rideCompleted` event

```javascript
socket.emit('rideCompleted', {
  rideId: 'RID003786',
  driverId: 'DRV001',
  finalDistance: 5.4, // in km
  finalFare: 81, // calculated fare
  driverCurrentLocation: {
    latitude: 11.309913106787208,
    longitude: 77.73874450474977
  }
});
```

**Server Response (Via Socket.IO):**

```javascript
// 1. FIRST: billAlert event (show bill to user)
socket.on('billAlert', (billData) => {
  console.log('Bill:', billData);
  // Show bill modal to user
});

// 2. SECOND: rideCompleted event (update status)
socket.on('rideCompleted', (data) => {
  console.log('Ride completed:', data);
  // Clear ride state, navigate to home
});
```

**Bill Data Structure:**
```json
{
  "rideId": "RID003786",
  "distance": 5.4,
  "fare": 81,
  "vehicleType": "bike",
  "userName": "sugumar",
  "userMobile": "9876543210",
  "pickup": "Nachiyappa Veethi...",
  "drop": "Kollampalayam Bypass...",
  "completedAt": "2026-01-12T08:44:23.416Z"
}
```

---

### 6. Alternative: Complete Ride via REST API

**Endpoint:** `POST /api/rides/simple-complete`

```javascript
const completeRide = async (rideId, driverId, finalDistance) => {
  const response = await fetch(`${API_BASE}/rides/simple-complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      rideId,
      driverId,
      distance: finalDistance
    })
  });
  return await response.json();
};
```

---

## Socket.IO Integration

### 1. Connection Setup

```javascript
import io from 'socket.io-client';

const socket = io(BACKEND_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5
});

// On connection
socket.on('connect', () => {
  console.log('✅ Socket Connected:', socket.id);

  // Register driver
  socket.emit('driverOnline', {
    driverId: 'DRV001',
    vehicleType: 'bike'
  });
});
```

---

### 2. Listen for Ride Requests

```javascript
socket.on('rideRequest', (rideData) => {
  console.log('🚗 New ride request:', rideData);

  // Show ride request notification/modal
  showRideRequestNotification(rideData);
});
```

**Ride Data Structure:**
```json
{
  "rideId": "RID003786",
  "userName": "sugumar",
  "userMobile": "9876543210",
  "customerId": "CUS0065",
  "pickup": {
    "lat": 11.345991,
    "lng": 77.721652,
    "address": "Nachiyappa Veethi..."
  },
  "drop": {
    "lat": 11.309913,
    "lng": 77.738744,
    "address": "Kollampalayam Bypass..."
  },
  "distance": 5.4,
  "fare": 81,
  "vehicleType": "bike",
  "otp": "0065"
}
```

---

### 3. Update Driver Location

**⚠️ CRITICAL:** Only send location updates when driver is Live or on a ride.

```javascript
const updateDriverLocation = (latitude, longitude) => {
  if (driverStatus === 'Live' || driverStatus === 'onRide') {
    socket.emit('updateLocation', {
      driverId: 'DRV001',
      latitude,
      longitude,
      status: driverStatus
    });
  }
};

// Update every 5 seconds
setInterval(() => {
  getCurrentPosition((position) => {
    updateDriverLocation(
      position.coords.latitude,
      position.coords.longitude
    );
  });
}, 5000);
```

---

### 4. Listen for Working Hours Warnings

```javascript
socket.on('workingHoursWarning', (data) => {
  console.log('⚠️ Working hours warning:', data);

  // Show warning dialog
  Alert.alert(
    'Working Hours Warning',
    data.message,
    [
      { text: 'Extend Hours', onPress: () => extendWorkingHours() },
      { text: 'Continue', style: 'cancel' }
    ]
  );
});
```

**Warning Data:**
```json
{
  "warningNumber": 1,
  "message": "You have 1 hour left",
  "remainingSeconds": 3600,
  "autoStopIn": "1 hour"
}
```

---

## FCM Token Management

### 1. Update FCM Token

**⚠️ CRITICAL:** Always update FCM token after login or token refresh.

**Endpoint:** `POST /api/drivers/fcm-token`

```javascript
const updateFCMToken = async (driverId, fcmToken) => {
  const response = await fetch(`${API_BASE}/drivers/fcm-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ driverId, fcmToken })
  });
  return await response.json();
};
```

**When to call:**
```javascript
// 1. After login
await updateFCMToken(driverId, fcmToken);

// 2. On FCM token refresh
messaging().onTokenRefresh(async (newToken) => {
  await updateFCMToken(driverId, newToken);
});
```

---

### 2. Handle FCM Notifications

```javascript
// Foreground notifications
messaging().onMessage(async (remoteMessage) => {
  console.log('📱 FCM Notification:', remoteMessage);

  if (remoteMessage.data.type === 'ride_request') {
    // Show ride request modal
    handleRideRequest(remoteMessage.data);
  }

  if (remoteMessage.data.type === 'working_hours_warning') {
    // Show warning alert
    handleWorkingHoursWarning(remoteMessage.data);
  }
});

// Background/Quit state
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  console.log('📱 Background FCM:', remoteMessage);
});
```

---

## Location Updates

### 1. Save Driver Location (REST API)

**⚠️ Note:** Location updates should primarily use Socket.IO, not REST API.

**Endpoint:** `POST /api/drivers/location`

```javascript
const saveLocation = async (driverId, latitude, longitude) => {
  const response = await fetch(`${API_BASE}/drivers/location`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      driverId,
      latitude,
      longitude,
      timestamp: new Date().toISOString()
    })
  });
  return await response.json();
};
```

---

## Common Issues & Solutions

### Issue 1: "Ride details not found" (404 Error)

**Problem:** Frontend trying wrong endpoints.

**Solution:** Use the correct endpoint:
```javascript
// ✅ CORRECT
GET /api/rides/:rideId

// ❌ WRONG (Don't use these)
GET /api/rides/get-ride/:rideId
GET /api/ride/get/:rideId
```

**Fixed Implementation:**
```javascript
const getRideDetails = async (rideId) => {
  try {
    const response = await fetch(`${API_BASE}/rides/${rideId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'ngrok-skip-browser-warning': 'true'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('❌ Error fetching ride:', error);
    throw error;
  }
};
```

---

### Issue 2: Driver Charged Twice When Going Online

**Problem:** App calling `/start` endpoint multiple times.

**Solution:** Track online state and prevent duplicate calls:
```javascript
let isGoingOnline = false;

const goOnline = async () => {
  if (isGoingOnline) {
    console.log('⚠️ Already processing go online request');
    return;
  }

  isGoingOnline = true;

  try {
    const result = await startWorkingHours(driverId);

    if (result.success) {
      await updateDriverStatus(driverId, 'Live');
      setDriverStatus('Live');
    }
  } finally {
    isGoingOnline = false;
  }
};
```

---

### Issue 3: Ride Requests Not Received

**Checklist:**
1. ✅ Socket.IO connected (`socket.connected === true`)
2. ✅ Driver emitted `driverOnline` event with correct `driverId`
3. ✅ Driver status is `"Live"` in database
4. ✅ Vehicle type matches ride request
5. ✅ FCM token is valid and updated
6. ✅ Listening to `rideRequest` event

**Debug Code:**
```javascript
socket.on('connect', () => {
  console.log('✅ Connected:', socket.id);

  socket.emit('driverOnline', {
    driverId: driverData.driverId,
    vehicleType: driverData.vehicleType
  });

  console.log('📡 Registered as online driver');
});

socket.on('rideRequest', (data) => {
  console.log('🚗 Ride request received:', data);
});

// Check if listening
console.log('Listeners:', socket.listeners('rideRequest').length);
```

---

### Issue 4: Passenger Details Not Showing

**Problem:** Ride object doesn't populate user data.

**Solution:** Backend returns user data in ride object. If missing, fetch separately:

```javascript
const getCompleteRideData = async (rideId) => {
  try {
    const rideResponse = await fetch(`${API_BASE}/rides/${rideId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'ngrok-skip-browser-warning': 'true'
      }
    });

    const rideData = await rideResponse.json();

    // Backend returns user data populated
    const passenger = {
      name: rideData.ride.userName || rideData.ride.user?.name || 'Passenger',
      mobile: rideData.ride.userMobile || rideData.ride.user?.phoneNumber || 'N/A',
      customerId: rideData.ride.customerId || rideData.ride.user?.customerId || 'N/A',
      location: {
        latitude: rideData.ride.pickup?.lat || 0,
        longitude: rideData.ride.pickup?.lng || 0
      }
    };

    return { ride: rideData.ride, passenger };
  } catch (error) {
    console.error('Error fetching ride data:', error);
    throw error;
  }
};
```

---

### Issue 5: Bill Not Showing After Ride Completion

**Problem:** Frontend navigating away before bill is displayed.

**Solution:** Listen for `billAlert` FIRST, then `rideCompleted`:

```javascript
// 1. Listen for bill alert
socket.on('billAlert', (billData) => {
  console.log('💰 Bill received:', billData);

  // Show bill modal (BLOCKING)
  showBillModal(billData);
});

// 2. Only after bill is acknowledged, clear state
socket.on('rideCompleted', (data) => {
  console.log('✅ Ride completed:', data);

  // DO NOT navigate immediately
  // Wait for user to close bill modal
});

// 3. After user closes bill
const handleBillClosed = () => {
  clearRideState();
  navigation.navigate('Home');
};
```

---

## Critical Implementation Notes

### 1. Vehicle Type Handling

**⚠️ CRITICAL:** Vehicle type is IMMUTABLE after registration.

```javascript
// ✅ CORRECT: Read from stored driver data
const vehicleType = driverData.vehicleType; // "bike", "taxi", or "port"

// ❌ WRONG: Don't allow user to change vehicle type
// This should only be set by admin during registration
```

**Display Format:**
- Database: `"bike"` (lowercase)
- UI Display: `"BIKE"` or `"Bike"` (uppercase/capitalized)

---

### 2. Working Hours Timer Management

**⚠️ CRITICAL:** Always stop timer when going offline.

```javascript
const goOffline = async () => {
  try {
    // 1. Stop working hours timer
    await fetch(`${API_BASE}/drivers/working-hours/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ driverId })
    });

    // 2. Update driver status
    await updateDriverStatus(driverId, 'Offline');

    // 3. Stop location updates
    clearInterval(locationUpdateInterval);

    // 4. Update local state
    setDriverStatus('Offline');

    console.log('✅ Successfully went offline');
  } catch (error) {
    console.error('❌ Error going offline:', error);
  }
};
```

---

### 3. Resume vs New Shift Detection

**Backend automatically detects resume scenarios:**

```javascript
// Backend checks:
// - If driver.remainingWorkingSeconds > 0
// - If driver.timerActive === false (was paused)
// Result: No wallet deduction (resume)

// Otherwise: New shift, deduct ₹100

// Frontend should display appropriate message:
const handleGoOnlineResponse = (response) => {
  if (response.amountDeducted > 0) {
    Alert.alert(
      'Shift Started',
      `₹${response.amountDeducted} deducted from wallet.\nNew balance: ₹${response.walletBalance}`
    );
  } else {
    Alert.alert(
      'Shift Resumed',
      'Previous session resumed. No wallet deduction.'
    );
  }
};
```

---

### 4. OTP Display and Validation

**OTP Format:**
- Always 4 digits
- Derived from user's customerId (last 4 digits)
- Example: customerId `CUS0065` → OTP `0065`

```javascript
// Display OTP to driver
const showOTP = (otp) => {
  return (
    <View>
      <Text>Pickup OTP:</Text>
      <Text style={styles.otp}>{otp.padStart(4, '0')}</Text>
    </View>
  );
};

// Validate OTP before starting ride
const validateAndStartRide = async (enteredOTP) => {
  try {
    const response = await startRide(rideId, driverId, enteredOTP);

    if (response.success) {
      // OTP correct, ride started
      navigation.navigate('OngoingRide');
    } else {
      // OTP incorrect
      Alert.alert('Invalid OTP', 'Please ask passenger for correct OTP');
    }
  } catch (error) {
    console.error('Error starting ride:', error);
  }
};
```

---

### 5. Error Handling Best Practices

```javascript
const apiCall = async (endpoint, method = 'GET', body = null) => {
  try {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'ngrok-skip-browser-warning': 'true'
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${API_BASE}${endpoint}`, options);

    // Check for HTTP errors
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`❌ API Error [${endpoint}]:`, error);

    // Show user-friendly error
    if (error.message.includes('Network request failed')) {
      Alert.alert('Connection Error', 'Please check your internet connection');
    } else {
      Alert.alert('Error', error.message);
    }

    throw error;
  }
};
```

---

## Quick Reference: All Endpoints

### Authentication
- `POST /api/auth/request-driver-otp` - Request OTP
- `POST /api/auth/get-complete-driver-info` - Get driver data + JWT

### Driver Management
- `GET /api/drivers/:driverId` - Get driver details
- `PATCH /api/drivers/:driverId/status` - Update status
- `POST /api/drivers/fcm-token` - Update FCM token

### Working Hours
- `POST /api/drivers/working-hours/start` - Go online (₹100 for new shift)
- `POST /api/drivers/working-hours/stop` - Go offline (no charge)
- `POST /api/drivers/working-hours/pause` - Pause timer
- `POST /api/drivers/working-hours/resume` - Resume timer
- `GET /api/drivers/working-hours/status/:driverId` - Get timer status
- `POST /api/drivers/working-hours/extend` - Extend hours (₹100)
- `POST /api/drivers/working-hours/add-half-time` - Add half time (₹50/₹100)
- `POST /api/drivers/working-hours/add-full-time` - Add full time (₹100/₹200)

### Ride Management
- `GET /api/rides/:rideId` - Get ride details ✅ USE THIS
- `POST /api/rides/arrived` - Mark arrived at pickup
- `POST /api/rides/start` - Start ride (with OTP)
- `POST /api/rides/simple-complete` - Complete ride

### Socket.IO Events (Emit)
- `driverOnline` - Register driver as online
- `updateLocation` - Send location update
- `rideAccepted` - Accept ride request
- `rideCompleted` - Complete ride with fare

### Socket.IO Events (Listen)
- `rideRequest` - New ride available
- `billAlert` - Bill for completed ride
- `rideCompleted` - Ride completion confirmation
- `workingHoursWarning` - Timer warning

---

## Testing Commands

```bash
# Test backend connection
curl http://localhost:5001/api/test-connection

# Get driver details
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:5001/api/drivers/DRV001

# Get timer status
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:5001/api/drivers/working-hours/status/DRV001

# Get ride details
curl -H "Authorization: Bearer YOUR_TOKEN" \
  -H "ngrok-skip-browser-warning: true" \
  http://localhost:5001/api/rides/RID003786
```

---

**Last Updated:** 2026-01-12
**Backend Version:** 1.0.0
**Compatible with:** Driver App v1.x

**For more details, see:**
- `CLAUDE.md` - Complete backend architecture
- `WALLET_DEBIT.md` - Wallet deduction system details
- `socket.js` - Socket.IO implementation
