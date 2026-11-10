#!/usr/bin/env node
import {runGuest} from './guest-runner.mjs';
await runGuest({diagnostic:true,entrypoint:import.meta.url});
