// Fail before starting any children if local QA configuration is incomplete.
const fs=require('node:fs'),assert=require('node:assert/strict'),tls=require('node:tls');
module.exports=function(config){
 assert.equal(config.tenant,'driver-qa');
 assert.ok(config.tenantId,'Initialized QA tenant required');
 assert.match(config.database,/^dispatchpro_driverqa_[a-z0-9_]+$/);
 assert.match(config.role,/^driverqa_[a-f0-9]{8}$/);
 if(!config.tlsPort)return;
 assert.equal(config.publicOrigin,'https://localhost:9443');
 assert.equal(config.tlsPort,9443);
 assert.equal(config.apiPort,9027);assert.equal(config.webPort,9025);assert.equal(config.gatewayPort,9028);
 const options={key:fs.readFileSync(config.tlsKey),cert:fs.readFileSync(config.tlsCert),minVersion:'TLSv1.2'};
 tls.createSecureContext(options); // Includes matching certificate/key verification.
 return options;
};
