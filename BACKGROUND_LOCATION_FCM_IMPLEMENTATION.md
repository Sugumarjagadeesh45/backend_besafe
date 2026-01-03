# 🚀 Background Location & FCM Notifications - Complete Implementation Guide

**Date**: 2025-12-31
**Priority**: CRITICAL - Professional Ride-Booking Standard
**Status**: Implementation Guide Ready

---

## 🎯 Goal

Implement professional-grade background location tracking and FCM notifications so that:
- ✅ Driver location updates continue when app is in background/closed/screen locked
- ✅ Ride request notifications arrive reliably in all app states
- ✅ Tapping notification opens app and shows ride request immediately
- ✅ Driver remains ONLINE and reachable until they explicitly go OFFLINE

---

## 📋 Current Status

### ✅ What's Already Working
1. **Foreground location updates** - When app is open and driver is ONLINE
2. **FCM infrastructure** - Firebase Admin SDK configured in backend
3. **FCM notification sending** - `sendFCMNotifications()` function in socket.js
4. **Socket.IO events** - Real-time communication when app is foreground

### ❌ What's Missing
1. **Background location tracking** - Stops when app goes to background
2. **Background FCM handling** - Notifications don't wake app or navigate correctly
3. **Deep linking** - Tapping notification doesn't show ride request UI
4. **Persistent ONLINE state** - Driver status resets when app closes

---

## 🔧 Backend Implementation (Already Done ✅)

### 1. FCM Notification System

**File**: `socket.js:1816-1899`

The backend is already sending FCM notifications with all required data:

```javascript
async function sendFCMNotifications(rideData) {
  // Finds matching drivers by vehicle type
  const driversWithFCM = await Driver.find({
    vehicleType: normalizedVehicleType,
    status: { $in: ["Live", "online", "available"] },
    fcmToken: { $exists: true, $ne: null, $ne: '' }
  });

  // Sends FCM notification
  await sendNotificationToMultipleDrivers(
    driverTokens,
    `🚖 New ${rideData.vehicleType} Ride Request!`,
    `Pickup: ${rideData.pickup?.address}... | Fare: ₹${rideData.fare}`,
    {
      type: "ride_request",
      rideId: rideData.rideId,
      pickup: JSON.stringify(rideData.pickup || {}),
      drop: JSON.stringify(rideData.drop || {}),
      fare: rideData.fare?.toString() || "0",
      distance: rideData.distance?.toString() || "0",
      vehicleType: rideData.vehicleType || "taxi",
      userName: rideData.userName || "Customer",
      userMobile: rideData.userMobile || "N/A",
      otp: rideData.otp || "0000",
      timestamp: new Date().toISOString(),
      priority: "high",
      click_action: "FLUTTER_NOTIFICATION_CLICK"  // ✅ For deep linking
    }
  );
}
```

**Status**: ✅ Backend is ready, no changes needed

---

##  📱 Frontend Implementation (React Native Driver App)

### Required Packages

```bash
npm install --save @react-native-firebase/app
npm install --save @react-native-firebase/messaging
npm install --save react-native-background-actions
npm install --save react-native-geolocation-service
npm install --save @react-native-async-storage/async-storage
npm install --save @notifee/react-native  # For advanced notifications
```

---

### 1. Background Location Tracking

#### Create Background Service

**File**: `services/BackgroundLocationService.js`

```javascript
import BackgroundService from 'react-native-background-actions';
import Geolocation from 'react-native-geolocation-service';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io } from 'socket.io-client';

let socket = null;
let locationInterval = null;

const sleep = (time) => new Promise((resolve) => setTimeout(() => resolve(), time));

// Background task that runs even when app is closed
const backgroundTask = async (taskDataArguments) => {
  const { delay } = taskDataArguments;

  await new Promise(async (resolve) => {
    // Get driver info from AsyncStorage
    const driverId = await AsyncStorage.getItem('driverId');
    const driverName = await AsyncStorage.getItem('driverName');
    const vehicleType = await AsyncStorage.getItem('driverVehicleType');
    const token = await AsyncStorage.getItem('token');
    const API_URL = await AsyncStorage.getItem('API_URL') || 'http://your-backend-url';

    if (!driverId) {
      console.log('❌ No driver ID, stopping background service');
      return resolve();
    }

    // Initialize socket connection
    if (!socket) {
      socket = io(API_URL, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
      });

      socket.on('connect', () => {
        console.log('✅ Background socket connected');
        // Register driver
        socket.emit('registerDriver', {
          driverId,
          driverName,
          vehicleType,
          latitude: 0,
          longitude: 0
        });
      });
    }

    // Main background loop
    for (let i = 0; BackgroundService.isRunning(); i++) {
      console.log(`🔄 Background iteration: ${i}`);

      // Get current location
      Geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;

          console.log(`📍 Background location: ${latitude}, ${longitude}`);

          // Send location update via socket
          if (socket && socket.connected) {
            socket.emit('driverLocationUpdate', {
              driverId,
              latitude,
              longitude,
              vehicleType,
              timestamp: new Date().toISOString()
            });
          }
        },
        (error) => {
          console.error('❌ Background location error:', error);
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 10000,
          showLocationDialog: true
        }
      );

      // Update every 10 seconds
      await sleep(delay);
    }
  });
};

// Options for background service
const options = {
  taskName: 'Driver Location Updates',
  taskTitle: 'Ride Booking Active',
  taskDesc: 'Sharing your location with riders',
  taskIcon: {
    name: 'ic_launcher',
    type: 'mipmap',
  },
  color: '#4CAF50',
  linkingURI: 'yourapp://ride-request',  // Deep link scheme
  parameters: {
    delay: 10000,  // 10 seconds
  },
};

// Start background location service
export const startBackgroundLocation = async () => {
  try {
    console.log('🚀 Starting background location service...');
    await BackgroundService.start(backgroundTask, options);
    console.log('✅ Background service started');
  } catch (error) {
    console.error('❌ Error starting background service:', error);
  }
};

// Stop background location service
export const stopBackgroundLocation = async () => {
  try {
    console.log('🛑 Stopping background location service...');
    await BackgroundService.stop();
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    console.log('✅ Background service stopped');
  } catch (error) {
    console.error('❌ Error stopping background service:', error);
  }
};

// Check if background service is running
export const isBackgroundLocationRunning = () => {
  return BackgroundService.isRunning();
};
```

---

### 2. FCM Background Message Handler

#### Setup FCM

**File**: `services/FCMService.js`

```javascript
import messaging from '@react-native-firebase/messaging';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import PushNotification from 'react-native-push-notification';
import PushNotificationIOS from '@react-native-community/push-notification-ios';

// ✅ CRITICAL: Background message handler (must be top-level, outside components)
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  console.log('📱 Background FCM message received:', remoteMessage);

  const { data } = remoteMessage;

  if (data?.type === 'ride_request') {
    // Show local notification with ride details
    PushNotification.localNotification({
      channelId: 'ride-requests',  // Must match channel created in App.js
      title: '🚖 New Ride Request!',
      message: `Pickup: ${data.pickup ? JSON.parse(data.pickup).address : 'Unknown'}\nFare: ₹${data.fare}`,
      userInfo: data,  // Pass all data for deep linking
      playSound: true,
      soundName: 'default',
      importance: 'high',
      priority: 'high',
      vibrate: true,
      vibration: 300,
      invokeApp: true,  // Open app when tapped
      actions: ['Accept', 'Reject'],  // Action buttons
      data: data  // Deep link data
    });

    // Store ride request in AsyncStorage for when app opens
    await AsyncStorage.setItem('pendingRideRequest', JSON.stringify(data));
  }
});

// Request FCM permission
export const requestFCMPermission = async () => {
  try {
    const authStatus = await messaging().requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;

    if (enabled) {
      console.log('✅ FCM Authorization status:', authStatus);
      return true;
    } else {
      console.log('❌ FCM Permission denied');
      return false;
    }
  } catch (error) {
    console.error('❌ FCM Permission error:', error);
    return false;
  }
};

// Get FCM token
export const getFCMToken = async () => {
  try {
    const token = await messaging().getToken();
    console.log('📱 FCM Token:', token);
    return token;
  } catch (error) {
    console.error('❌ Error getting FCM token:', error);
    return null;
  }
};

// Setup foreground message handler
export const setupForegroundMessageHandler = (onMessageReceived) => {
  return messaging().onMessage(async (remoteMessage) => {
    console.log('📱 Foreground FCM message received:', remoteMessage);

    if (remoteMessage.data?.type === 'ride_request') {
      // Call callback to show in-app ride request UI
      onMessageReceived(remoteMessage.data);
    }
  });
};

// Setup notification tap handler (deep linking)
export const setupNotificationTapHandler = (navigation) => {
  // Handle notification tap when app is in background
  messaging().onNotificationOpenedApp((remoteMessage) => {
    console.log('📱 Notification opened app from background:', remoteMessage);

    if (remoteMessage.data?.type === 'ride_request') {
      // Navigate to ride request screen
      navigation.navigate('Screen1', {
        rideRequest: remoteMessage.data
      });
    }
  });

  // Handle notification tap when app is closed/killed
  messaging()
    .getInitialNotification()
    .then((remoteMessage) => {
      if (remoteMessage) {
        console.log('📱 Notification opened app from quit state:', remoteMessage);

        if (remoteMessage.data?.type === 'ride_request') {
          // Navigate to ride request screen
          navigation.navigate('Screen1', {
            rideRequest: remoteMessage.data
          });
        }
      }
    });
};

// Create notification channel (Android only)
export const createNotificationChannel = () => {
  if (Platform.OS === 'android') {
    PushNotification.createChannel(
      {
        channelId: 'ride-requests',
        channelName: 'Ride Requests',
        channelDescription: 'Notifications for new ride requests',
        playSound: true,
        soundName: 'default',
        importance: 4,  // HIGH
        vibrate: true,
      },
      (created) => console.log(`✅ Notification channel created: ${created}`)
    );
  }
};
```

---

### 3. Integration in Main App Component

**File**: `App.js` or `index.js`

```javascript
import React, { useEffect } from 'react';
import messaging from '@react-native-firebase/messaging';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  requestFCMPermission,
  getFCMToken,
  setupForegroundMessageHandler,
  setupNotificationTapHandler,
  createNotificationChannel
} from './services/FCMService';
import {
  startBackgroundLocation,
  stopBackgroundLocation
} from './services/BackgroundLocationService';

// ✅ CRITICAL: Register background handler at top level
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  console.log('📱 Background message received:', remoteMessage);
  // Handle ride request in background
});

function App() {
  useEffect(() => {
    // Initialize FCM
    const initializeFCM = async () => {
      // Create notification channel (Android)
      createNotificationChannel();

      // Request permission
      const hasPermission = await requestFCMPermission();
      if (hasPermission) {
        // Get FCM token
        const token = await getFCMToken();
        await AsyncStorage.setItem('fcmToken', token);

        // Send token to backend
        // ... (your existing token update logic)
      }

      // Setup foreground message handler
      const unsubscribe = setupForegroundMessageHandler((rideData) => {
        console.log('📱 Ride request received in foreground:', rideData);
        // Show in-app ride request UI
      });

      return unsubscribe;
    };

    initializeFCM();

    // Check for pending ride request on app startup
    const checkPendingRideRequest = async () => {
      const pendingRide = await AsyncStorage.getItem('pendingRideRequest');
      if (pendingRide) {
        console.log('📱 Found pending ride request:', pendingRide);
        const rideData = JSON.parse(pendingRide);
        // Show ride request UI
        // navigation.navigate('Screen1', { rideRequest: rideData });
        // Clear pending ride
        await AsyncStorage.removeItem('pendingRideRequest');
      }
    };

    checkPendingRideRequest();

    // Handle app state changes (foreground/background)
    const appStateSubscription = AppState.addEventListener('change', async (nextAppState) => {
      const driverStatus = await AsyncStorage.getItem('driverStatus');

      if (nextAppState === 'background' && driverStatus === 'Live') {
        console.log('📱 App went to background, driver is ONLINE');
        // Background location will continue via BackgroundService
      } else if (nextAppState === 'active') {
        console.log('📱 App came to foreground');
        // Check for pending ride requests
        checkPendingRideRequest();
      }
    });

    return () => {
      appStateSubscription?.remove();
    };
  }, []);

  return (
    // Your app component tree
  );
}

export default App;
```

---

### 4. Integration in Screen1.tsx (Driver Main Screen)

**File**: `Screen1.tsx`

```typescript
import React, { useEffect, useState } from 'react';
import { Alert, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  startBackgroundLocation,
  stopBackgroundLocation,
  isBackgroundLocationRunning
} from './services/BackgroundLocationService';
import { getFCMToken } from './services/FCMService';

const Screen1 = ({ navigation, route }) => {
  const [driverStatus, setDriverStatus] = useState('Offline');
  const [rideRequest, setRideRequest] = useState(null);

  useEffect(() => {
    // Check if opened from notification
    if (route.params?.rideRequest) {
      console.log('📱 Opened from notification with ride request:', route.params.rideRequest);
      showRideRequestAlert(route.params.rideRequest);
    }
  }, [route.params]);

  // Handle driver going ONLINE
  const handleGoOnline = async () => {
    try {
      const driverId = await AsyncStorage.getItem('driverId');
      const driverName = await AsyncStorage.getItem('driverName');
      const vehicleType = await AsyncStorage.getItem('driverVehicleType');

      // 1. Start background location service
      await startBackgroundLocation();

      // 2. Update driver status in backend
      const response = await fetch(`${API_URL}/api/drivers/update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverId,
          status: 'Live'
        })
      });

      // 3. Get and update FCM token
      const fcmToken = await getFCMToken();
      await fetch(`${API_URL}/api/drivers/update-fcm-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverId,
          fcmToken,
          platform: Platform.OS
        })
      });

      // 4. Save ONLINE status
      await AsyncStorage.setItem('driverStatus', 'Live');
      setDriverStatus('Live');

      Alert.alert('Success', 'You are now ONLINE and will receive ride requests');
    } catch (error) {
      console.error('❌ Error going online:', error);
      Alert.alert('Error', 'Failed to go online');
    }
  };

  // Handle driver going OFFLINE
  const handleGoOffline = async () => {
    try {
      // 1. Stop background location service
      await stopBackgroundLocation();

      // 2. Update driver status in backend
      const driverId = await AsyncStorage.getItem('driverId');
      await fetch(`${API_URL}/api/drivers/update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverId,
          status: 'Offline'
        })
      });

      // 3. Save OFFLINE status
      await AsyncStorage.setItem('driverStatus', 'Offline');
      setDriverStatus('Offline');

      Alert.alert('Success', 'You are now OFFLINE');
    } catch (error) {
      console.error('❌ Error going offline:', error);
    }
  };

  // Show ride request alert
  const showRideRequestAlert = (rideData) => {
    // Parse data if needed
    const pickup = typeof rideData.pickup === 'string' ? JSON.parse(rideData.pickup) : rideData.pickup;
    const drop = typeof rideData.drop === 'string' ? JSON.parse(rideData.drop) : rideData.drop;

    Alert.alert(
      '🚖 New Ride Request',
      `Pickup: ${pickup.address}\nDrop: ${drop.address}\nFare: ₹${rideData.fare}\nDistance: ${rideData.distance} km`,
      [
        {
          text: 'Reject',
          onPress: () => handleRejectRide(rideData.rideId),
          style: 'cancel'
        },
        {
          text: 'Accept',
          onPress: () => handleAcceptRide(rideData.rideId)
        }
      ],
      { cancelable: false }
    );
  };

  // Listen for FCM messages while in foreground
  useEffect(() => {
    const unsubscribe = messaging().onMessage(async (remoteMessage) => {
      console.log('📱 Foreground FCM message:', remoteMessage);

      if (remoteMessage.data?.type === 'ride_request') {
        showRideRequestAlert(remoteMessage.data);
      }
    });

    return unsubscribe;
  }, []);

  // Restore driver status on app startup
  useEffect(() => {
    const restoreDriverStatus = async () => {
      const status = await AsyncStorage.getItem('driverStatus');
      if (status === 'Live') {
        console.log('📱 Restoring ONLINE status and restarting background location');
        // Restart background location if driver was ONLINE
        const isRunning = isBackgroundLocationRunning();
        if (!isRunning) {
          await startBackgroundLocation();
        }
        setDriverStatus('Live');
      }
    };

    restoreDriverStatus();
  }, []);

  return (
    // Your UI
  );
};

export default Screen1;
```

---

## 📋 Android Permissions

**File**: `android/app/src/main/AndroidManifest.xml`

```xml
<manifest>
  <!-- Location permissions -->
  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
  <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
  <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />

  <!-- Network permissions -->
  <uses-permission android:name="android.permission.INTERNET" />

  <!-- FCM permissions -->
  <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
  <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />

  <!-- Background service -->
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
  <uses-permission android:name="android.permission.WAKE_LOCK" />

  <application>
    <!-- ... your app configuration ... -->

    <!-- FCM default notification channel -->
    <meta-data
      android:name="com.google.firebase.messaging.default_notification_channel_id"
      android:value="ride-requests" />
  </application>
</manifest>
```

---

## 📋 iOS Permissions

**File**: `ios/YourApp/Info.plist`

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>We need your location to share with riders</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>We need your location even when the app is in background to keep you available for rides</string>

<key>NSLocationAlwaysUsageDescription</key>
<string>We need your location in background to keep you available for rides</string>

<key>UIBackgroundModes</key>
<array>
  <string>location</string>
  <string>remote-notification</string>
  <string>fetch</string>
</array>
```

---

## 🧪 Testing Guide

### Test 1: Background Location Updates

1. Driver logs in and goes ONLINE
2. Put app in background (home button)
3. Watch backend logs for location updates
4. **Expected**: Location updates continue every 10 seconds

### Test 2: FCM Notification (App in Background)

1. Driver goes ONLINE
2. Put app in background
3. User books a ride (same vehicle type)
4. **Expected**:
   - Notification appears on driver's screen
   - Notification shows ride details
   - Tapping notification opens app to ride request

### Test 3: FCM Notification (App Closed/Killed)

1. Driver goes ONLINE
2. Close/kill the app completely
3. User books a ride
4. **Expected**:
   - Notification still appears
   - Tapping notification opens app to ride request
   - Background location service restarts

### Test 4: Screen Locked

1. Driver goes ONLINE
2. Lock the screen
3. User books a ride
4. **Expected**:
   - Notification appears on lock screen
   - Location updates continue
   - Driver can accept/reject from notification

---

## 🎯 Expected Professional Behavior

### ✅ Driver Goes ONLINE

```
Driver clicks ONLINE button
    ↓
Background location service starts ✅
    ↓
FCM token registered/updated ✅
    ↓
Driver status updated to "Live" in backend ✅
    ↓
Driver joins vehicle-specific socket room ✅
    ↓
Location shared every 10 seconds ✅
```

### ✅ User Books Ride (Driver App in Background)

```
User books taxi ride
    ↓
Backend finds ONLINE taxi drivers ✅
    ↓
Sends FCM notification to all ONLINE taxi drivers ✅
    ↓
Notification appears on driver's screen ✅
    ↓
Driver taps notification ✅
    ↓
App opens to Screen1 with ride request ✅
    ↓
Driver can Accept/Reject ✅
```

### ✅ Driver Goes OFFLINE

```
Driver clicks OFFLINE button
    ↓
Background location service stops ✅
    ↓
Driver status updated to "Offline" in backend ✅
    ↓
Driver leaves socket room ✅
    ↓
No more ride requests ✅
```

---

## 🔐 Production Checklist

- [ ] Test background location on real device (not simulator)
- [ ] Test FCM notifications in all states (foreground/background/killed)
- [ ] Test deep linking (notification tap → ride request UI)
- [ ] Test with screen locked
- [ ] Test battery optimization settings (Android)
- [ ] Test low battery mode (iOS)
- [ ] Test with poor network connection
- [ ] Test driver logout (should stop background service)
- [ ] Test app crash recovery (should restore ONLINE state if was ONLINE)

---

## 📝 Summary

### Backend Status
- ✅ FCM infrastructure ready
- ✅ Notifications sent with complete ride data
- ✅ Deep linking data included (`click_action`)
- ✅ Vehicle type filtering working

### Frontend Requirements
1. **Install packages**: Background service, FCM, location
2. **Create BackgroundLocationService.js**: Handles location updates when app is background/closed
3. **Create FCMService.js**: Handles notifications in all states
4. **Update App.js**: Initialize FCM and notification channels
5. **Update Screen1.tsx**: Start/stop background service when ONLINE/OFFLINE
6. **Add permissions**: Android manifest + iOS plist

### Expected Result
- ✅ Driver goes ONLINE → Background location starts → Notifications work in all states
- ✅ User books ride → Notification arrives → Driver taps → App opens to ride request
- ✅ Professional Uber/Ola-level experience

---

**Status**: 📝 Complete Implementation Guide Ready
**Next Step**: Implement frontend code in driver app using this guide!
