# Server Ordering Fix

## Issue
Servers were not showing in the correct order (newest first).

## Solution
Updated both dashboard and "All Servers" page to show most recently added servers first.

## Changes Made

### 1. Dashboard "Your Fleet" Section
**Already correct:** Uses `.slice(-3).reverse()`
- Takes last 3 servers (most recent)
- Reverses them to show newest first
- Result: 1st = newest, 2nd = second newest, 3rd = third newest

### 2. All Servers Page
**Fixed:** Added `.slice().reverse()`
```javascript
'all-servers': () => {
    let servers = userServers.filter(s => s.host !== '104.23.11.89');
    // Reverse to show newest first
    servers = servers.slice().reverse();
    
    return `...`
}
```

## Result

### Dashboard "Your Fleet":
```
┌─────────────┬─────────────┐
│  Newest     │  2nd Newest │
│  Server     │  Server     │
└─────────────┴─────────────┘
┌─────────────┬─────────────┐
│  3rd Newest │  Add New /  │
│  Server     │  View All   │
└─────────────┴─────────────┘
```

### All Servers Page:
```
┌──────┬──────┬──────┬──────┐
│  1st │  2nd │  3rd │  4th │
│ New  │ New  │ New  │ New  │
└──────┴──────┴──────┴──────┘
┌──────┬──────┬──────┬──────┐
│  5th │  6th │  7th │  8th │
│ New  │ New  │ New  │ New  │
└──────┴──────┴──────┴──────┘
```

## Testing
1. Add a new server
2. Check dashboard - should appear in top-left position
3. Add another server
4. Check dashboard - new one in top-left, previous one moves to top-right
5. Go to "All Servers" page
6. Newest server should be first (top-left)

## Files Modified
- `apps/desktop/index.html` - Added `.slice().reverse()` to all-servers page
