// STANDARD COMMAND TEMPLATES FOR UBUNTU/DEBIAN
const COMMANDS = {
  // SYSTEM STATS
  CHECK_OS: 'cat /etc/os-release | grep PRETTY_NAME | cut -d "=" -f 2 | tr -d \'"\'',
  GET_UPTIME: "uptime -p",
  // CPU: Run top twice widely spaced (0.5s) to get a delta. Parse User($2) + Sys($4).
  // Note: This relies on standard 'top' output. 
  // Fallback/Alternative: grep 'cpu ' /proc/stat (requires 2 samples, handled better in script but this is a one-liner)
  GET_CPU_USAGE: "top -bn2 -d 0.5 | grep 'Cpu(s)' | tail -1 | awk '{print $2 + $4}'",
  // RAM: Calculate used percentage properly
  GET_RAM_USAGE: "free -m | awk 'NR==2{printf \"%.2f\", $3*100/$2 }'",
  GET_DISK_USAGE: "df -h / | tail -1 | awk '{print $5}'",
  GET_KERNEL: "uname -sr",
  GET_IP: "hostname -I | awk '{print $1}'",
  GET_DISK_IO: "vmstat 1 2 | tail -1 | awk '{print $9 \" \" $10}'",


  // SERVICES
  CHECK_DOCKER: "systemctl is-active docker",
  CHECK_NGINX: "systemctl is-active nginx",
  CHECK_NODE: "node -v",
  CHECK_PM2: "pm2 -v",

  // SECURITY
  CHECK_UFW: "sudo ufw status | grep 'Status'",
  LIST_PORTS: "sudo lsof -i -P -n | grep LISTEN",

  // FILESYSTEM
  // Force date format to YYYY-MM-DD_HH:MM for reliable regex
  list_dir_cmd: (path) => {
    const raw = String(path ?? '').trim();
    const safe = raw.length ? raw : '.';
    const escaped = safe.replace(/"/g, '\\"');
    return `ls -lA --time-style=+%Y-%m-%d_%H:%M --group-directories-first "${escaped}"`;
  },
  pwd_cmd: "pwd",
  delete_cmd: (path) => `rm -rf "${path}"`,
  rename_cmd: (oldPath, newPath) => `mv "${oldPath}" "${newPath}"`,

  // COMPRESS / EXTRACT (using tar which is always available)
  // Compress a file or folder to .tar.gz
  zip_cmd: (targetPath, outputPath) => {
    // Change outputPath from .zip to .tar.gz if needed
    const tarPath = outputPath.replace(/\.zip$/, '.tar.gz');
    return `mkdir -p "$(dirname "${tarPath}")" && tar -czvf "${tarPath}" -C "$(dirname "${targetPath}")" "$(basename "${targetPath}")"`;
  },

  // Smart Extract: 
  // - If archive has single root folder only → extract directly
  // - If archive has multiple items or loose files → create folder named after archive
  unzip_cmd: (archivePath, destDir) => {
    // Get archive name without extension for wrapper folder
    const archiveName = archivePath.split('/').pop()
      .replace(/\.(tar\.gz|tgz|zip|tar|gz|rar|7z)$/i, '');

    if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
      // For tar.gz: Check if single root folder exists
      // List top-level items, count unique root directories/files
      return `
mkdir -p "${destDir}" && 
ITEMS=$(tar -tzf "${archivePath}" | cut -d'/' -f1 | sort -u) &&
COUNT=$(echo "$ITEMS" | wc -l) &&
FIRST=$(echo "$ITEMS" | head -1) &&
if [ "$COUNT" -eq 1 ] && tar -tzf "${archivePath}" | grep -q "^$FIRST/"; then
  tar -xzvf "${archivePath}" -C "${destDir}"
else
  mkdir -p "${destDir}/${archiveName}" && tar -xzvf "${archivePath}" -C "${destDir}/${archiveName}"
fi
`.replace(/\n/g, ' ');
    } else if (archivePath.endsWith('.zip')) {
      // For zip: Check structure then extract appropriately
      return `
mkdir -p "${destDir}" &&
if command -v unzip &> /dev/null; then
  ITEMS=$(unzip -l "${archivePath}" | awk 'NR>3 {print $4}' | grep -v '^$' | cut -d'/' -f1 | sort -u | head -20) &&
  COUNT=$(echo "$ITEMS" | wc -l) &&
  FIRST=$(echo "$ITEMS" | head -1) &&
  if [ "$COUNT" -eq 1 ] && unzip -l "${archivePath}" | awk 'NR>3 {print $4}' | grep -q "^$FIRST/"; then
    unzip -o "${archivePath}" -d "${destDir}"
  else
    mkdir -p "${destDir}/${archiveName}" && unzip -o "${archivePath}" -d "${destDir}/${archiveName}"
  fi
elif command -v python3 &> /dev/null; then
  python3 -c "
import zipfile, os
with zipfile.ZipFile('${archivePath}') as zf:
    items = set(n.split('/')[0] for n in zf.namelist() if n)
    if len(items) == 1 and any('/' in n for n in zf.namelist()):
        zf.extractall('${destDir}')
    else:
        os.makedirs('${destDir}/${archiveName}', exist_ok=True)
        zf.extractall('${destDir}/${archiveName}')
"
else
  echo "Cannot extract: no unzip or python3 available"
fi
`.replace(/\n/g, ' ');
    } else {
      // Try tar for other compressed formats
      return `mkdir -p "${destDir}/${archiveName}" && tar -xf "${archivePath}" -C "${destDir}/${archiveName}"`;
    }
  },
};

module.exports = { COMMANDS };
