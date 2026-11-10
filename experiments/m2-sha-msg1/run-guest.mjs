#!/usr/bin/env node
import {runGuest} from './guest-runner.mjs';
await runGuest({diagnostic:false,entrypoint:import.meta.url});
