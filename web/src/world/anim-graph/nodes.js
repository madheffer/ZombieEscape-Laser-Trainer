// Every node class the runtime knows, by CS2's compiled class name (CNm<name>::CDefinition without the decoration).
import { UnknownNode } from './nodes-base.js';
import { VALUE_NODES } from './nodes-value.js';
import { MASK_NODES } from './nodes-mask.js';
import { POSE_NODES } from './nodes-pose.js';
import { SM_NODES } from './nodes-sm.js';
import { CS_NODES } from './nodes-cs.js';

export const NODE_TYPES = { ...VALUE_NODES, ...MASK_NODES, ...POSE_NODES, ...SM_NODES, ...CS_NODES, Unknown: UnknownNode };
