// The guest workload/protocol stays byte-identical; only the host experiment changes.
export {Protocol,prefix,parameters,orders,warmupOrders,names,expected,gatePlan} from '../m2-sustained-v2/protocol.mjs';
export {protocol as guestProtocol} from '../m2-sustained-v2/protocol.mjs';
export const protocol='defuss-passive-fifo-finite-v1';
