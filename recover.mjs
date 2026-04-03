import { initDb, dbRun, dbAll } from './server/db/init.js';
initDb();
dbRun("UPDATE users SET role = 'admin' WHERE id = 1");
console.log('Restored: ', dbAll('SELECT * FROM users'));
process.exit(0);
