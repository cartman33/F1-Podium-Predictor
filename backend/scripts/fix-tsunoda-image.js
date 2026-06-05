require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

pool
    .query("UPDATE Drivers SET imageUrl = '/drivers/yuki_tsunoda.png' WHERE familyName = 'Tsunoda'")
    .then(([result]) => {
        console.log(`Updated ${result.affectedRows} row(s) for Tsunoda.`);
        process.exit(0);
    })
    .catch((err) => {
        console.error(err.message);
        process.exit(1);
    });
