import re

with open('apps/desktop/index.html', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# Find the monitoring section and add global exposure at the end
# Look for a good place to add the global exposure - after monitoringPause function definition

# Pattern to find the end of monitoring functions
pattern = r"(window\.monitoringPause = monitoringPause;)"

replacement = r"\1\n\n            // EXPOSE MONITORING FUNCTIONS GLOBALLY\n            window.ensureMonitoringDOM = ensureMonitoringDOM;\n            window.loadMonitoring = loadMonitoring;\n            window.stopMonitoring = stopMonitoring;\n            window.fetchMonitoringData = fetchMonitoringData;\n            window.renderMonitoringUI = renderMonitoringUI;"

content_new = re.sub(pattern, replacement, content)

if content_new != content:
    with open('apps/desktop/index.html', 'w', encoding='utf-8') as f:
        f.write(content_new)
    print("Fixed: Monitoring functions now exposed globally")
else:
    # Try alternative pattern
    alt_pattern = r"(function monitoringPause\(\) \{)"
    alt_replacement = r"window.monitoringPause = monitoringPause;\n            \1"
    content_new = re.sub(alt_pattern, alt_replacement, content)
    if content_new != content:
        # Add global exposure after monitoringPause function
        end_pattern = r"(window\.monitoringPause = monitoringPause;)"
        end_replacement = r"\1\n\n            // EXPOSE MONITORING FUNCTIONS GLOBALLY\n            window.ensureMonitoringDOM = ensureMonitoringDOM;\n            window.loadMonitoring = loadMonitoring;\n            window.stopMonitoring = stopMonitoring;\n            window.fetchMonitoringData = fetchMonitoringData;\n            window.renderMonitoringUI = renderMonitoringUI;"
        content_new = re.sub(end_pattern, end_replacement, content_new)
        with open('apps/desktop/index.html', 'w', encoding='utf-8') as f:
            f.write(content_new)
        print("Fixed: Monitoring functions now exposed globally (alternative method)")
    else:
        print("Pattern not found - checking if already fixed")
        if 'window.ensureMonitoringDOM' in content:
            print("Already fixed - functions already exposed globally")
        else:
            print("WARNING: Could not find insertion point")
