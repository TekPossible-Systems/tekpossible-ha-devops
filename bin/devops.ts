#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';

// TekPossible DevOps Stack Imports
import { DevopsStack } from '../lib/devops-stack';

// TekPossible DevOps Config Imports
import config from '../config/config.json';

const app = new cdk.App();
console.log("\nDeploying DevOps Stack with the following config:\n");
console.log(config);
new DevopsStack(app, 'TekPossible-Stratagem-Devops', config, {});