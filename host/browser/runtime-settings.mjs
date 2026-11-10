// Resolve once before boot. UI previews, the worker and trace metadata use the
// same effective values, including settings overridden by Diagnostic mode.
export function resolveRuntimeSettings({compatibility='default',hotLimit=1500}={}) {
  if(!['default','conservative'].includes(compatibility))throw Error('Unknown runtime profile');
  if(![256,1500].includes(hotLimit))throw Error('Unsupported JIT threshold');
  const performance=compatibility==='default';
  return Object.freeze({compatibility,requestedHotLimit:hotLimit,
    effectiveHotLimit:performance?hotLimit:65535,
    pressureAdmission:performance,repBatching:performance});
}

export function runtimeFlags(settings,profiling=false) {
  return (settings.pressureAdmission?1:0)|(settings.repBatching?2:0)|(profiling?4:0);
}

export function runtimeSummary(settings) {
  const threshold=settings.effectiveHotLimit.toLocaleString('en-US');
  return (settings.compatibility==='conservative'?'Diagnostic · delayed JIT: ':'Standard: ')+
    'JIT after '+threshold+' executions · 16/32-bit REP batching '+(settings.repBatching?'on':'off')+
    ' · pressure admission '+(settings.pressureAdmission?'on':'off');
}
