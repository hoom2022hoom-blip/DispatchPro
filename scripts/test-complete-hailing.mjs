import dotenv from 'dotenv';
import {spawnSync} from 'node:child_process';
dotenv.config({path:'.env.local',quiet:true});
if(!process.env.ConnectionStrings__Taxi)throw Error('Local PostgreSQL configuration is required');
const result=spawnSync('dotnet',['test','backend/DispatchPro.Tests','--no-restore','--filter',process.argv[2]||'FullyQualifiedName~CompleteHailingStageTests','-p:UseAppHost=false','-p:OutputPath=bin/CompleteHailing/','--logger','console;verbosity=minimal','--logger','trx;LogFileName=complete-hailing.trx'],{env:{...process.env,TAXI_TEST_POSTGRES:process.env.ConnectionStrings__Taxi.replace(/Database=[^;]+/i,'Database=postgres')},stdio:'inherit',windowsHide:true});
if(result.error)console.error(result.error.message);process.exit(result.status??1);
