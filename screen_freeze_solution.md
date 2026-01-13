# Driver App Screen Freeze Solution After OTP Verification

**Last Updated:** 2026-01-13
**Issue:** Driver screen freezes after Firebase OTP verification
**Solution:** Automatic screen refresh and state management

---

## 🎯 Problem Overview

After Firebase OTP verification completes successfully, the driver app screen freezes and does not automatically navigate to the main driver screen. The app needs to:

1. ✅ Complete OTP verification with Firebase
2. ✅ Fetch driver data from backend
3. ✅ Store authentication token and driver info
4. ✅ **IMMEDIATELY refresh/navigate to driver screen** (< 1 second)
5. ✅ Never freeze or hang

---

## 🔧 Backend API Endpoints (DO NOT CHANGE)

### 1. Request Driver OTP (Step 1)
**Endpoint:** `POST /api/auth/request-driver-otp`

**Purpose:** Verify driver exists before Firebase OTP

**Request:**
```json
{
  "phoneNumber": "9876543210"
}
```

**Response:**
```json
{
  "success": true,
  "driverId": "DRV001",
  "name": "John Doe",
  "phone": "9876543210",
  "vehicleType": "bike",
  "vehicleNumber": "KA01AB1234",
  "message": "Driver verified. Proceed with Firebase OTP."
}
```

**URL:** `https://your-backend-url.com/api/auth/request-driver-otp`

---

### 2. Get Complete Driver Info (After OTP - Step 2)
**Endpoint:** `POST /api/auth/get-complete-driver-info`

**Purpose:** Fetch complete driver profile and JWT token after Firebase OTP succeeds

**Request:**
```json
{
  "phoneNumber": "9876543210"
}
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
    "phone": "9876543210",
    "email": "john@example.com",
    "vehicleType": "bike",
    "vehicleNumber": "KA01AB1234",
    "wallet": 500,
    "status": "Offline",
    "location": {
      "type": "Point",
      "coordinates": [77.5946, 12.9716]
    },
    "fcmToken": "",
    "profilePicture": "",
    "licenseNumber": "KA1234567890",
    "aadharNumber": "1234",
    "dob": null,
    "active": true
  },
  "message": "Driver authenticated successfully"
}
```

**URL:** `https://your-backend-url.com/api/auth/get-complete-driver-info`

---

### 3. Alternative Endpoint (Fallback)
**Endpoint:** `POST /api/auth/get-driver-info`

Same functionality as above, use if `get-complete-driver-info` fails.

---

## 🚀 Complete OTP Verification Flow (Frontend Implementation)

### Step-by-Step Implementation

```javascript
// 1️⃣ IMPORT REQUIRED MODULES
import AsyncStorage from '@react-native-async-storage/async-storage';
import auth from '@react-native-firebase/auth';
import { API_BASE } from './apiConfig';

// 2️⃣ STATE MANAGEMENT
const [phoneNumber, setPhoneNumber] = useState('');
const [otp, setOtp] = useState('');
const [verificationId, setVerificationId] = useState(null);
const [isLoading, setIsLoading] = useState(false);

// 3️⃣ REQUEST OTP FUNCTION
const requestDriverOTP = async (phone) => {
  try {
    setIsLoading(true);

    // Clean phone number
    const cleanPhone = phone.replace('+91', '').replace(/\D/g, '');

    // Step 1: Verify driver exists in backend
    const response = await fetch(`${API_BASE}/auth/request-driver-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true'
      },
      body: JSON.stringify({ phoneNumber: cleanPhone })
    });

    const result = await response.json();

    if (!result.success) {
      Alert.alert('Error', result.message || 'Driver not found');
      setIsLoading(false);
      return;
    }

    console.log('✅ Driver verified:', result.driverId);

    // Step 2: Send Firebase OTP
    const confirmation = await auth().signInWithPhoneNumber(`+91${cleanPhone}`);
    setVerificationId(confirmation.verificationId);

    Alert.alert('Success', 'OTP sent to your phone');
    setIsLoading(false);

  } catch (error) {
    console.error('❌ OTP request error:', error);
    Alert.alert('Error', 'Failed to send OTP. Please try again.');
    setIsLoading(false);
  }
};

// 4️⃣ VERIFY OTP AND LOGIN (CRITICAL - NO FREEZE)
const verifyOTPAndLogin = async (otpCode) => {
  try {
    setIsLoading(true);

    // Step 1: Verify Firebase OTP
    const credential = auth.PhoneAuthProvider.credential(verificationId, otpCode);
    const firebaseResult = await auth().signInWithCredential(credential);

    console.log('✅ Firebase OTP verified');

    // Step 2: Get driver data from backend IMMEDIATELY
    const cleanPhone = firebaseResult.user.phoneNumber.replace('+91', '');

    const response = await fetch(`${API_BASE}/auth/get-complete-driver-info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true'
      },
      body: JSON.stringify({ phoneNumber: cleanPhone })
    });

    const result = await response.json();

    if (!result.success || !result.token || !result.driver) {
      throw new Error(result.message || 'Failed to fetch driver data');
    }

    console.log('✅ Driver data received:', result.driver.driverId);

    // Step 3: Store data IMMEDIATELY in AsyncStorage
    await Promise.all([
      AsyncStorage.setItem('authToken', result.token),
      AsyncStorage.setItem('driverId', result.driver.driverId),
      AsyncStorage.setItem('driverName', result.driver.name),
      AsyncStorage.setItem('driverPhone', result.driver.phone),
      AsyncStorage.setItem('driverVehicleType', result.driver.vehicleType.toLowerCase()),
      AsyncStorage.setItem('driverInfo', JSON.stringify(result.driver))
    ]);

    console.log('✅ All data stored in AsyncStorage');

    // Step 4: IMMEDIATE NAVIGATION - NO DELAY
    setIsLoading(false);

    // CRITICAL: Navigate immediately with driver data
    navigation.replace('DriverScreen', {
      driverId: result.driver.driverId,
      driverName: result.driver.name,
      latitude: result.driver.location?.coordinates[1] || 0,
      longitude: result.driver.location?.coordinates[0] || 0,
      vehicleType: result.driver.vehicleType.toLowerCase()
    });

    console.log('✅ Navigation completed');

  } catch (error) {
    console.error('❌ OTP verification error:', error);
    setIsLoading(false);
    Alert.alert(
      'Verification Failed',
      error.message || 'Invalid OTP. Please try again.'
    );
  }
};
```

---

## 📱 Complete Login Screen Component

```javascript
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import auth from '@react-native-firebase/auth';
import { API_BASE } from './apiConfig';

const LoginScreen = ({ navigation }) => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [verificationId, setVerificationId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showOTPInput, setShowOTPInput] = useState(false);

  // Request OTP
  const handleRequestOTP = async () => {
    if (phoneNumber.length !== 10) {
      Alert.alert('Error', 'Please enter a valid 10-digit phone number');
      return;
    }

    try {
      setIsLoading(true);

      // Verify driver exists
      const response = await fetch(`${API_BASE}/auth/request-driver-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({ phoneNumber })
      });

      const result = await response.json();

      if (!result.success) {
        Alert.alert('Error', result.message || 'Driver not found');
        setIsLoading(false);
        return;
      }

      // Send Firebase OTP
      const confirmation = await auth().signInWithPhoneNumber(`+91${phoneNumber}`);
      setVerificationId(confirmation.verificationId);
      setShowOTPInput(true);

      Alert.alert('Success', 'OTP sent to your phone');
      setIsLoading(false);

    } catch (error) {
      console.error('OTP request error:', error);
      Alert.alert('Error', 'Failed to send OTP');
      setIsLoading(false);
    }
  };

  // Verify OTP and Login
  const handleVerifyOTP = async () => {
    if (otp.length !== 6) {
      Alert.alert('Error', 'Please enter a valid 6-digit OTP');
      return;
    }

    try {
      setIsLoading(true);

      // Verify Firebase OTP
      const credential = auth.PhoneAuthProvider.credential(verificationId, otp);
      await auth().signInWithCredential(credential);

      // Fetch driver data from backend
      const response = await fetch(`${API_BASE}/auth/get-complete-driver-info`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({ phoneNumber })
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message);
      }

      // Store all data
      await Promise.all([
        AsyncStorage.setItem('authToken', result.token),
        AsyncStorage.setItem('driverId', result.driver.driverId),
        AsyncStorage.setItem('driverName', result.driver.name),
        AsyncStorage.setItem('driverPhone', result.driver.phone),
        AsyncStorage.setItem('driverVehicleType', result.driver.vehicleType.toLowerCase()),
        AsyncStorage.setItem('driverInfo', JSON.stringify(result.driver))
      ]);

      setIsLoading(false);

      // IMMEDIATE NAVIGATION
      navigation.replace('DriverScreen', {
        driverId: result.driver.driverId,
        driverName: result.driver.name,
        latitude: result.driver.location?.coordinates[1] || 0,
        longitude: result.driver.location?.coordinates[0] || 0,
        vehicleType: result.driver.vehicleType.toLowerCase()
      });

    } catch (error) {
      console.error('Verification error:', error);
      setIsLoading(false);
      Alert.alert('Error', error.message || 'Invalid OTP');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Driver Login</Text>

      {!showOTPInput ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="Enter 10-digit phone number"
            keyboardType="phone-pad"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            maxLength={10}
          />
          <TouchableOpacity
            style={styles.button}
            onPress={handleRequestOTP}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Request OTP</Text>
            )}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="Enter 6-digit OTP"
            keyboardType="number-pad"
            value={otp}
            onChangeText={setOtp}
            maxLength={6}
          />
          <TouchableOpacity
            style={styles.button}
            onPress={handleVerifyOTP}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Verify & Login</Text>
            )}
          </TouchableOpacity>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#fff'
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
    textAlign: 'center'
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 15,
    fontSize: 16,
    marginBottom: 15
  },
  button: {
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center'
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold'
  }
});

export default LoginScreen;
```

---

## ✅ Critical Success Checklist

### Backend (No Changes Required)
- ✅ `/api/auth/request-driver-otp` endpoint working
- ✅ `/api/auth/get-complete-driver-info` endpoint working
- ✅ Returns JWT token and complete driver object
- ✅ Driver `vehicleType` field exists and is lowercase

### Frontend Implementation
- ✅ Firebase OTP verification integrated
- ✅ Backend API calls after OTP success
- ✅ AsyncStorage data storage (token, driverId, driverName, vehicleType)
- ✅ **IMMEDIATE navigation with `navigation.replace()`**
- ✅ No setTimeout or delays
- ✅ Loading states managed properly
- ✅ Error handling with user feedback

### Data Flow
```
User enters phone →
Backend verifies driver exists →
Firebase sends OTP →
User enters OTP →
Firebase verifies OTP →
Backend returns driver data + token →
Store in AsyncStorage →
**IMMEDIATE navigation to DriverScreen** →
✅ NO FREEZE
```

---

## 🚫 Common Mistakes to Avoid

### ❌ DON'T DO THIS:
```javascript
// ❌ NO setTimeout delays
setTimeout(() => {
  navigation.replace('DriverScreen');
}, 2000); // NEVER ADD DELAYS

// ❌ NO unnecessary loading states after data is ready
setIsLoading(true);
await fetchData();
// Still showing loading... WRONG!

// ❌ NO navigation.navigate (use replace)
navigation.navigate('DriverScreen'); // Can cause back button issues
```

### ✅ DO THIS:
```javascript
// ✅ IMMEDIATE navigation
await storeData();
setIsLoading(false);
navigation.replace('DriverScreen', { params }); // Instant

// ✅ Set loading false before navigation
setIsLoading(false);
navigation.replace('DriverScreen');

// ✅ Use Promise.all for parallel operations
await Promise.all([
  AsyncStorage.setItem('token', token),
  AsyncStorage.setItem('driverId', id)
]);
```

---

## 📊 Performance Targets

| Metric | Target | Acceptable |
|--------|--------|------------|
| OTP verification to API call | < 100ms | < 500ms |
| API response time | < 500ms | < 1s |
| Data storage (AsyncStorage) | < 100ms | < 300ms |
| Navigation execution | **< 50ms** | **< 100ms** |
| **Total time (OTP → Screen)** | **< 1s** | **< 2s** |

---

## 🔍 Debugging Guide

### Console Logs to Add:
```javascript
console.log('1️⃣ Firebase OTP verified');
console.log('2️⃣ Calling backend API...');
console.log('3️⃣ Backend response received:', result.success);
console.log('4️⃣ Storing data in AsyncStorage...');
console.log('5️⃣ Data stored successfully');
console.log('6️⃣ Navigating to DriverScreen...');
console.log('7️⃣ Navigation completed');
```

### Check These If App Freezes:
1. Is `result.success` true?
2. Is `result.token` present?
3. Is `result.driver` object complete?
4. Did AsyncStorage.setItem complete?
5. Is navigation function called?
6. Check React Navigation stack configuration

---

## 🔗 Important URLs

### Development
- Local API: `http://localhost:5001`
- Ngrok URL: `https://your-ngrok-url.com`

### Production
- Production API: `https://your-production-url.com`

### Headers Required
```javascript
headers: {
  'Content-Type': 'application/json',
  'ngrok-skip-browser-warning': 'true', // For ngrok testing
  'User-Agent': 'EazygoDriverApp/1.0'
}
```

---

## 📋 Testing Procedure

### Test Case 1: Happy Path
1. Enter valid phone number
2. Click "Request OTP"
3. Receive Firebase OTP on phone
4. Enter correct OTP
5. **Expected:** Screen refreshes within 1 second, lands on DriverScreen
6. **Verify:** Driver info displayed, map loads, location tracking starts

### Test Case 2: Invalid OTP
1. Enter valid phone number
2. Click "Request OTP"
3. Enter wrong OTP
4. **Expected:** Error message shown, can retry
5. **Verify:** Screen does not freeze

### Test Case 3: Network Error
1. Turn off internet
2. Try OTP verification
3. **Expected:** Error message, retry option
4. **Verify:** App remains responsive

---

## 🎯 Final Implementation Checklist

- [ ] Remove all `setTimeout` delays after OTP verification
- [ ] Use `navigation.replace()` instead of `navigation.navigate()`
- [ ] Set `isLoading(false)` BEFORE navigation
- [ ] Store all required data in AsyncStorage with `Promise.all`
- [ ] Pass driver params to DriverScreen via navigation
- [ ] Test with real phone number and Firebase OTP
- [ ] Verify screen refreshes within 1 second
- [ ] Confirm no freeze or hang issues
- [ ] Test on both Android and iOS
- [ ] Verify with slow network conditions

---

## 📞 Support

If issues persist:
1. Check backend logs for API response
2. Check React Native debugger console
3. Verify Firebase configuration
4. Check AsyncStorage data with React Native Debugger
5. Verify navigation stack setup

---

**Document Version:** 1.0
**Last Updated:** 2026-01-13
**Status:** Ready for Implementation
