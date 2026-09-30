import dotenv from 'dotenv';
import {spawnSync} from 'node:child_process';
dotenv.config({path:'.env.local',quiet:true});
if(!process.env.ConnectionStrings__Taxi)throw Error('Configure the existing local PostgreSQL connection first');
const result=spawnSync('dotnet',['test','backend/DispatchPro.Tests','--no-restore','--filter','FullyQualifiedName~CustomerAppTests|FullyQualifiedName~DriverAppTests|FullyQualifiedName~RideHailingTests|FullyQualifiedName~ReceptionTests|FullyQualifiedName~UnifiedReceptionTests','-p:UseAppHost=false','-p:OutputPath=bin/CustomerJourney/','--logger','console;verbosity=minimal'],{env:{...process.env,TAXI_TEST_POSTGRES:process.env.ConnectionStrings__Taxi.replace(/Database=[^;]+/i,'Database=postgres')},stdio:'inherit',windowsHide:true});
if(result.error)console.error(result.error.message);
process.exit(result.status??1);
