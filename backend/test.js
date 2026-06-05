const axios = require('axios');
async function test() {
  const ergastData = await axios.get('https://api.jolpi.ca/ergast/f1/current/drivers.json');
  const ergastDrivers = ergastData.data.MRData.DriverTable.Drivers;
  for (const eDriver of ergastDrivers) {
    const normalizedLastName = eDriver.familyName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    try {
      let fallbackRes = { data: [] };
      if (eDriver.permanentNumber) {
        fallbackRes = await axios.get(`https://api.openf1.org/v1/drivers?driver_number=${eDriver.permanentNumber}`);
      }
      if (!fallbackRes.data || fallbackRes.data.length === 0) {
        fallbackRes = await axios.get(`https://api.openf1.org/v1/drivers?last_name=${normalizedLastName}`);
      }
      if (fallbackRes.data && fallbackRes.data.length > 0) {
        const last = fallbackRes.data[fallbackRes.data.length - 1];
        if (last.headshot_url) {
          try {
            await axios.head(last.headshot_url);
          } catch (e) {
            console.log('FAILED:', eDriver.familyName, last.headshot_url, e.message);
          }
        } else {
            console.log('NO IMAGE:', eDriver.familyName);
        }
      } else {
         console.log('NO DATA:', eDriver.familyName);
      }
    } catch (e) {
      console.log('OPENF1 GET FAILED:', eDriver.familyName, e.message);
    }
  }
}
test();