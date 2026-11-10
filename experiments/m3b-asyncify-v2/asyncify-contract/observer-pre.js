// DEFUSS_M3B_ASYNC_OBSERVER_V1. Standalone fixture glue only, never QEMU glue.
var m3bContractEvents = [];
var m3bContractAddress = null;
var m3bContractBusy = false;
function m3bContractBank() {
  if (!Number.isSafeInteger(m3bContractAddress) || m3bContractAddress % 4 ||
      m3bContractAddress < 0 || m3bContractAddress + 128 > HEAPU32.byteLength) {
    throw Error('Contract bank not armed or out of bounds');
  }
  return Array.from(HEAPU32.subarray(m3bContractAddress / 4, m3bContractAddress / 4 + 32));
}
function m3bContractTransition(event, actualCall) {
  if (m3bContractBusy || m3bContractEvents.length >= 32) {
    throw Error('Contract transition nesting/overflow');
  }
  m3bContractBusy = true;
  try {
    var before = Module['m3bRawState']();
    var bank = m3bContractBank();
    var result = actualCall();
    var after = Module['m3bRawState']();
    // The callback/function is not retained. Only bounded scalar copies remain.
    m3bContractEvents.push({ event: event, before: before, after: after,
      jsState: Asyncify.state, bank: bank, bankAfter: m3bContractBank() });
    return result;
  } finally { m3bContractBusy = false; }
}
Module['m3bObserverArm'] = function (address) {
  if (m3bContractAddress !== null || m3bContractEvents.length ||
      Module['m3bRawState']() !== 0 || Asyncify.state !== Asyncify.State.Normal) {
    throw Error('Contract observer must be armed exactly once while Normal');
  }
  m3bContractAddress = Number(address);
  return m3bContractBank();
};
Module['m3bObserverRead'] = function () {
  return { events: m3bContractEvents.map(function (e) { return {
    event: e.event, before: e.before, after: e.after, jsState: e.jsState,
    bank: e.bank.slice(), bankAfter: e.bankAfter.slice()
  }; }), nativeState: Module['m3bRawState'](), jsState: Asyncify.state,
    bank: m3bContractBank() };
};
