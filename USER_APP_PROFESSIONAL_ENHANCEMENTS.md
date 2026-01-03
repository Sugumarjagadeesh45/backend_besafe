# User App - Professional Enhancements Guide

**Date**: 2025-12-31
**Objective**: Deliver Uber/Ola/Rapido-level user experience
**Status**: Implementation Guide for Frontend Team

---

## Overview

This document outlines the requirements for upgrading the user app to a professional, smooth ride-hailing experience with:
- Smooth driver location animations
- Professional ride completion UI
- Real-time wallet integration
- Polished transitions and alerts

---

## 1. Smooth Nearby Driver Live Location Animation

### Current State ✅
- Nearby drivers' live locations are displayed
- Driver icons update when positions change

### Required Enhancement 🎯
Implement **smooth, continuous animation** for driver icon movement.

### Implementation Details

#### A. Use Animated Marker Movement (React Native Maps)

```javascript
import { Animated } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

// State for each driver
const [driverLocations, setDriverLocations] = useState({});
const animatedCoordinates = useRef({});

// Initialize animated values for each driver
const initializeDriverAnimation = (driverId, coordinate) => {
  if (!animatedCoordinates.current[driverId]) {
    animatedCoordinates.current[driverId] = {
      latitude: new Animated.Value(coordinate.latitude),
      longitude: new Animated.Value(coordinate.longitude),
      rotation: new Animated.Value(0)
    };
  }
};

// Animate driver movement
const animateDriverMovement = (driverId, newCoordinate, bearing = 0) => {
  const animated = animatedCoordinates.current[driverId];

  if (!animated) {
    initializeDriverAnimation(driverId, newCoordinate);
    return;
  }

  // Calculate animation duration based on distance
  const oldLat = animated.latitude._value;
  const oldLng = animated.longitude._value;
  const distance = calculateDistance(
    { latitude: oldLat, longitude: oldLng },
    newCoordinate
  );

  // Duration: 1000ms for nearby updates, longer for far distances
  const duration = Math.min(Math.max(distance * 10000, 1000), 3000);

  // Animate position
  Animated.parallel([
    Animated.timing(animated.latitude, {
      toValue: newCoordinate.latitude,
      duration: duration,
      useNativeDriver: false
    }),
    Animated.timing(animated.longitude, {
      toValue: newCoordinate.longitude,
      duration: duration,
      useNativeDriver: false
    }),
    Animated.timing(animated.rotation, {
      toValue: bearing,
      duration: 500,
      useNativeDriver: false
    })
  ]).start();
};

// Socket listener for driver location updates
useEffect(() => {
  socket.on('driverLocationUpdate', (data) => {
    const { driverId, latitude, longitude, bearing } = data;

    animateDriverMovement(
      driverId,
      { latitude, longitude },
      bearing || 0
    );

    setDriverLocations(prev => ({
      ...prev,
      [driverId]: { latitude, longitude, bearing }
    }));
  });

  return () => socket.off('driverLocationUpdate');
}, []);

// Render animated markers
{Object.entries(driverLocations).map(([driverId, location]) => {
  const animated = animatedCoordinates.current[driverId];

  if (!animated) return null;

  return (
    <Marker.Animated
      key={driverId}
      coordinate={{
        latitude: animated.latitude,
        longitude: animated.longitude
      }}
      rotation={animated.rotation}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <Image
        source={require('./assets/driver-icon.png')}
        style={{
          width: 40,
          height: 40,
          transform: [{ rotate: `${animated.rotation._value}deg` }]
        }}
      />
    </Marker.Animated>
  );
})}
```

#### B. Calculate Distance Helper

```javascript
const calculateDistance = (coord1, coord2) => {
  const R = 6371; // Earth radius in km
  const dLat = (coord2.latitude - coord1.latitude) * Math.PI / 180;
  const dLon = (coord2.longitude - coord1.longitude) * Math.PI / 180;

  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(coord1.latitude * Math.PI / 180) *
    Math.cos(coord2.latitude * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c; // Distance in km

  return distance;
};
```

#### C. Calculate Bearing Helper

```javascript
const calculateBearing = (start, end) => {
  const startLat = start.latitude * Math.PI / 180;
  const startLng = start.longitude * Math.PI / 180;
  const endLat = end.latitude * Math.PI / 180;
  const endLng = end.longitude * Math.PI / 180;

  const dLng = endLng - startLng;

  const y = Math.sin(dLng) * Math.cos(endLat);
  const x = Math.cos(startLat) * Math.sin(endLat) -
            Math.sin(startLat) * Math.cos(endLat) * Math.cos(dLng);

  const bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360; // Normalize to 0-360
};
```

---

## 2. Ride Acceptance Filtering (Already Working) ✅

### Current Behaviour (Correct)
- When ride is booked, all nearby drivers receive notification
- First driver to accept is selected
- All other driver icons are hidden
- Only accepted driver remains visible

### No Changes Required
This logic is correct and should remain as is.

---

## 3. Smooth Driver Movement During Ride (CRITICAL)

### Required Behaviour
After ride acceptance, the accepted driver's movement must be:
- **Smooth and continuous** (no jumps)
- **Direction-aware** (icon rotates based on driving direction)
- **Speed-aware** (faster movement for higher speeds)
- **Route-aligned** (follows actual road, not straight line)

### Implementation

#### A. Enhanced Driver Tracking During Ride

```javascript
const [acceptedDriver, setAcceptedDriver] = useState(null);
const [driverRoute, setDriverRoute] = useState(null);
const [travelledRoute, setTravelledRoute] = useState([]);

// When driver accepts ride
const onRideAccepted = (driverData) => {
  setAcceptedDriver(driverData);

  // Hide all other drivers
  setNearbyDrivers([]);

  // Fetch route from driver to pickup
  fetchRouteToPickup(driverData.location, pickupLocation);
};

// Fetch route using Google Directions API
const fetchRouteToPickup = async (origin, destination) => {
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/directions/json?` +
      `origin=${origin.latitude},${origin.longitude}&` +
      `destination=${destination.latitude},${destination.longitude}&` +
      `key=${GOOGLE_MAPS_API_KEY}`
    );

    const data = await response.json();

    if (data.routes.length > 0) {
      const points = decodePolyline(data.routes[0].overview_polyline.points);
      setDriverRoute(points);
    }
  } catch (error) {
    console.error('Error fetching route:', error);
  }
};

// Decode Google polyline
const decodePolyline = (encoded) => {
  const poly = [];
  let index = 0, len = encoded.length;
  let lat = 0, lng = 0;

  while (index < len) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    poly.push({
      latitude: lat / 1E5,
      longitude: lng / 1E5
    });
  }

  return poly;
};

// Update travelled route as driver moves
const updateTravelledRoute = (newLocation) => {
  setTravelledRoute(prev => [...prev, newLocation]);

  // Update remaining route
  const remainingPoints = driverRoute.filter(point => {
    const distance = calculateDistance(newLocation, point);
    return distance > 0.01; // 10 meters threshold
  });

  setDriverRoute(remainingPoints);
};

// Socket listener for accepted driver location
useEffect(() => {
  if (!acceptedDriver) return;

  socket.on('acceptedDriverLocation', (data) => {
    const { driverId, latitude, longitude, speed, bearing } = data;

    if (driverId !== acceptedDriver.driverId) return;

    const newLocation = { latitude, longitude };

    // Animate driver icon
    animateDriverMovement(driverId, newLocation, bearing);

    // Update travelled route
    updateTravelledRoute(newLocation);

    // Update driver state
    setAcceptedDriver(prev => ({
      ...prev,
      location: newLocation,
      speed,
      bearing
    }));
  });

  return () => socket.off('acceptedDriverLocation');
}, [acceptedDriver]);
```

#### B. Render Smooth Route Polylines

```javascript
<MapView>
  {/* Travelled Route (Grey) */}
  {travelledRoute.length > 0 && (
    <Polyline
      coordinates={travelledRoute}
      strokeColor="#999999"
      strokeWidth={4}
      lineDashPattern={[1]}
    />
  )}

  {/* Remaining Route (Blue) */}
  {driverRoute && driverRoute.length > 0 && (
    <Polyline
      coordinates={driverRoute}
      strokeColor="#4285F4"
      strokeWidth={5}
    />
  )}

  {/* Accepted Driver Marker */}
  {acceptedDriver && (
    <Marker.Animated
      coordinate={{
        latitude: animatedCoordinates.current[acceptedDriver.driverId]?.latitude,
        longitude: animatedCoordinates.current[acceptedDriver.driverId]?.longitude
      }}
      rotation={animatedCoordinates.current[acceptedDriver.driverId]?.rotation}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <Image
        source={require('./assets/driver-car.png')}
        style={{ width: 50, height: 50 }}
      />
    </Marker.Animated>
  )}
</MapView>
```

---

## 4. Pickup & Ride Start Experience (Already Working) ✅

### Current Behaviour (Correct)
- Driver reaches pickup location
- OTP verification completed
- Professional "Ride Started" alert shown

### No Changes Required
This flow is correct and should remain as is.

---

## 5. Ride Completion & Professional Billing UI (CRITICAL)

### Required Behaviour
When ride is completed:
1. Show **professional billing summary alert**
2. Credit ride amount to user's wallet
3. Update wallet balance in UI immediately

### Implementation

#### A. Ride Completion Handler

```javascript
const [rideDetails, setRideDetails] = useState(null);

useEffect(() => {
  socket.on('rideCompleted', async (data) => {
    const {
      rideId,
      distance,
      duration,
      fareBreakdown,
      totalAmount,
      walletBalance
    } = data;

    // Store ride details
    setRideDetails({
      distance,
      duration,
      fareBreakdown,
      totalAmount
    });

    // Update user wallet balance immediately
    setUserWalletBalance(walletBalance);
    await AsyncStorage.setItem('userWalletBalance', walletBalance.toString());

    // Show professional billing alert
    showBillingAlert({
      distance,
      duration,
      fareBreakdown,
      totalAmount,
      walletBalance
    });
  });

  return () => socket.off('rideCompleted');
}, []);
```

#### B. Professional Billing Alert Component

```javascript
import { Modal, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { BlurView } from '@react-native-community/blur';

const BillingAlert = ({ visible, onClose, billing }) => {
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <BlurView
        style={styles.blurContainer}
        blurType="dark"
        blurAmount={10}
      >
        <View style={styles.alertContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.successIcon}>
              <Text style={styles.checkmark}>✓</Text>
            </View>
            <Text style={styles.title}>Ride Completed</Text>
            <Text style={styles.subtitle}>Thank you for riding with us!</Text>
          </View>

          {/* Billing Details */}
          <ScrollView style={styles.detailsContainer}>
            {/* Distance */}
            <View style={styles.row}>
              <Text style={styles.label}>Distance Travelled</Text>
              <Text style={styles.value}>{billing.distance} km</Text>
            </View>

            {/* Duration */}
            <View style={styles.row}>
              <Text style={styles.label}>Duration</Text>
              <Text style={styles.value}>{billing.duration} mins</Text>
            </View>

            <View style={styles.divider} />

            {/* Fare Breakdown */}
            <Text style={styles.sectionTitle}>Fare Breakdown</Text>

            <View style={styles.row}>
              <Text style={styles.label}>Base Fare</Text>
              <Text style={styles.value}>₹{billing.fareBreakdown.baseFare}</Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>Distance Charge</Text>
              <Text style={styles.value}>₹{billing.fareBreakdown.distanceCharge}</Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>Time Charge</Text>
              <Text style={styles.value}>₹{billing.fareBreakdown.timeCharge}</Text>
            </View>

            {billing.fareBreakdown.surcharge > 0 && (
              <View style={styles.row}>
                <Text style={styles.label}>Surcharge</Text>
                <Text style={styles.value}>₹{billing.fareBreakdown.surcharge}</Text>
              </View>
            )}

            <View style={styles.divider} />

            {/* Total */}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total Amount</Text>
              <Text style={styles.totalValue}>₹{billing.totalAmount}</Text>
            </View>

            {/* Wallet Credit */}
            <View style={styles.walletCredit}>
              <Text style={styles.walletText}>
                ✓ ₹{billing.totalAmount} credited to your wallet
              </Text>
              <Text style={styles.walletBalance}>
                New Balance: ₹{billing.walletBalance}
              </Text>
            </View>
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                onClose();
                navigation.navigate('RideHistory');
              }}
            >
              <Text style={styles.secondaryButtonText}>View Details</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={onClose}
            >
              <Text style={styles.primaryButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </BlurView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  blurContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)'
  },
  alertContainer: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10
  },
  header: {
    alignItems: 'center',
    marginBottom: 20
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15
  },
  checkmark: {
    fontSize: 50,
    color: '#FFFFFF',
    fontWeight: 'bold'
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 5
  },
  subtitle: {
    fontSize: 14,
    color: '#666666'
  },
  detailsContainer: {
    maxHeight: 400
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12
  },
  label: {
    fontSize: 16,
    color: '#666666'
  },
  value: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333'
  },
  divider: {
    height: 1,
    backgroundColor: '#E0E0E0',
    marginVertical: 10
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333333',
    marginTop: 10,
    marginBottom: 5
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 15,
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 15,
    borderRadius: 10,
    marginTop: 10
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333333'
  },
  totalValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#4CAF50'
  },
  walletCredit: {
    backgroundColor: '#E8F5E9',
    padding: 15,
    borderRadius: 10,
    marginTop: 15,
    alignItems: 'center'
  },
  walletText: {
    fontSize: 16,
    color: '#2E7D32',
    fontWeight: '600',
    marginBottom: 5
  },
  walletBalance: {
    fontSize: 14,
    color: '#388E3C'
  },
  buttonContainer: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 10
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#4CAF50',
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center'
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold'
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#4CAF50'
  },
  secondaryButtonText: {
    color: '#4CAF50',
    fontSize: 16,
    fontWeight: 'bold'
  }
});
```

#### C. Show Billing Alert Function

```javascript
const [billingVisible, setBillingVisible] = useState(false);
const [billingData, setBillingData] = useState(null);

const showBillingAlert = (data) => {
  setBillingData(data);
  setBillingVisible(true);
};

// In render
<BillingAlert
  visible={billingVisible}
  onClose={() => setBillingVisible(false)}
  billing={billingData}
/>
```

---

## 6. Wallet Usage & Persistence

### Requirements
- User wallet balance stored in database
- Wallet balance reflected instantly in UI
- Wallet usable for future rides and payments

### Implementation

#### A. Wallet State Management

```javascript
const [userWalletBalance, setUserWalletBalance] = useState(0);

// Load wallet balance on app start
useEffect(() => {
  loadWalletBalance();
}, []);

const loadWalletBalance = async () => {
  try {
    const userId = await AsyncStorage.getItem('userId');

    // Fetch from backend
    const response = await fetch(`${API_BASE_URL}/api/users/wallet/${userId}`);
    const data = await response.json();

    if (data.success) {
      setUserWalletBalance(data.walletBalance);
      await AsyncStorage.setItem('userWalletBalance', data.walletBalance.toString());
    }
  } catch (error) {
    // Fallback to AsyncStorage
    const cached = await AsyncStorage.getItem('userWalletBalance');
    if (cached) {
      setUserWalletBalance(parseFloat(cached));
    }
  }
};

// Update wallet after ride
const updateWalletAfterRide = async (newBalance) => {
  setUserWalletBalance(newBalance);
  await AsyncStorage.setItem('userWalletBalance', newBalance.toString());

  // Trigger re-render in Profile and Wallet screens
  // Use Context API or Redux
};
```

#### B. Wallet Display in Profile

```javascript
const ProfileScreen = () => {
  const { userWalletBalance } = useContext(AppContext);

  return (
    <View style={styles.container}>
      <View style={styles.walletCard}>
        <Text style={styles.walletLabel}>Wallet Balance</Text>
        <Text style={styles.walletAmount}>₹{userWalletBalance.toFixed(2)}</Text>
        <TouchableOpacity
          style={styles.addMoneyButton}
          onPress={() => navigation.navigate('AddMoney')}
        >
          <Text style={styles.addMoneyText}>+ Add Money</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
```

#### C. Real-Time Wallet Updates (Context API)

```javascript
// AppContext.js
import React, { createContext, useState, useEffect } from 'react';

export const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [userWalletBalance, setUserWalletBalance] = useState(0);

  const updateWallet = (newBalance) => {
    setUserWalletBalance(newBalance);
    AsyncStorage.setItem('userWalletBalance', newBalance.toString());
  };

  return (
    <AppContext.Provider value={{ userWalletBalance, updateWallet }}>
      {children}
    </AppContext.Provider>
  );
};

// In App.js
import { AppProvider } from './AppContext';

export default function App() {
  return (
    <AppProvider>
      <NavigationContainer>
        {/* Your app navigation */}
      </NavigationContainer>
    </AppProvider>
  );
}

// In any screen
const { userWalletBalance, updateWallet } = useContext(AppContext);
```

---

## 7. Backend API Requirements

### A. Ride Completion Endpoint

**Endpoint**: `POST /api/rides/complete`

**Request**:
```json
{
  "rideId": "RIDE1703123456789",
  "userId": "user10001",
  "distance": 5.2,
  "duration": 18,
  "fareBreakdown": {
    "baseFare": 50,
    "distanceCharge": 52,
    "timeCharge": 18,
    "surcharge": 0
  },
  "totalAmount": 120
}
```

**Response**:
```json
{
  "success": true,
  "message": "Ride completed successfully",
  "walletBalance": 1370,
  "ride": {
    "rideId": "RIDE1703123456789",
    "distance": 5.2,
    "duration": 18,
    "totalAmount": 120,
    "completedAt": "2025-12-31T10:30:00.000Z"
  }
}
```

### B. Get User Wallet Endpoint

**Endpoint**: `GET /api/users/wallet/:userId`

**Response**:
```json
{
  "success": true,
  "userId": "user10001",
  "walletBalance": 1370,
  "lastUpdated": "2025-12-31T10:30:00.000Z"
}
```

---

## 8. Testing Checklist

### Animation Tests
- [ ] Nearby drivers move smoothly (no jumps)
- [ ] Driver icons rotate based on direction
- [ ] Animation speed matches driver speed
- [ ] No lag or stuttering

### Ride Flow Tests
- [ ] Only accepted driver visible after acceptance
- [ ] Driver route displays correctly
- [ ] Travelled route shows in grey
- [ ] Remaining route shows in blue
- [ ] Route updates smoothly as driver moves

### Billing Alert Tests
- [ ] Professional billing alert appears on ride completion
- [ ] All fare details displayed correctly
- [ ] Wallet credit message shown
- [ ] New wallet balance displayed

### Wallet Tests
- [ ] Wallet balance updates immediately after ride
- [ ] Balance shown in Profile screen
- [ ] Balance shown in Wallet screen
- [ ] Balance persists across app restarts
- [ ] No UI/DB mismatch

---

## 9. Performance Optimization

### A. Throttle Driver Location Updates

```javascript
import { throttle } from 'lodash';

const throttledDriverUpdate = useCallback(
  throttle((driverId, location, bearing) => {
    animateDriverMovement(driverId, location, bearing);
  }, 1000), // Update max once per second
  []
);
```

### B. Optimize Map Rendering

```javascript
<MapView
  pitchEnabled={false}
  rotateEnabled={false}
  scrollEnabled={true}
  zoomEnabled={true}
  loadingEnabled={true}
  loadingIndicatorColor="#4CAF50"
  loadingBackgroundColor="#FFFFFF"
/>
```

### C. Clean Up Animations

```javascript
useEffect(() => {
  return () => {
    // Stop all animations on unmount
    Object.values(animatedCoordinates.current).forEach(animated => {
      animated.latitude.stopAnimation();
      animated.longitude.stopAnimation();
      animated.rotation.stopAnimation();
    });
  };
}, []);
```

---

## 10. Professional UI/UX Guidelines

### Colors
- Primary: `#4CAF50` (Green)
- Success: `#4CAF50`
- Error: `#F44336`
- Grey: `#999999`
- Dark Grey: `#333333`
- Light Grey: `#E0E0E0`

### Fonts
- Titles: Bold, 24px
- Subtitles: Regular, 16px
- Body: Regular, 14px
- Small: Regular, 12px

### Animations
- Duration: 300-500ms for UI transitions
- 1000-3000ms for map animations
- Easing: `easeInOut` for smooth feel

### Shadows
- Elevation: 5-10 for cards
- Shadow Opacity: 0.1-0.3

---

## Summary

**What Needs to Be Done**:
1. ✅ Implement smooth driver icon animations
2. ✅ Add route polylines (travelled vs remaining)
3. ✅ Create professional billing alert UI
4. ✅ Integrate real-time wallet updates
5. ✅ Add Context API for wallet state management

**Expected Result**:
- **Uber/Ola-level smooth animations**
- **Professional, polished UI**
- **Real-time wallet integration**
- **No UI/backend mismatch**
- **Seamless user experience**

---

**Status**: Ready for Implementation
**Priority**: High (UX Enhancement)
**Complexity**: Medium
**Estimated Time**: 3-5 days for full implementation

All backend APIs are ready. Frontend team can start implementation immediately!
