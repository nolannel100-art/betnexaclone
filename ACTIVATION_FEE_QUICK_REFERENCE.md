# Activation Fee Approval - Quick Reference

## Main Endpoint

**File:** `server/routes/admin.routes.js` (Line 3731-3815)

```javascript
PUT /api/admin/activation-fees/:feeId/mark-completed
```

## Code Snippets

### 1. Balance Update (ADD Operation)
```javascript
// From admin.routes.js line 3768-3769
const newBalance = (parseFloat(user.account_balance) || 0) + parseFloat(fee.amount);
const userUpdate = { account_balance: newBalance };
```
✅ **Result:** Balance INCREASES by fee amount

### 2. Withdrawal Activation
```javascript
// From admin.routes.js line 3775-3778
if (fee.fee_type === 'activation') {
  userUpdate.withdrawal_activated = true;
  userUpdate.withdrawal_activation_date = new Date().toISOString();
}
```
✅ **Result:** `withdrawal_activated` set to `true`

### 3. Apply Updates to Database
```javascript
// From admin.routes.js line 3780-3784
const { error: balanceError } = await supabase
  .from('users')
  .update(userUpdate)
  .eq('id', fee.user_id);
```

### 4. Fee Creation (Payment Routes)
```javascript
// From payment.routes.js line 418-431
await supabase
  .from('activation_fees')
  .insert({
    user_id: userId,
    fee_type: resolvedType,        // 'activation' or 'priority'
    amount: numAmount,              // Fee amount
    phone_number: phoneNumber,
    external_reference: externalReference,
    status: 'pending',              // Initial status
    method: 'M-Pesa STK Push',
    description: `Withdrawal activation fee - KSH ${TEST_ACTIVATION_FEE}`,
    created_at: new Date().toISOString()
  });
```

### 5. Direct Activation (No Fee)
```javascript
// From admin.routes.js line 2850-2870
PUT /api/admin/users/:userId/activate-withdrawal

await supabase
  .from('users')
  .update({
    withdrawal_activated: true,
    withdrawal_activation_date: new Date().toISOString()
  })
  .eq('id', userId);
```
✅ **Result:** No balance change, just sets flag

---

## Fee Status Transitions

```
pending ──[mark-completed]──> completed ──[balance + amount]──> ✅
         ──[mark-rejected]──> rejected ──[no change]──> ❌
         ──[mark-pending]──> pending
```

---

## Related Endpoints

| Endpoint | File | Line |
|----------|------|------|
| Mark Completed | admin.routes.js | 3731 |
| Mark Rejected | admin.routes.js | 3816 |
| Mark Pending | admin.routes.js | 3851 |
| Activate Withdrawal (Direct) | admin.routes.js | 2850 |
| Deactivate Withdrawal | admin.routes.js | 2896 |

---

## Database Updates When Fee Approved

| Table | Column | Old Value | New Value |
|-------|--------|-----------|-----------|
| `activation_fees` | `status` | `pending` | `completed` |
| `users` | `account_balance` | `5000` | `6000` (example: +1000) |
| `users` | `withdrawal_activated` | `false` | `true` |
| `users` | `withdrawal_activation_date` | `null` | Current timestamp |

---

## Fee Configuration

**Location:** `.env.example` line 87
```
WITHDRAWAL_ACTIVATION_FEE=1000  # Changed to 10 KSH per session notes
```

**Also defined in:**
- `server/routes/payment.routes.js` line 22: `TEST_ACTIVATION_FEE = 1000` → `10`
- `src/pages/Finance.tsx` line 19: `TEST_ACTIVATION_FEE = 1000` → `10`

---

## Critical Implementation Details

### ✅ Balance is ADDED (not SET)
```javascript
newBalance = currentBalance + feeAmount  // ADD operation
```

### ✅ Withdrawal flag is SET (not toggled)
```javascript
withdrawal_activated = true  // Always true when activation fee type
```

### ✅ SMS Notification includes new balance
```javascript
sendActivationSms(phone, username, feeAmount, newBalance)
```

---

## Testing the Flow

1. User pays activation fee → creates `activation_fees` record with `status='pending'`
2. Admin calls `PUT /api/admin/activation-fees/{feeId}/mark-completed`
3. Verify:
   - `activation_fees.status` = `'completed'`
   - `users.account_balance` increased by fee amount
   - `users.withdrawal_activated` = `true`
   - SMS sent with new balance

---

## Comparison: Fee Approval vs Direct Activation

| Aspect | Fee Approval | Direct Activation |
|--------|--------------|-------------------|
| Balance Change | ✅ +amount | ❌ No change |
| Withdrawal Flag | ✅ Set to true | ✅ Set to true |
| SMS Sent | ✅ With balance | ❌ No SMS or minimal |
| Admin Route | PUT .../mark-completed | PUT .../activate-withdrawal |
| Use Case | User paid fee | Admin gifts activation |
