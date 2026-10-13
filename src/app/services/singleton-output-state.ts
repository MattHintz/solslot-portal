/** Reconstruct a confirmed child, never mistake the spent input for current state. */
export interface OutputProgram {
  uncurry(): { program: OutputProgram; args: OutputProgram[] } | undefined;
  curry(args: OutputProgram[]): OutputProgram;
  toList(): OutputProgram[] | undefined;
  toAtom(): Uint8Array;
  toInt(): bigint;
  treeHash(): Uint8Array;
  serialize(): Uint8Array;
}

export interface OutputClvm { deserialize(bytes: Uint8Array): OutputProgram; }

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** The caller must obtain both coins from one confirmed singleton lineage. */
export function reconstructSingletonOutput(
  clvm: OutputClvm, reveal: Uint8Array, solution: Uint8Array,
  parentPuzzleHash: Uint8Array, currentPuzzleHash: Uint8Array,
  kind: 'registry' | 'vault', expectedInnerModuleHash: Uint8Array,
): Uint8Array {
  const full = clvm.deserialize(reveal);
  if (!equal(full.treeHash(), parentPuzzleHash)) throw new Error('Parent puzzle reveal does not match chain evidence.');
  const outer = full.uncurry();
  if (!outer || outer.args.length !== 2) throw new Error('Malformed singleton wrapper.');
  const inner = outer.args[1].uncurry();
  if (!inner || !equal(inner.program.treeHash(), expectedInnerModuleHash)) {
    throw new Error('Unsupported singleton module; update the verified client before continuing.');
  }
  const outerSolution = clvm.deserialize(solution).toList();
  const spend = outerSolution?.length === 3 ? outerSolution[2].toList() : undefined;
  if (!spend) throw new Error('Malformed singleton solution.');
  const args = [...inner.args];
  if (kind === 'registry') {
    if (args.length !== 8 || spend.length !== 6) throw new Error('Malformed registry transition.');
    const action = spend[0].toInt();
    if (action !== 1n && action !== 2n) throw new Error('Unknown registry transition.');
    if (spend[5].toInt() !== args[7].toInt() + 1n) throw new Error('Invalid registry version transition.');
    if (spend[3].toAtom().length !== 32 || spend[4].toAtom().length !== 32) throw new Error('Invalid registry descriptor.');
    if (action === 1n && !equal(spend[3].toAtom(), args[5].toAtom())) throw new Error('Invalid legacy parameter transition.');
    args[5] = spend[3]; args[6] = spend[4]; args[7] = spend[5];
  } else {
    if (args.length !== 9 || spend.length !== 5) throw new Error('Malformed vault transition.');
    const action = spend[3].toAtom();
    const parameters = spend[4].toList();
    if (action.length !== 1 || !parameters) throw new Error('Malformed vault action.');
    switch (action[0]) {
      case 107: // k: rotate keys, auth curve and member root
        if (parameters.length !== 7) throw new Error('Malformed key rotation.');
        args[1] = parameters[1]; args[2] = parameters[2]; args[3] = parameters[3];
        break;
      case 122: // z: identity stamp
        if (parameters.length !== 6) throw new Error('Malformed identity stamp.');
        args[4] = parameters[1];
        break;
      case 111: case 105: case 97: case 109: break; // o, i, a, m retain state
      default: throw new Error('Unsupported vault transition.');
    }
  }
  const successor = outer.program.curry([outer.args[0], inner.program.curry(args)]);
  if (!equal(successor.treeHash(), currentPuzzleHash)) {
    throw new Error('Reconstructed output does not match the current chain coin. Refresh chain status.');
  }
  return successor.serialize();
}
