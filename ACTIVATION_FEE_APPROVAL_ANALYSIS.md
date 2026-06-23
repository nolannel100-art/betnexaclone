# Activation Fee Approval - Complete Code Analysis

## Overview
This document details how activation fees are approved and how user balances are updated when activation fees are completed.

---

## 1. PRIMARY ENDPOINT: Mark Activation Fee as Completed

**Location:** [server/routes/admin.routes.js](server/routes/admin.routes.js#L3731-L3815)  
**HTTP Method:** `PUT`  
**Route:** `/api/admin/activation-fees/:feeId/mark-completed`  
**Auth Required:** `checkAdmin` (admin only)

### Key Code Flow:

```javascript
router.put('/activation-fees/:feeId/mark-completed', checkAdmin, async (req, res) => {
  // STEP 1: Fetch the activation fee record
  const { data: fee, error: fetchError } = await supabase
    .from('activation_fees')
    .select('*')
    .eq('id', feeId)
    .single();

  // STEP 2: Update fee status to 'completed'
  const { error: updateError } = await supabase
    .from('activation_fees')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', feeId);

  // STEP 3: Credit the fee amount to user's account balance (ADD operation)
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('account_balance, phone_number, username')
    .eq('id', fee.user_id)
    .single();

  const newBalance = (parseFloat(user.account_balance) || 0) + parseFloat(fee.amount);
  const userUpdate = { account_balance: newBalance };

  // STEP 4: Activate user's withdrawal capability
  if (fee.fee_type === 'activation') {
    userUpdate.withdrawal_activated = true;
    userUpdate.withdrawal_activation_date = new Date().toISOString();
    console.log(`🔓 Activating withdrawal for user ${fee.user_id}`);
  }

  // STEP 5: Apply user balance and activation updates
  const { error: balanceError } = await supabase
    .from('users')
    .update(userUpdate)
    .eq('id', fee.user_id);

  // STEP 6: Send SMS notification
  if (fee.fee_type === 'activation' && user.phone_number) {
    sendActivationSms(user.phone_number, user.username || 'User', 
                      parseFloat(fee.amount) || 0, newBalance);
  }
});
```

### Balance Update Pattern (Key):
- **Operation Type:** `ADD` (not SET)
- **Formula:** `newBalance = user.account_balance + fee.amount`
- **Example:** User balance: 5000 → Fee: 1000 → New Balance: 6000

### What Gets Updated:
1. ✅ `activation_fees.status` → `'completed'`
2. ✅ `users.account_balance` → `account_balance + fee.amount`
3. ✅ `users.withdrawal_activated` → `true`
4. ✅ `users.withdrawal_activation_date` → Current timestamp

---

## 2. ACTIVATION FEE CREATION

**Location:** [server/routes/payment.routes.js](server/routes/payment.routes.js#L413-L460)  
**When:** During payment initiation for activation or priority fees

```javascript
if (resolvedType === 'activation' || resolvedType === 'priority') {
  console.log(`📝 Creating ${resolvedType} fee record in activation_fees table...`);
  const { error: feeError } = await supabase
    .from('activation_fees')
    .insert({
      user_id: userId,
      fee_type: resolvedType,                    // 'activation' or 'priority'
      amount: numAmount,                         // Fee amount in KSH
      phone_number: phoneNumber,
      external_reference: externalReference,
      checkout_request_id: checkoutRequestId,
      status: 'pending',                         // Initial status
      related_withdrawal_id: relatedWithdrawalId || null,
      method: 'M-Pesa STK Push',
      description: resolvedType === 'activation'
        ? `Withdrawal activation fee - KSH ${TEST_ACTIVATION_FEE}`
        : `Priority withdrawal fee - KSH ${TEST_PRIORITY_FEE}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
}
```

### Activation Fee Fields:
- `user_id` - User paying the fee
- `fee_type` - Either `'activation'` or `'priority'`
- `amount` - Fee amount (currently 10 KSH for activation, 5 KSH for priority)
- `status` - Initially `'pending'`, then `'completed'` or `'rejected'`
- `external_reference` - M-Pesa transaction reference
- `checkout_request_id` - STK Push request ID
- `related_withdrawal_id` - Optional withdrawal ID if fee related to a withdrawal request

---

## 3. DIRECT WITHDRAWAL ACTIVATION (No Fee)

**Location:** [server/routes/admin.routes.js](server/routes/admin.routes.js#L2850-L2895)  
**HTTP Method:** `PUT`  
**Route:** `/api/admin/users/:userId/activate-withdrawal`  
**Auth Required:** `checkAdmin` (admin only)

```javascript
router.put('/users/:userId/activate-withdrawal', checkAdmin, async (req, res) => {
  // Mark user as withdrawal activated - NO FEE. NO DEDUCTIONS.
  const { data: updatedUser, error: userUpdateError } = await supabase
    .from('users')
    .update({
      withdrawal_activated: true,
      withdrawal_activation_date: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', userId)
    .select();
});
```

### Key Difference:
- **No balance deduction** - Just sets the flag
- **No SMS notification with balance**
- Direct admin action to enable withdrawals

---

## 4. FEE STATUS LIFECYCLE

### Normal Flow for Activation Fee Approval:

```
pending → completed
  ↓
  fee.amount ADDED to user balance
  withdrawal_activated = true
  SMS sent with new balance
```

### Rejection Flow:

**Location:** [server/routes/admin.routes.js](server/routes/admin.routes.js#L3816)  
**Route:** `/api/admin/activation-fees/:feeId/mark-rejected`

```javascript
router.put('/activation-fees/:feeId/mark-rejected', checkAdmin, async (req, res) => {
  // Updates fee status to 'rejected'
  // NO balance change
  // NO withdrawal activation
});
```

---

## 5. BALANCE UPDATE PATTERNS COMPARISON

### ✅ Activation Fee Approved (ADD Pattern):
```javascript
// CORRECT: This adds the fee amount to the balance
const newBalance = (parseFloat(user.account_balance) || 0) + parseFloat(fee.amount);
// Balance: 5000 + 1000 = 6000
```
- **File:** [server/routes/admin.routes.js](server/routes/admin.routes.js#L3768)
- **Operation:** `account_balance = account_balance + fee.amount`

### ⚠️ PHP Callback Fee (Different Pattern):
```php
// KES 400 Activation Fee - SPECIAL CASE
if ($floatAmount !== 400.00) {
    $updateUserSql = "UPDATE users SET account_balance = account_balance + ? WHERE id = ?";
} else {
    error_log("INFO: KES 400 Activation Fee processed for user $userId. 
              Account activated but balance NOT credited.");
}
```
- **File:** [lipa/callback.php](lipa/callback.php#L74-L97)
- **Note:** KES 400 activation fee does NOT add to balance in PHP handler
- **Status:** Sets `is_withdrawal_activated = 1` without balance credit

### ✅ Deposit Processing (ADD Pattern):
```php
$updateUserSql = "UPDATE users SET account_balance = account_balance + ? WHERE id = ?";
// Balance: 5000 + 5000 = 5500
```
- **File:** [lipa/callback.php](lipa/callback.php#L86)

---

## 6. WITHDRAWAL ACTIVATION REQUIREMENTS

### Settings/Configuration:

**Location:** `.env.example`
```
WITHDRAWAL_ACTIVATION_FEE=1000  # Amount in KSH (currently set to 10)
```

**Database Column:** `users.withdrawal_activated` (BOOLEAN)

### Activation Methods:
1. **Via Fee Payment:** User pays activation fee → Admin approves → Balance credited + withdrawal enabled
2. **Via Admin Direct:** Admin endpoint `/api/admin/users/:userId/activate-withdrawal` → No fee

---

## 7. KEY FINDINGS - Balance Update Behavior

| Scenario | Operation | Result |
|----------|-----------|--------|
| Activation Fee Approved | `balance + amount` | Balance increases by fee amount |
| Deposit Completed | `balance + amount` | Balance increases by deposit amount |
| Withdrawal Processed | `balance - amount` | Balance decreases by withdrawal amount |
| Admin Direct Activation | No change | Balance stays same, only flag set |
| Fee Rejected | No change | Balance stays same, fee marked rejected |

---

## 8. RELATED ENDPOINTS

### Mark Fee as Rejected:
- **Route:** `PUT /api/admin/activation-fees/:feeId/mark-rejected`
- **File:** [server/routes/admin.routes.js](server/routes/admin.routes.js#L3816)

### Mark Fee as Pending:
- **Route:** `PUT /api/admin/activation-fees/:feeId/mark-pending`
- **File:** [server/routes/admin.routes.js](server/routes/admin.routes.js#L3851)

### Deactivate Withdrawal:
- **Route:** `PUT /api/admin/users/:userId/deactivate-withdrawal`
- **File:** [server/routes/admin.routes.js](server/routes/admin.routes.js#L2896)

---

## 9. CRITICAL ISSUE: Balance Update Logic

### The Balance Update Implementation:
```javascript
// Line 3768-3769 in admin.routes.js
const newBalance = (parseFloat(user.account_balance) || 0) + parseFloat(fee.amount);
const userUpdate = { account_balance: newBalance };
```

✅ **Correct:** This is an ADD operation (balance increases)

### Potential Issues to Watch:
1. The balance is fetched once, then updated once - no locking/transactions
2. If multiple approvals happen simultaneously, race condition possible
3. The newBalance is calculated locally, not using SQL operations

---

## 10. SMS NOTIFICATION

**Function:** `sendActivationSms()`  
**Triggered:** When activation fee is approved and `fee_type === 'activation'`

```javascript
sendActivationSms(user.phone_number, user.username || 'User', 
                  parseFloat(fee.amount) || 0, newBalance)
```

**Information Sent:**
- User phone number
- Username
- Fee amount
- New account balance

---

## Summary

**Main Endpoint:** `PUT /api/admin/activation-fees/:feeId/mark-completed`

**Balance Update Type:** ✅ **ADD** (not SET)
- User balance INCREASES by fee amount
- Formula: `newBalance = currentBalance + feeAmount`

**Withdrawal Activation:** ✅ Sets `withdrawal_activated = true`

**Status:** ✅ Fee status updated from `pending` to `completed`
