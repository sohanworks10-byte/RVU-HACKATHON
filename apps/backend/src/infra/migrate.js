import fs from 'fs';
import path from 'path';

import { query } from './db.js';

export async function runSqlFile(sqlFilePath) {
  const abs = path.resolve(sqlFilePath);
  const sql = fs.readFileSync(abs, 'utf8');
  await query(sql);
}

if (process.argv[1] && process.argv[1].includes('migrate.js')) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node ./src/infra/migrate.js <sql-file>');
    process.exit(1);
  }

  runSqlFile(file)
    .then(() => {
      console.log('Migration applied');
      process.exit(0);
    })
    .catch((e) => {
      console.error('Migration failed', e);
      process.exit(1);
    });
}
