# Debug: Account Activation Balance Bug

## User Report
- User has balance: 5000 KSH (existing funds)
- User pays: 1000 KSH (activation fee)
- **BUG**: Balance shows **1000 KSH** (not 6000 KSH)
- Other funds disappear and reappear later

## Hypothesis Testing

### Scenario 1: Null stakeable_balance in DB
**If stakeable_balance is NULL in database for existing users:**
```
profile endpoint returns:
stakeableBalance: parseFloat(user.stakeable_balance) || parseFloat(user.account_balance) || 0
                = parseFloat(null) || parseFloat(1000) 
                = NaN || 1000 
                = 1000 ✗ (BUG!)
```

**Problem**: If stakeable_balance is NULL, the fallback uses account_balance which was just set to 1000 by...

Actually wait. Let me trace the ACTIVATION payment flow step by step:

### Current Activation Payment Flow

**User State Before Activation:**
- account_balance = 5000
- stakeable_balance = 5000  
- withdrawable_balance = 0

**Step 1: User initiates activation payment (1000)**
- `/api/payments/daraja/initiate` called with paymentType='activation'
- No balance change yet
- Transaction record created with status='pending'

**Step 2: M-Pesa prompt, user confirms**

**Step 3: Daraja callback received**
- Callback handler calls `ensureUserDarajaFunding` with:
  - amount: 1000
  - paymentType: 'activation'

**Step 4: ensureUserDarajaFunding processes**
```javascript
previousBalance = 5000
prevStakeable = 5000
creditedAmount = 1000
newStakeable = 5000 + 1000 = 6000
newBalance = 6000 + 0 = 6000

update: {
  account_balance: 6000,
  stakeable_balance: 6000,
  withdrawal_activated: true
}
```

**Expected User State After:**
- account_balance = 6000
- stakeable_balance = 6000
- withdrawable_balance = 0
- withdrawal_activated = true

**Reported Bug: User State After Activation**
- Balance shows = 1000 (???)
- Funds disappear, reappear later

## Possible Root Causes

### Root Cause A: Frontend calculation error
**Location**: Finance.tsx line 284
```typescript
const newBalance = (statusData.funding?.newBalance !== undefined)
  ? Number(statusData.funding.newBalance)
  : balance + TEST_ACTIVATION_FEE;
```

**Possibility**: If `balance` variable is undefined or 0 at polling time, then:
```
newBalance = 0 + 1000 = 1000
```

### Root Cause B: Backend returning wrong newBalance
**Location**: userDarajaFundingService.js return value
```javascript
return {
  success: true,
  newBalance,
  ...
}
```

**Possibility**: If `newBalance` calculation is wrong somewhere.

### Root Cause C: Race condition with balance sync
**Sequence**:
1. Activation payment succeeds
2. Daraja callback updates DB: account_balance = 6000, stakeable_balance = 6000
3. Frontend polling also triggers balance sync
4. They race and one overwrites the other

### Root Cause D: stakeable_balance is NULL
**If user never had stakeable_balance set** (legacy data issue):
```javascript
// In /api/auth/profile/:phone endpoint
stakeableBalance: parseFloat(user.stakeable_balance) || parseFloat(user.account_balance) || 0
```

When activation sets account_balance to 6000 but stakeable_balance remains NULL:
```
stakeableBalance = parseFloat(null) || parseFloat(6000) = 6000  // This should work
```

BUT what if during activation, account_balance is set to 1000 temporarily?

## Investigation Needed

1. **Check if backend is setting account_balance = 1000** (instead of 6000)
   - Read: activation fee approval endpoint in admin.routes.js
   - Read: Daraja callback handler logic

2. **Check frontend balance state during polling**
   - What is the `balance` variable when calculating newBalance?
   - Is it from useBets context or stale?

3. **Check if stakeable_balance is being cleared**
   - When withdrawal is activated, does something clear stakeable_balance?
   - Does the database have NULL values for stakeable_balance?

4. **Check for race conditions**
   - Multiple balance updates happening simultaneously?
   - Frontend cache vs backend disagreement?

## Next Steps
1. [ ] Check admin approval endpoint (is it adding fee correctly?)
2. [ ] Check Daraja callback handler (is it calculating balance correctly?)
3. [ ] Check Finance.tsx polling logic (what is the `balance` variable?)
4. [ ] Check for database migration issues (NULL stakeable_balance)
5. [ ] Test with a real user activation to see actual database values
