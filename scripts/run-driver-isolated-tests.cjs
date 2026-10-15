const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const dotenv=require('dotenv');
const output=path.resolve(process.argv[2]||'artifacts/driver-ux-qa-20261012');
fs.mkdirSync(output,{recursive:true});
let connection=process.env.TAXI_TEST_POSTGRES;
if(!connection&&process.argv.includes('--local-config')){
 let settings={};for(const file of ['.env','.env.local'])if(fs.existsSync(file))Object.assign(settings,dotenv.parse(fs.readFileSync(file)));
 connection=settings.ConnectionStrings__Taxi;
 if(connection)connection=connection.replace(/(^|;)\s*Database\s*=\s*[^;]*/i,'$1Database=postgres');
}
if(!connection)throw Error('Set a local TAXI_TEST_POSTGRES admin connection with Database=postgres, or explicitly pass --local-config.');
const host=/(?:^|;)\s*Host\s*=\s*([^;]+)/i.exec(connection)?.[1].trim();
const database=/(?:^|;)\s*Database\s*=\s*([^;]+)/i.exec(connection)?.[1].trim();
if(!['localhost','127.0.0.1','::1'].includes(host)||database!=='postgres')throw Error('Refusing non-local or operational database configuration.');
// The selected test creates a fresh random database and drops ONLY that database.
// All HTTP requests run through TestServer, with fake SMS and disabled FCM.
const filter=process.argv.includes('--destination-policy')?'FullyQualifiedName~DriverFreshRideCaptureTests|FullyQualifiedName~DestinationEnforcementTests':'FullyQualifiedName~DriverFreshRideCaptureTests';
const args=['test','backend/DispatchPro.Tests/DispatchPro.Tests.csproj','--artifacts-path',path.join(output,'dotnet'),'--filter',filter,'--logger','trx;LogFileName=driver-isolated.trx','--results-directory',path.join(output,'dotnet-results')];
const child=spawn('dotnet',args,{windowsHide:true,env:{...process.env,TAXI_TEST_POSTGRES:connection,CustomerPush__Enabled:'false',CustomerPush__ProjectId:'',DRIVER_CAPTURE_PATH:path.join(output,'isolated-journey.json'),DRIVER_CAPTURE_CUSTOMER_APP:'false',DRIVER_CAPTURE_FARE_MODE:'OFFICE_MANUAL',DISPATCHPRO_KEEP_TEST_DATABASES:'false'},stdio:['ignore','pipe','pipe']});
const log=fs.createWriteStream(path.join(output,'backend-isolated.log'));
child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
child.on('error',()=>{log.end();console.error('Unable to start isolated test runner');process.exitCode=1;});
child.on('exit',code=>{log.end();console.log('Isolated driver backend test exit:',code);process.exitCode=code||0;});
