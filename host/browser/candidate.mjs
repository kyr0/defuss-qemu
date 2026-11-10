/** Select MSG1 before vCPU translation, preserving the candidate's locked ABI. */
export function configureCandidate(module, enabled = true) {
  if (typeof enabled !== 'boolean') throw new TypeError('msg1 must be a boolean');
  if (typeof module._defuss_m2_msg1_config !== 'function') return null;
  const selected = enabled ? 0x10002 : 0x10001;
  const before = module._defuss_m2_msg1_status();
  if (before === selected) return selected;
  if (before !== 0x10000 || module._defuss_m2_msg1_config(Number(enabled)) !== 0 ||
      module._defuss_m2_msg1_status() !== selected) {
    throw new Error('MSG1 selection must happen before translation and cannot be changed');
  }
  return selected;
}
