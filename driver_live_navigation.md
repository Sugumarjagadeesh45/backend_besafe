# 🚗 Driver Live Navigation - User App Implementation Guide
# 🚗 Driver Live Navigation & Tracking - User App Implementation Guide

## 📋 Overview
This document provides the complete implementation details for receiving driver live location updates in the User App.
This document serves as the **Single Source of Truth** for implementing real-time driver tracking in the User App. It details the socket events, payloads, and connection logic required to display the driver's movement smoothly on the map.

## 🔌 Socket Connection
---

### 1. Connection Setup
Ensure your socket is connected to the backend URL.
## 🔌 1. Socket Connection Configuration

**Base URL**: `http://<YOUR_BACKEND_IP>:5001` (Default port is 5001)
**Namespace**: `/` (Default)

### Client Initialization
Use `socket.io-client` in your React Native app.

```javascript
import io from 'socket.io-client';

// Replace with your actual backend URL
const SOCKET_URL = 'http://YOUR_BACKEND_URL'; 
// ⚠️ IMPORTANT: Replace with your actual backend IP
const SOCKET_URL = 'http://10.0.2.2:5001'; // For Android Emulator
// const SOCKET_URL = 'http://192.168.1.x:5001'; // For Physical Device

const socket = io(SOCKET_URL, {
  transports: ['websocket'],
  autoConnect: true
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000
});

socket.on('connect', () => {
  console.log('✅ Connected to socket server:', socket.id);
});
```

### 2. Register User
You **must** register the user with the socket to receive targeted updates.

```javascript
// Call this when the user logs in or opens the app
const registerUser = (userId, userMobile, rideId = null) => {
  socket.emit('registerUser', { 
    userId: userId, 
    userMobile: userMobile,
    rideId: rideId 
  });
};
```

## 📍 Receiving Driver Location

### Event: `driverLocationUpdate`
This event is emitted specifically to the user involved in an active ride.

**Payload:**
```json
{
  "rideId": "RID123456",
  "driverId": "dri10001",
  "driverName": "John Doe",
  "lat": 37.7749,
  "lng": -122.4194,
  "bearing": 45.0,
  "speed": 12.5,
  "status": "onRide",
  "vehicleType": "taxi",
  "timestamp": 1704298800123
}
```

### Event: `driverNavigationUpdate`
This event is optimized for drawing the route/polyline on the map.

**Payload:**
```json
{
  "rideId": "RID123456",
  "driverId": "dri10001",
  "coordinates": {
    "latitude": 37.7749,
    "longitude": -122.4194
  },
  "bearing": 45.0,
  "timestamp": 1704298800123
}
```

## 📱 React Native Implementation Example

```javascript
import React, { useEffect, useState, useRef } from 'react';
import MapView, { Marker } from 'react-native-maps';
import socket from './socket'; // Your socket instance

const RideTrackingScreen = ({ route }) => {
  const { rideId, userId } = route.params;
  const [driverLocation, setDriverLocation] = useState(null);
  const mapRef = useRef(null);

  useEffect(() => {
    // 1. Register User
    socket.emit('registerUser', { userId, rideId });

    // 2. Listen for Driver Location
    const handleDriverLocation = (data) => {
      console.log('📍 Driver Location Received:', data);
      
      const { lat, lng, bearing } = data;
      
      setDriverLocation({
        latitude: lat,
        longitude: lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });

      // Animate Camera
      mapRef.current?.animateCamera({
        center: { latitude: lat, longitude: lng },
        heading: bearing || 0,
        pitch: 0,
        zoom: 17,
      }, { duration: 1000 });
    };

    socket.on('driverLocationUpdate', handleDriverLocation);

    // 3. Request Initial Location
    socket.emit('requestDriverLocation', { rideId, userId });

    return () => {
      socket.off('driverLocationUpdate', handleDriverLocation);
    };
  }, [rideId, userId]);

  return (
    <MapView ref={mapRef} style={{ flex: 1 }}>
      {driverLocation && (
        <Marker 
          coordinate={driverLocation}
          title="Driver"
          image={require('./assets/car-icon.png')} // Use your car icon
        />
      )}
    </MapView>
  );
};

export default RideTrackingScreen;
```