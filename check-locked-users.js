const https = require('https');

const options = {
  hostname: 's4hana2020.support.com',
  port: 8009,
  path: '/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/UserLockSet?sap-client=800&$format=json',
  method: 'GET',
  auth: 'best:Welcome123',
  rejectUnauthorized: false,
  headers: { 'Accept': 'application/json' }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const parsed = JSON.parse(data);
    const users = parsed.d.results;

    console.log('Total Users:', users.length);

    const lockedUsers = users.filter(u => u.LockStatus === 'Locked');
    console.log('');
    console.log('=== LOCKED USERS ===');
    console.log('Count:', lockedUsers.length);
    lockedUsers.forEach(u => {
      console.log(`- ${u.Username} (${u.UserType})`);
    });
  });
});

req.on('error', (e) => { console.error('ERROR:', e.message); });
req.end();