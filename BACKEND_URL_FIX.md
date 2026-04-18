# Backend URL Fix - Web Mode

## Problem
The monitoring iframe was showing `backendUrl: ''` (empty string) in the config, causing:
- 404 errors when trying to call `/api/rpc`
- "No server connected" errors
- Mock data being displayed instead of real server stats

## Root Cause
In `apps/desktop/web-shim.js`, the `backend:get-base-url` handler was returning:
```javascript
return { success: true, url };  // Wrong property name!
```

But `apps/desktop/index.html` expected:
```javascript
if (base && base.success && base.baseUrl) {  // Looking for 'baseUrl'
    window.__ALPHAOPS_BACKEND_URL = String(base.baseUrl);
}
```

## Solution
Fixed the property name mismatch in `web-shim.js`:

```javascript
// Backend URL - stored in localStorage
if (channel === 'backend:get-base-url') {
    try {
        let url = localStorage.getItem('AlphaOpsBackendUrl');
        // If not set, use default production backend
        if (!url) {
            url = 'https://AlphaOps-global-20260203.onrender.com';
            localStorage.setItem('AlphaOpsBackendUrl', url);
        }
        return { success: true, baseUrl: url };  // ✅ Fixed: 'url' → 'baseUrl'
    } catch (e) {
        return { success: false, error: e.message };
    }
}
```

## Changes Made
1. Changed return property from `url` to `baseUrl`
2. Added default backend URL if not set in localStorage
3. Auto-saves default URL to localStorage for future use

## Testing
After this fix:
1. `window.__ALPHAOPS_BACKEND_URL` should be set correctly
2. Monitoring iframe should receive proper config with `backendUrl` populated
3. Agent commands should execute through the backend API
4. Real server stats should display instead of mock data

## Verification
Check browser console for:
```javascript
{
  type: 'AlphaOps-monitoring-config',
  backendUrl: 'https://AlphaOps-global-20260203.onrender.com',  // ✅ Should be populated
  token: 'eyJ...',
  serverId: '1776508066522'
}
```

## Related Files
- `apps/desktop/web-shim.js` - Fixed handler
- `apps/desktop/index.html` - Consumer of backend URL
- `apps/desktop/test_script.js` - Monitoring config sender
- `apps/desktop/monitoring-modern.html` - Monitoring iframe receiver
