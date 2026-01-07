# WALLET_DEBIT.md

**Comprehensive Guide: Driver Wallet Auto-Debit System**

This document explains the automatic wallet deduction system when drivers go **Online** and **Offline**, including all endpoints, functions, and important implementation notes.

---

## 📋 Table of Contents

1. [System Overview](#system-overview)
2. [Auto-Debit Triggers](#auto-debit-triggers)
3. [Deduction Amounts](#deduction-amounts)
4. [API Endpoints](#api-endpoints)
5. [Implementation Flow](#implementation-flow)
6. [Database Schema](#database-schema)
7. [Transaction Records](#transaction-records)
8. [Important Notes & Warnings](#important-notes--warnings)
9. [Testing & Debugging](#testing--debugging)

---

## System Overview

The backend implements an **automatic wallet deduction system** that charges drivers when they:

1. **Go ONLINE** → ₹100 deducted immediately (shift start fee)
2. **Ignore working hours warnings** → ₹100 deducted automatically after 12 hours
3. **Purchase extended hours manually** → ₹100 deducted (adds 12 more hours)
4. **Add half-time** → ₹50 deducted (adds 6 hours for 12h shift)
5. **Add full-time** → ₹100 deducted (adds 12 hours for 12h shift)

**Location:** `services/workingHoursService.js`

---

## Auto-Debit Triggers

### 1. **Driver Goes ONLINE (Shift Start Fee)**

**When:** Driver clicks "Go Online" button in app
**Amount:** ₹100 (configurable)
**Trigger:** `/api/drivers/working-hours/start` endpoint
**Function:** `startWorkingHoursTimer()` in `workingHoursService.js`

**Code Location:** `services/workingHoursService.js` - Lines 65-128

```javascript
const START_SHIFT_CHARGE = 100; // ₹100 shift start fee

// Deduct from wallet
driver.wallet -= START_SHIFT_CHARGE;

// Create transaction record
const transaction = new Transaction({
  driver: driver._id,
  amount: START_SHIFT_CHARGE,
  type: "debit",
  method: "shift_start_fee",
  description: "Online shift start fee (auto-debit)",
  date: new Date()
});
await transaction.save();
```

**Important:** If wallet balance < ₹100, driver **cannot go online**.

---

### 2. **Auto-Debit After Ignoring Warnings**

**When:** Driver ignores all 3 warnings and timer reaches 12 hours
**Amount:** ₹100 (default, configurable via `driver.workingHoursDeductionAmount`)
**Trigger:** Automatic (timer-based)
**Function:** `autoStopDriver()` in `workingHoursService.js`

**Code Location:** `services/workingHoursService.js` - Lines 270-327

```javascript
const deductionAmount = driver.workingHoursDeductionAmount || 100;

if (driver.wallet >= deductionAmount) {
  driver.wallet -= deductionAmount;
  driver.walletDeducted = true;

  // Create transaction
  const transaction = new Transaction({
    driver: driver._id,
    amount: deductionAmount,
    type: "debit",
    method: "extended_hours_auto_debit",
    description: "Extended working hours (auto-deducted after ignoring warnings)",
    date: new Date()
  });
  await transaction.save();

  // Add 12 more hours automatically
  driver.remainingWorkingSeconds = 12 * 60 * 60;
  driver.warningsIssued = 0;
  driver.extendedHoursPurchased = true;
}
```

**Result:** Driver gets 12 more hours automatically, wallet charged ₹100.

---

### 3. **Manual Extended Hours Purchase**

**When:** Driver clicks "Continue" on warning popup
**Amount:** ₹100 (default)
**Trigger:** `/api/drivers/working-hours/extend` endpoint
**Function:** `purchaseExtendedHours()` in `workingHoursService.js`

**Code Location:** `services/workingHoursService.js` - Lines 388-464

```javascript
const deductionAmount = driver.workingHoursDeductionAmount || 100;

// Deduct from wallet
driver.wallet -= deductionAmount;
driver.walletDeducted = true;
driver.extendedHoursPurchased = true;

// Create transaction
const transaction = new Transaction({
  driver: driver._id,
  amount: deductionAmount,
  type: "debit",
  method: "extended_hours_purchase",
  description: `Purchased ${additionalHours} hours of extended working time`,
  date: new Date()
});
await transaction.save();

// Add hours
driver.remainingWorkingSeconds += (additionalHours * 60 * 60);
driver.warningsIssued = 0; // Reset warnings
```

---

### 4. **Add Half Time (6 Hours)**

**When:** Driver requests to add half shift time
**Amount:** ₹50 (for 12h shift) or ₹100 (for 24h shift)
**Trigger:** `/api/drivers/working-hours/add-half-time` endpoint
**Function:** `addExtraTime()` in `workingHoursService.js`

**Code Location:** `app.js` - Lines 1183-1222

```javascript
const workingHoursLimit = driver.workingHoursLimit || 12;
let hours = 0, minutes = 0, seconds = 0, deductionAmount = 0;

if (workingHoursLimit === 12) {
  hours = 6; minutes = 0; seconds = 0;
  deductionAmount = 50; // ₹50 for 6 hours
} else if (workingHoursLimit === 24) {
  hours = 12; minutes = 0; seconds = 0;
  deductionAmount = 100; // ₹100 for 12 hours
}

const result = await workingHoursService.addExtraTime(
  driverId, hours, minutes, seconds, deductionAmount, 'half'
);
```

---

### 5. **Add Full Time (12 Hours)**

**When:** Driver requests to add full shift time
**Amount:** ₹100 (for 12h shift) or ₹200 (for 24h shift)
**Trigger:** `/api/drivers/working-hours/add-full-time` endpoint
**Function:** `addExtraTime()` in `workingHoursService.js`

**Code Location:** `app.js` - Lines 1224-1263

```javascript
const workingHoursLimit = driver.workingHoursLimit || 12;
let hours = 0, minutes = 0, seconds = 0, deductionAmount = 0;

if (workingHoursLimit === 12) {
  hours = 12; minutes = 0; seconds = 0;
  deductionAmount = 100; // ₹100 for 12 hours
} else if (workingHoursLimit === 24) {
  hours = 24; minutes = 0; seconds = 0;
  deductionAmount = 200; // ₹200 for 24 hours
}

const result = await workingHoursService.addExtraTime(
  driverId, hours, minutes, seconds, deductionAmount, 'full'
);
```

---

## Deduction Amounts

| Action | Amount (12h Shift) | Amount (24h Shift) | Configurable? |
|--------|-------------------|-------------------|---------------|
| **Shift Start (Go Online)** | ₹100 | ₹100 | ❌ Hardcoded in service |
| **Auto-Debit (Ignore Warnings)** | ₹100 | ₹100 | ✅ Via `driver.workingHoursDeductionAmount` |
| **Manual Extended Hours** | ₹100 | ₹100 | ✅ Via `driver.workingHoursDeductionAmount` |
| **Add Half Time** | ₹50 (6h) | ₹100 (12h) | ❌ Hardcoded in endpoint |
| **Add Full Time** | ₹100 (12h) | ₹200 (24h) | ❌ Hardcoded in endpoint |

**Default:** All drivers have `workingHoursDeductionAmount = 100` (set in schema)

---

## API Endpoints

### 1. Start Working Hours Timer (Go Online)

```http
POST /api/drivers/working-hours/start
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>

{
  "driverId": "DRV001"
}
```

**Response (Success):**
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

**Response (Insufficient Balance):**
```json
{
  "success": false,
  "message": "Insufficient wallet balance. Minimum ₹100 required to go online."
}
```

**Code Location:** `app.js` - Lines 997-1014

---

### 2. Stop Working Hours Timer (Go Offline)

```http
POST /api/drivers/working-hours/stop
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>

{
  "driverId": "DRV001"
}
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

**Important:** This **pauses** the timer but **does NOT deduct** wallet. Driver can resume later without paying again.

**Code Location:** `app.js` - Lines 1017-1043

---

### 3. Purchase Extended Hours

```http
POST /api/drivers/working-hours/extend
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>

{
  "driverId": "DRV001",
  "additionalHours": 12
}
```

**Response (Success):**
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

**Response (Insufficient Balance):**
```json
{
  "success": false,
  "message": "Insufficient balance. Required: ₹100, Available: ₹50"
}
```

**Code Location:** `app.js` - Lines 1046-1063

---

### 4. Add Half Time

```http
POST /api/drivers/working-hours/add-half-time
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>

{
  "driverId": "DRV001"
}
```

**Response (12h Shift - Adds 6 hours, Deducts ₹50):**
```json
{
  "success": true,
  "message": "Extra time added successfully.",
  "newRemainingSeconds": 64800,
  "walletBalance": 350,
  "amountDeducted": 50
}
```

**Code Location:** `app.js` - Lines 1183-1222

---

### 5. Add Full Time

```http
POST /api/drivers/working-hours/add-full-time
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>

{
  "driverId": "DRV001"
}
```

**Response (12h Shift - Adds 12 hours, Deducts ₹100):**
```json
{
  "success": true,
  "message": "Extra time added successfully.",
  "newRemainingSeconds": 86400,
  "walletBalance": 250,
  "amountDeducted": 100
}
```

**Code Location:** `app.js` - Lines 1224-1263

---

### 6. Get Timer Status

```http
GET /api/drivers/working-hours/status/:driverId
Authorization: Bearer <JWT_TOKEN>
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

**Code Location:** `app.js` - Lines 1090-1103

---

### 7. Pause Timer (Go Offline Temporarily)

```http
POST /api/drivers/working-hours/pause
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>

{
  "driverId": "DRV001"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Timer paused successfully",
  "remainingSeconds": 35000
}
```

**Important:** Timer is **paused**, NOT stopped. No wallet deduction.

**Code Location:** `app.js` - Lines 1106-1123

---

### 8. Resume Timer (Go Online Again)

```http
POST /api/drivers/working-hours/resume
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>

{
  "driverId": "DRV001"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Timer resumed successfully",
  "remainingSeconds": 35000
}
```

**Important:** Resumes existing session. **NO wallet deduction** because shift was already paid for.

**Code Location:** `app.js` - Lines 1126-1143

---

### 9. Admin Update Working Hours Limit

```http
PUT /api/admin/driver/:driverId/working-hours
Content-Type: application/json
Authorization: Bearer <ADMIN_JWT_TOKEN>

{
  "workingHoursLimit": 24
}
```

**Response:**
```json
{
  "success": true,
  "message": "Working hours limit updated",
  "workingHoursLimit": 24
}
```

**Allowed Values:** `12` or `24` hours only.

**Code Location:** `app.js` - Lines 1146-1180

---

## Implementation Flow

### Flow 1: Driver Goes Online (First Time Today)

```
1. Driver clicks "Go Online" button
2. App calls: POST /api/drivers/working-hours/start
3. Backend checks wallet balance >= ₹100
4. If YES:
   ├── Deduct ₹100 from wallet
   ├── Create Transaction record (type: "shift_start_fee")
   ├── Set remainingWorkingSeconds = 12 hours (43200s)
   ├── Start timer countdown (every 1 second)
   ├── Set driver.status = "Live"
   └── Return success with new wallet balance
5. If NO:
   └── Return error: "Insufficient wallet balance. Minimum ₹100 required"
```

---

### Flow 2: Driver Goes Offline (Temporarily)

```
1. Driver clicks "Go Offline" button
2. App calls: POST /api/drivers/working-hours/stop
3. Backend:
   ├── Stops the countdown timer
   ├── Saves current remainingWorkingSeconds to database
   ├── Set driver.status = "Offline"
   ├── Set timerActive = false
   └── NO WALLET DEDUCTION (driver can resume later)
4. Return success
```

---

### Flow 3: Driver Goes Online Again (Resume Session)

```
1. Driver clicks "Go Online" button again
2. App calls: POST /api/drivers/working-hours/start
3. Backend detects:
   ├── Driver already has remainingWorkingSeconds > 0
   ├── Driver was previously online (timerActive was true)
   └── This is a RESUME, not a new shift
4. Backend:
   ├── NO WALLET DEDUCTION (already paid)
   ├── Resume countdown from saved remainingWorkingSeconds
   ├── Set driver.status = "Live"
   └── Set timerActive = true
5. Return success with message: "Existing session resumed - no wallet deduction"
```

**Code:** `services/workingHoursService.js` - Lines 29-50

---

### Flow 4: Auto-Debit After Ignoring Warnings

```
1. Timer reaches 11 hours → Warning 1 sent (FCM + Socket)
2. Timer reaches 11.5 hours → Warning 2 sent
3. Timer reaches 11:50 hours → Warning 3 sent (Final)
4. Timer reaches 12 hours → Auto-debit triggered:
   ├── Check if driver ignored all warnings
   ├── Check wallet balance >= ₹100
   ├── If YES:
   │   ├── Deduct ₹100
   │   ├── Create Transaction (type: "extended_hours_auto_debit")
   │   ├── Add 12 more hours automatically
   │   ├── Reset warnings
   │   └── Send notification about deduction
   └── If NO:
       ├── Stop timer
       ├── Set driver status = "Offline"
       └── Send "Auto-Stop" notification
```

**Code:** `services/workingHoursService.js` - Lines 270-366

---

## Database Schema

### Driver Model

**File:** `models/driver/driver.js`

```javascript
{
  driverId: String,              // e.g., "DRV001"
  name: String,
  phone: String,
  vehicleType: String,           // "bike", "taxi", "port"
  wallet: Number,                // Current balance (₹)
  status: String,                // "Live", "Offline", "onRide"

  // Working Hours Fields
  workingHoursLimit: Number,     // 12 or 24 (admin configurable)
  workingHoursDeductionAmount: Number,  // Default: 100 (₹100)

  // Timer State
  timerActive: Boolean,          // Is timer currently running?
  remainingWorkingSeconds: Number, // Seconds left in shift
  onlineStartTime: Date,         // When driver went online

  // Warning Tracking
  warningsIssued: Number,        // 0, 1, 2, or 3
  lastWarningTime: Date,

  // Flags
  extendedHoursPurchased: Boolean,  // Did driver buy extension?
  walletDeducted: Boolean,       // Was wallet deducted for extension?
  autoStopScheduled: Boolean,    // Was driver auto-stopped?

  // Additional
  additionalWorkingHours: Number, // Extra hours purchased
  fcmToken: String               // For push notifications
}
```

**Default Values:**
- `workingHoursLimit`: `12` (hours)
- `workingHoursDeductionAmount`: `100` (₹)
- `timerActive`: `false`
- `remainingWorkingSeconds`: `0`

---

### Transaction Model

**File:** `models/driver/transaction.js`

```javascript
{
  driver: ObjectId,              // Reference to Driver._id
  amount: Number,                // Transaction amount (₹)
  type: String,                  // "debit" or "credit"
  method: String,                // Payment method / transaction type
  description: String,           // Transaction description
  date: Date                     // Transaction timestamp
}
```

**Transaction Types (method field):**
- `"shift_start_fee"` - ₹100 deducted when going online
- `"extended_hours_auto_debit"` - ₹100 auto-deducted after ignoring warnings
- `"extended_hours_purchase"` - ₹100 manually purchased extension
- `"extra_half_time"` - ₹50/₹100 for half time
- `"extra_full_time"` - ₹100/₹200 for full time
- `"ride_fare"` - Ride fare credit (from completed rides)

---

## Transaction Records

Every wallet deduction creates a **Transaction record** for audit trail.

### Example Transaction Records

**1. Shift Start Fee**
```javascript
{
  driver: ObjectId("675abc123def456789"),
  amount: 100,
  type: "debit",
  method: "shift_start_fee",
  description: "Online shift start fee (auto-debit)",
  date: ISODate("2026-01-07T05:30:00Z")
}
```

**2. Auto-Debit After Ignoring Warnings**
```javascript
{
  driver: ObjectId("675abc123def456789"),
  amount: 100,
  type: "debit",
  method: "extended_hours_auto_debit",
  description: "Extended working hours (auto-deducted after ignoring warnings)",
  date: ISODate("2026-01-07T17:30:00Z")
}
```

**3. Manual Extended Hours Purchase**
```javascript
{
  driver: ObjectId("675abc123def456789"),
  amount: 100,
  type: "debit",
  method: "extended_hours_purchase",
  description: "Purchased 12 hours of extended working time",
  date: ISODate("2026-01-07T17:00:00Z")
}
```

**4. Half Time Purchase**
```javascript
{
  driver: ObjectId("675abc123def456789"),
  amount: 50,
  type: "debit",
  method: "extra_half_time",
  description: "Extra half time added (6h 0m 0s)",
  date: ISODate("2026-01-07T18:00:00Z")
}
```

---

## Important Notes & Warnings

### ⚠️ CRITICAL WARNINGS

1. **DO NOT deduct wallet when driver resumes session**
   - Check if `driver.status === 'Live'` AND `driver.remainingWorkingSeconds > 0`
   - This indicates a RESUME, not a new shift
   - Only deduct on **NEW** shift start
   - **Code:** Lines 29-50 in `workingHoursService.js`

2. **Always create Transaction records**
   - Every wallet debit/credit MUST have a Transaction entry
   - Helps with audit trail and driver transaction history
   - If transaction creation fails, log error but **continue** (don't fail the operation)

3. **Check wallet balance BEFORE deduction**
   - Always validate `driver.wallet >= deductionAmount`
   - Return error if insufficient balance
   - Prevents negative wallet balances

4. **Timer must be stopped when driver goes offline**
   - Use `stopWorkingHoursTimer(driverId)` to clear interval
   - Save `remainingWorkingSeconds` to database
   - Set `timerActive = false`
   - **Important:** This is PAUSE, not END (no wallet deduction)

5. **Shift Start Fee is HARDCODED**
   - `START_SHIFT_CHARGE = 100` in `workingHoursService.js` Line 66
   - **NOT** configurable via database (unlike extended hours deduction)
   - To change: Must edit code directly

6. **Extended hours deduction IS configurable**
   - Uses `driver.workingHoursDeductionAmount` (default: 100)
   - Admin can update this per driver if needed
   - Used for: auto-debit, manual purchase, extended hours

7. **Half/Full time amounts are HARDCODED**
   - 12h shift: Half = ₹50 (6h), Full = ₹100 (12h)
   - 24h shift: Half = ₹100 (12h), Full = ₹200 (24h)
   - Defined in endpoints, NOT in service layer

---

### 🔍 Common Issues & Solutions

**Issue 1: Driver charged twice when going online**
- **Cause:** Timer already running in memory but status check failed
- **Solution:** Check `activeTimers.has(driverId)` before deduction (Line 54)

**Issue 2: Negative wallet balance**
- **Cause:** Missing balance check before deduction
- **Solution:** Always check `if (driver.wallet < deductionAmount)` first

**Issue 3: Timer continues after server restart**
- **Cause:** In-memory timers lost on restart
- **Solution:** Check `driver.timerActive` on startup and resume timers
- **Note:** Current implementation handles this in `startWorkingHoursTimer()` Lines 29-50

**Issue 4: Transaction records not created**
- **Cause:** Transaction creation wrapped in try-catch, errors silently logged
- **Solution:** Check console logs for transaction creation errors
- **Location:** Look for `⚠️ Failed to create transaction record` in logs

**Issue 5: Auto-debit not triggering**
- **Cause:** Timer interval not running (server restart, memory cleared)
- **Solution:** Ensure `workingHoursService.init(io)` is called on server start
- **Location:** `server.js` Lines 54-55

---

## Testing & Debugging

### Test Endpoints

#### 1. Check Driver Wallet Balance
```http
GET /api/admin/drivers
Authorization: Bearer <ADMIN_JWT_TOKEN>
```

Look for `wallet` field in driver data.

---

#### 2. Manually Add Money to Driver Wallet (Admin)
```http
POST /api/admin/direct-wallet/:driverId
Content-Type: application/json
Authorization: Bearer <ADMIN_JWT_TOKEN>

{
  "amount": 500,
  "type": "credit",
  "method": "admin_credit",
  "description": "Added funds for testing"
}
```

**Code Location:** `app.js` - Lines 100-185

---

#### 3. Check Timer Status
```http
GET /api/drivers/working-hours/status/:driverId
Authorization: Bearer <JWT_TOKEN>
```

Returns current timer state, warnings, wallet balance.

---

### Debug Logs

Enable debug logging by checking console output:

**Shift Start:**
```
⏱️ Starting working hours timer for driver: DRV001
💰 Deducted ₹100 from driver DRV001. New Balance: 400
📝 Transaction created for shift start deduction: -₹100
✅ Timer initialized: 12 hours (43200 seconds) for driver DRV001
```

**Auto-Debit:**
```
🛑 AUTO-STOP: Time expired for driver: DRV001
💰 Deducted ₹100 from driver DRV001 wallet (ignored all warnings)
📝 Transaction created for auto-deduction: -₹100
✅ Driver DRV001 extended for 12 more hours after wallet deduction
```

**Resume Session (No Deduction):**
```
⚠️ Driver DRV001 is already ONLINE with active timer. Resuming existing session.
✅ Resumed timer for driver DRV001 (remaining: 35000s)
```

---

### Testing Checklist

- [ ] Driver with ₹500 can go online → ₹100 deducted
- [ ] Driver with ₹50 cannot go online → Error message shown
- [ ] Transaction record created on shift start
- [ ] Driver goes offline → Timer pauses, NO deduction
- [ ] Driver goes online again → Timer resumes, NO deduction
- [ ] Timer reaches 11 hours → Warning 1 sent
- [ ] Timer reaches 11.5 hours → Warning 2 sent
- [ ] Timer reaches 11:50 hours → Warning 3 sent
- [ ] Timer reaches 12 hours → Auto-debit ₹100, add 12 hours
- [ ] Driver purchases extension manually → ₹100 deducted
- [ ] Add half time (12h shift) → ₹50 deducted, 6h added
- [ ] Add full time (12h shift) → ₹100 deducted, 12h added
- [ ] Check transaction history → All debits recorded

---

## Summary

| Event | Endpoint | Amount | When |
|-------|----------|--------|------|
| **Go Online (New Shift)** | `/api/drivers/working-hours/start` | **₹100** | First time today |
| **Go Online (Resume)** | `/api/drivers/working-hours/start` | **₹0** | Resuming paused session |
| **Go Offline** | `/api/drivers/working-hours/stop` | **₹0** | Timer paused |
| **Auto-Debit (Ignored Warnings)** | Automatic | **₹100** | After 12 hours |
| **Manual Extension** | `/api/drivers/working-hours/extend` | **₹100** | Clicked "Continue" on warning |
| **Add Half Time (12h)** | `/api/drivers/working-hours/add-half-time` | **₹50** | Requested 6h extension |
| **Add Half Time (24h)** | `/api/drivers/working-hours/add-half-time` | **₹100** | Requested 12h extension |
| **Add Full Time (12h)** | `/api/drivers/working-hours/add-full-time` | **₹100** | Requested 12h extension |
| **Add Full Time (24h)** | `/api/drivers/working-hours/add-full-time` | **₹200** | Requested 24h extension |

---

## File References

**Main Implementation:**
- `services/workingHoursService.js` - Core wallet deduction logic
- `app.js` - All working hours API endpoints (Lines 994-1323)
- `models/driver/driver.js` - Driver schema with wallet fields
- `models/driver/transaction.js` - Transaction record schema

**Initialization:**
- `server.js` Lines 54-55 - Initialize working hours service with Socket.IO

---

**Last Updated:** 2026-01-07
**Status:** Production-Ready Documentation
