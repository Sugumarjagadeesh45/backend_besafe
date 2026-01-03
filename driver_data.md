# Frontend AI Guide: Driver Data & Events

This document provides the definitive structure for driver-related data and events. Use this as the single source of truth to prevent data parsing errors and ensure UI components display information correctly.

---

## 1. Core `AcceptedDriver` Object Structure

When a ride is accepted, the user app's state should store an `acceptedDriver` object with the following structure. All fields are guaranteed to exist, though some may have default values like `""` or `0`.

```typescript
interface AcceptedDriver {
  driverId: string;          // e.g., "dri10002"
  name: string;              // e.g., "Ramesh Kumar"
  driverMobile: string;      // e.g., "9876543210" or "N/A"
  vehicleType: 'bike' | 'taxi' | 'port'; // Lowercase
  vehicleNumber: string;     // e.g., "TN 01 AB 1234"
  rating: number;            // e.g., 4.8
  photoUrl: string;          // Full URL to the driver's profile picture
  location: {
    latitude: number;
    longitude: number;
  };
}
```

---

## 2. Socket Event: `rideAccepted`

This is the primary event received by the user app when a driver accepts the ride.

-   **Event Name:** `rideAccepted`
-   **Direction:** Server → User App

### Payload Structure

The data object received with this event contains all the necessary information to construct the `AcceptedDriver` object.

```json
{
  "success": true,
  "rideId": "RID003462",
  "driverId": "dri10002",
  "driverName": "Ramesh Kumar",
  "driverLat": 11.336068,
  "driverLng": 77.714483,
  "vehicleType": "bike",
  "driverPhone": "9876543210",
  "driverMobile": "9876543210",
  "driverVehicleNumber": "TN 01 AB 1234",
  "driverRating": 4.8,
  "driverPhoto": "/uploads/drivers/profile-pic.jpg",
  "message": "Ride accepted successfully"
}
```

### Frontend Implementation

When you receive this event, construct your local `acceptedDriver` state object like this:

```javascript
// Inside the socket listener for 'rideAccepted'
const onRideAccepted = (data) => {
  const newDriver = {
    driverId: data.driverId,
    name: data.driverName,
    // Map the mobile number (backend sends both keys for compatibility)
    driverMobile: data.driverMobile || data.driverPhone || "N/A",
    vehicleType: data.vehicleType,
    vehicleNumber: data.driverVehicleNumber,
    rating: data.driverRating,
    // CRITICAL: Construct the full photo URL
    photoUrl: `http://<YOUR_BACKEND_IP>:<PORT>${data.driverPhoto}`,
    location: {
      latitude: data.driverLat,
      longitude: data.driverLng,
    },
  };

  // Set this object to your state
  setAcceptedDriver(newDriver);
};
```

---

## 3. API Endpoint: Refresh Driver Data

If you need to manually refresh the driver's data (e.g., on app resume), use this endpoint.

-   **URL:** `/api/drivers/refresh/:driverId`
-   **Method:** `GET`
-   **Example:** `GET /api/drivers/refresh/dri10002`
-   **Authentication:** `Bearer <USER_AUTH_TOKEN>`

### Success Response (200 OK)

The response contains a `driver` object with the same fields needed to build the local `AcceptedDriver` state.

```json
{
  "success": true,
  "driver": {
    "driverId": "dri10002",
    "name": "Ramesh Kumar",
    "phone": "9876543210", // Note: API might return 'phone' or 'phoneNumber'
    "vehicleType": "bike",
    "vehicleNumber": "TN 01 AB 1234",
    "wallet": 500.75,
    "status": "onRide",
    // ... and other fields
  }
}
```