# API Testing Examples - Driver Working Hours & Wallet System

**Quick Reference for Testing Backend APIs**
**Date**: 2025-12-31

---

## Base URL
```
http://localhost:5001
```

---

## 1. Start Working Hours Timer (Go ONLINE)

### Request
```bash
curl -X POST http://localhost:5001/api/drivers/working-hours/start \
  -H "Content-Type: application/json" \
  -d '{"driverId": "dri10001"}'
```

### Success Response (First Time - Wallet Deducted)
```json
{
  "success": true,
  "message": "Working hours timer started successfully",
  "totalHours": 12,
  "remainingSeconds": 43200,
  "walletBalance": 1250,
  "amountDeducted": 100,
  "alreadyOnline": false
}
```

### Success Response (Already Online - No Deduction)
```json
{
  "success": true,
  "message": "Existing session resumed - no wallet deduction",
  "totalHours": 12,
  "remainingSeconds": 35420,
  "walletBalance": 1250,
  "amountDeducted": 0,
  "alreadyOnline": true
}
```

### Error Response (Insufficient Balance)
```json
{
  "success": false,
  "message": "Insufficient wallet balance. Minimum ₹100 required to go online."
}
```

---

## 2. Stop Working Hours Timer (Go OFFLINE)

### Request
```bash
curl -X POST http://localhost:5001/api/drivers/working-hours/stop \
  -H "Content-Type: application/json" \
  -d '{"driverId": "dri10001"}'
```

### Success Response
```json
{
  "success": true,
  "message": "Working hours timer stopped successfully",
  "walletBalance": 1250
}
```

---

## 3. Get Timer Status

### Request
```bash
curl http://localhost:5001/api/drivers/working-hours-status/dri10001
```

### Success Response (Timer Active)
```json
{
  "success": true,
  "driverId": "dri10001",
  "timerActive": true,
  "remainingSeconds": 35420,
  "formattedTime": "09:50:20",
  "hours": 9,
  "minutes": 50,
  "seconds": 20,
  "workingHoursLimit": 12,
  "warningsIssued": 0,
  "walletBalance": 1250
}
```

### Success Response (Timer Not Active)
```json
{
  "success": true,
  "driverId": "dri10001",
  "timerActive": false,
  "remainingSeconds": 0,
  "formattedTime": "00:00:00",
  "hours": 0,
  "minutes": 0,
  "seconds": 0,
  "workingHoursLimit": 12,
  "warningsIssued": 0,
  "walletBalance": 1250
}
```

---

## 4. Add Extra Half Time

### Request
```bash
curl -X POST http://localhost:5001/api/drivers/working-hours/add-half-time \
  -H "Content-Type: application/json" \
  -d '{"driverId": "dri10001"}'
```

### Success Response (12-hour Shift)
```json
{
  "success": true,
  "message": "Extra time added successfully.",
  "newRemainingSeconds": 57019,
  "walletBalance": 1200,
  "amountDeducted": 50
}
```

**Time Added**: 05:59:59 (5 hours, 59 minutes, 59 seconds)

### Success Response (24-hour Shift)
```json
{
  "success": true,
  "message": "Extra time added successfully.",
  "newRemainingSeconds": 78619,
  "walletBalance": 1200,
  "amountDeducted": 50
}
```

**Time Added**: 11:59:59 (11 hours, 59 minutes, 59 seconds)

### Error Response (Insufficient Balance)
```json
{
  "success": false,
  "message": "Insufficient wallet balance. Required: ₹50, Available: ₹30"
}
```

---

## 5. Add Extra Full Time

### Request
```bash
curl -X POST http://localhost:5001/api/drivers/working-hours/add-full-time \
  -H "Content-Type: application/json" \
  -d '{"driverId": "dri10001"}'
```

### Success Response (12-hour Shift)
```json
{
  "success": true,
  "message": "Extra time added successfully.",
  "newRemainingSeconds": 78619,
  "walletBalance": 1150,
  "amountDeducted": 100
}
```

**Time Added**: 11:59:59 (11 hours, 59 minutes, 59 seconds)

### Success Response (24-hour Shift)
```json
{
  "success": true,
  "message": "Extra time added successfully.",
  "newRemainingSeconds": 121819,
  "walletBalance": 1150,
  "amountDeducted": 100
}
```

**Time Added**: 23:59:59 (23 hours, 59 minutes, 59 seconds)

---

## 6. Refresh Driver Data

### Request
```bash
curl http://localhost:5001/api/drivers/refresh/dri10001
```

### Success Response
```json
{
  "success": true,
  "driver": {
    "driverId": "dri10001",
    "name": "John Doe",
    "phone": "9876543210",
    "vehicleType": "TAXI",
    "vehicleNumber": "KA01AB1234",
    "wallet": 1250,
    "status": "Live",
    "location": {
      "type": "Point",
      "coordinates": [77.5946, 12.9716]
    },
    "fcmToken": "firebase_token_here",
    "workingHoursLimit": 12,
    "remainingWorkingSeconds": 35420,
    "timerActive": true,
    "autoStopEnabled": false
  }
}
```

---

## 7. Get Wallet History (Paginated)

### Request (Page 1)
```bash
curl http://localhost:5001/api/drivers/wallet/history/dri10001?page=1&limit=10
```

### Request (Page 2)
```bash
curl http://localhost:5001/api/drivers/wallet/history/dri10001?page=2&limit=10
```

### Success Response
```json
{
  "success": true,
  "currentBalance": 1250,
  "transactions": [
    {
      "id": "67744abc123456",
      "amount": 100,
      "type": "debit",
      "method": "shift_start_fee",
      "description": "Online charge - Shift started",
      "date": "2025-12-31T10:30:00.000Z",
      "displayText": "Online Charge"
    },
    {
      "id": "67744abc123457",
      "amount": 50,
      "type": "debit",
      "method": "extra_half_time",
      "description": "Extra half time added (5h 59m 59s)",
      "date": "2025-12-31T08:15:00.000Z",
      "displayText": "Extra Half Time"
    },
    {
      "id": "67744abc123458",
      "amount": 500,
      "type": "credit",
      "method": "admin_credit",
      "description": "Wallet credited by admin",
      "date": "2025-12-30T14:20:00.000Z",
      "displayText": "Wallet Add (Admin)"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalTransactions": 47,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

---

## 8. Enable Auto-Stop

### Request
```bash
curl -X POST http://localhost:5001/api/drivers/working-hours/enable-auto-stop \
  -H "Content-Type: application/json" \
  -d '{"driverId": "dri10001"}'
```

### Success Response
```json
{
  "success": true,
  "message": "Auto-stop enabled. Extra time buttons are now disabled.",
  "autoStopEnabled": true
}
```

---

## 9. Admin - Update Driver Wallet

### Request (Add Money)
```bash
curl -X POST http://localhost:5001/api/admin/direct-wallet/dri10001 \
  -H "Content-Type: application/json" \
  -d '{"amount": 500}'
```

### Request (Deduct Money)
```bash
curl -X POST http://localhost:5001/api/admin/direct-wallet/dri10001 \
  -H "Content-Type: application/json" \
  -d '{"amount": -200}'
```

### Success Response (Credit)
```json
{
  "success": true,
  "message": "Wallet updated successfully",
  "data": {
    "driverId": "dri10001",
    "name": "John Doe",
    "addedAmount": 500,
    "wallet": 1750,
    "previousWallet": 1250
  }
}
```

### Success Response (Debit)
```json
{
  "success": true,
  "message": "Wallet updated successfully",
  "data": {
    "driverId": "dri10001",
    "name": "John Doe",
    "addedAmount": -200,
    "wallet": 1050,
    "previousWallet": 1250
  }
}
```

---

## Testing Scenarios

### Scenario 1: Driver Goes Online for First Time

**Step 1**: Check wallet balance
```bash
curl http://localhost:5001/api/drivers/refresh/dri10001
```
Expected: `wallet: 1350`

**Step 2**: Start timer
```bash
curl -X POST http://localhost:5001/api/drivers/working-hours/start \
  -d '{"driverId": "dri10001"}'
```
Expected: `walletBalance: 1250`, `amountDeducted: 100`, `alreadyOnline: false`

**Step 3**: Verify wallet deducted
```bash
curl http://localhost:5001/api/drivers/refresh/dri10001
```
Expected: `wallet: 1250`

**Step 4**: Check transaction history
```bash
curl http://localhost:5001/api/drivers/wallet/history/dri10001?page=1&limit=10
```
Expected: Latest transaction shows `shift_start_fee` debit of ₹100

---

### Scenario 2: Driver Logs Out and Logs Back In (Timer Still Running)

**Step 1**: Start timer
```bash
curl -X POST http://localhost:5001/api/drivers/working-hours/start \
  -d '{"driverId": "dri10001"}'
```
Expected: `walletBalance: 1250`, `amountDeducted: 100`, `alreadyOnline: false`

**Step 2**: Check status
```bash
curl http://localhost:5001/api/drivers/working-hours-status/dri10001
```
Expected: `timerActive: true`, `remainingSeconds: ~43200`

**Step 3**: Try starting timer again (simulating re-login)
```bash
curl -X POST http://localhost:5001/api/drivers/working-hours/start \
  -d '{"driverId": "dri10001"}'
```
Expected: `alreadyOnline: true`, `amountDeducted: 0`, `walletBalance: 1250` (unchanged)

**Step 4**: Verify no new transaction created
```bash
curl http://localhost:5001/api/drivers/wallet/history/dri10001?page=1&limit=10
```
Expected: Only ONE `shift_start_fee` transaction (not two)

---

### Scenario 3: Driver Adds Extra Half Time

**Step 1**: Start timer
```bash
curl -X POST http://localhost:5001/api/drivers/working-hours/start \
  -d '{"driverId": "dri10001"}'
```

**Step 2**: Wait for timer to count down (or manually set remainingSeconds to 3600 in DB)

**Step 3**: Add extra half time
```bash
curl -X POST http://localhost:5001/api/drivers/working-hours/add-half-time \
  -d '{"driverId": "dri10001"}'
```
Expected (12h shift): `amountDeducted: 50`, `newRemainingSeconds: 25199` (3600 + 21599)

**Step 4**: Verify wallet deducted
```bash
curl http://localhost:5001/api/drivers/refresh/dri10001
```
Expected: `wallet: 1200` (1250 - 50)

**Step 5**: Check transaction
```bash
curl http://localhost:5001/api/drivers/wallet/history/dri10001?page=1&limit=10
```
Expected: Latest transaction shows `extra_half_time` debit of ₹50

---

### Scenario 4: Driver Enables Auto-Stop

**Step 1**: Enable auto-stop
```bash
curl -X POST http://localhost:5001/api/drivers/working-hours/enable-auto-stop \
  -d '{"driverId": "dri10001"}'
```
Expected: `autoStopEnabled: true`

**Step 2**: Verify status
```bash
curl http://localhost:5001/api/drivers/refresh/dri10001
```
Expected: `autoStopEnabled: true`

**Step 3**: Try adding extra time (should still work backend-wise, app should disable button)
```bash
curl -X POST http://localhost:5001/api/drivers/working-hours/add-half-time \
  -d '{"driverId": "dri10001"}'
```
Expected: Still works (driver app responsible for disabling buttons in UI)

---

### Scenario 5: Admin Adds Money to Wallet

**Step 1**: Check current balance
```bash
curl http://localhost:5001/api/drivers/refresh/dri10001
```
Expected: `wallet: 1250`

**Step 2**: Admin adds ₹500
```bash
curl -X POST http://localhost:5001/api/admin/direct-wallet/dri10001 \
  -d '{"amount": 500}'
```
Expected: `wallet: 1750`, `addedAmount: 500`

**Step 3**: Verify balance updated
```bash
curl http://localhost:5001/api/drivers/refresh/dri10001
```
Expected: `wallet: 1750`

**Step 4**: Check transaction
```bash
curl http://localhost:5001/api/drivers/wallet/history/dri10001?page=1&limit=10
```
Expected: Latest transaction shows `admin_credit` credit of ₹500

---

## Postman Collection

Import this JSON into Postman for quick testing:

```json
{
  "info": {
    "name": "Driver Working Hours API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Start Timer",
      "request": {
        "method": "POST",
        "url": "http://localhost:5001/api/drivers/working-hours/start",
        "body": {
          "mode": "raw",
          "raw": "{\"driverId\": \"dri10001\"}",
          "options": {
            "raw": {
              "language": "json"
            }
          }
        }
      }
    },
    {
      "name": "Stop Timer",
      "request": {
        "method": "POST",
        "url": "http://localhost:5001/api/drivers/working-hours/stop",
        "body": {
          "mode": "raw",
          "raw": "{\"driverId\": \"dri10001\"}",
          "options": {
            "raw": {
              "language": "json"
            }
          }
        }
      }
    },
    {
      "name": "Get Timer Status",
      "request": {
        "method": "GET",
        "url": "http://localhost:5001/api/drivers/working-hours-status/dri10001"
      }
    },
    {
      "name": "Add Half Time",
      "request": {
        "method": "POST",
        "url": "http://localhost:5001/api/drivers/working-hours/add-half-time",
        "body": {
          "mode": "raw",
          "raw": "{\"driverId\": \"dri10001\"}",
          "options": {
            "raw": {
              "language": "json"
            }
          }
        }
      }
    },
    {
      "name": "Add Full Time",
      "request": {
        "method": "POST",
        "url": "http://localhost:5001/api/drivers/working-hours/add-full-time",
        "body": {
          "mode": "raw",
          "raw": "{\"driverId\": \"dri10001\"}",
          "options": {
            "raw": {
              "language": "json"
            }
          }
        }
      }
    },
    {
      "name": "Refresh Driver",
      "request": {
        "method": "GET",
        "url": "http://localhost:5001/api/drivers/refresh/dri10001"
      }
    },
    {
      "name": "Wallet History",
      "request": {
        "method": "GET",
        "url": "http://localhost:5001/api/drivers/wallet/history/dri10001?page=1&limit=10"
      }
    },
    {
      "name": "Enable Auto-Stop",
      "request": {
        "method": "POST",
        "url": "http://localhost:5001/api/drivers/working-hours/enable-auto-stop",
        "body": {
          "mode": "raw",
          "raw": "{\"driverId\": \"dri10001\"}",
          "options": {
            "raw": {
              "language": "json"
            }
          }
        }
      }
    },
    {
      "name": "Admin Add Wallet",
      "request": {
        "method": "POST",
        "url": "http://localhost:5001/api/admin/direct-wallet/dri10001",
        "body": {
          "mode": "raw",
          "raw": "{\"amount\": 500}",
          "options": {
            "raw": {
              "language": "json"
            }
          }
        }
      }
    }
  ]
}
```

---

## Expected Console Output (Backend)

### When Driver Goes Online (First Time)
```
💰 Checking wallet balance for driver dri10001: 1350
💰 Deducted ₹100 from driver dri10001. New Balance: 1250
📝 Transaction created: Online charge - Shift started
⏱️ Working hours timer started for driver dri10001
✅ Timer started: Total hours: 12, Remaining: 43200s
```

### When Driver Already Online (Re-login)
```
⚠️ Driver dri10001 is already ONLINE with active timer. Resuming existing session.
✅ Resumed timer for driver dri10001 (remaining: 35420s)
```

### When Adding Extra Half Time
```
⏱️ Adding extra half time for 12h shift: 5:59:59
💰 Deducted ₹50 from driver dri10001. New Balance: 1200
📝 Transaction created: Extra half time added (5h 59m 59s)
✅ Extra time added: +21599s. New remaining: 57019s
```

---

**Document**: API Testing Examples
**Version**: 1.0
**Date**: 2025-12-31
