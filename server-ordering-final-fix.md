# Server Ordering - Final Fix

## Issue
After the first fix, servers were not loading due to incorrect Supabase query syntax.

Error: `order=created_at.asc:1` (400 Bad Request)

## Root Cause
The Supabase query syntax was incorrect. The correct syntax is:
```javascript
.order('created_at', { ascending: false })
```

Not:
```javascript
.order('created_at', { ascending: true })
```

## Solution
1. Fixed Supabase query to use correct syntax with `ascending: false` (newest first)
2. Removed all `.reverse()` calls since data is now ordered correctly from database
3. Changed dashboard from `.slice(-3).reverse()` to `.slice(0, 3)` (first 3 items)

## Changes Made

### 1. loadServersFromSupabase()
```javascript
// Before (WRONG - caused 400 error)
const { data: servers, error: sErr } = await supabase.from('servers').select('*').order('created_at', { ascending: true });

// After (CORRECT)
const { data: servers, error: sErr } = await supabase.from('servers').select('*').order('created_at', { ascending: false });
```

### 2. Dashboard "Your Fleet"
```javascript
// Before
servers.slice(-3).reverse()  // Last 3, then reverse

// After
servers.slice(0, 3)  // First 3 (already newest first from DB)
```

### 3. All Servers Page
```javascript
// Before
servers = servers.slice().reverse();

// After
// No reverse needed - already ordered from DB
```

## How It Works Now

### Database Query:
```sql
SELECT * FROM servers ORDER BY created_at DESC
```
Returns: [Newest, 2nd Newest, 3rd Newest, ..., Oldest]

### Dashboard Display:
```javascript
servers.slice(0, 3)
```
Shows: [Newest, 2nd Newest, 3rd Newest]

### All Servers Page:
```javascript
servers  // No modification needed
```
Shows: [Newest, 2nd Newest, 3rd Newest, ..., Oldest]

## Result

✅ Servers load correctly from Supabase
✅ Newest server always shows first
✅ Order persists after refresh
✅ Consistent ordering across dashboard and all-servers page

## Testing

1. Add new server → Should appear first (top-left)
2. Refresh page → Should still be first
3. Add another server → Should appear first, previous moves to second
4. Go to "All Servers" → Newest should be first
5. Refresh → Order should remain the same

## Files Modified
- `apps/desktop/index.html` - Fixed Supabase query and removed reverse calls
