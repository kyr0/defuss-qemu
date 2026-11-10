declare var bunWasm: {
  /** Signal COM1, wait for capture/restore, then return the launch mode. */
  snapshotReady(): 'cold' | 'restored' | 'disabled';
};
