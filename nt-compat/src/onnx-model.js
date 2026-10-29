'use strict';

/**
 * NT-COMPAT — construction de mini-modèles ONNX (protobuf manuel, sans
 * dépendance). Modèle Gemm : Y = X·W (carré n×n, fp32), opset 13.
 * Champs ONNX : Model(1=ir,2=producer,7=graph,8=opset) ;
 * Graph(1=node,2=name,5=init,11=input,12=output) ; Node(1=in,2=out,3=name,4=op) ;
 * ValueInfo(1=name,2=type) ; Type(1=tensor) ; TensorType(1=elem,2=shape) ;
 * Shape(1=dim) ; Dim(1=value) ; Tensor(1=dims,2=dtype,8=name,9=raw).
 * Le .onnx n'est JAMAIS versionné : régénéré en mémoire à chaque usage.
 */

function u32(n) {
  const b = [];
  do {
    let x = n & 0x7f;
    n >>>= 7;
    if (n) x |= 0x80;
    b.push(x);
  } while (n);
  return Buffer.from(b);
}
function tag(f, w) {
  return u32((f << 3) | w);
}
function bytes(f, b) {
  return Buffer.concat([tag(f, 2), u32(b.length), b]);
}
function str(f, s) {
  return bytes(f, Buffer.from(s, 'utf8'));
}
function vint(f, v) {
  return Buffer.concat([tag(f, 0), u32(v)]);
}
function valueInfo(field, name, r, c) {
  const dims = [];
  for (const d of [r, c]) dims.push(bytes(1, vint(1, d)));
  const shape = bytes(2, Buffer.concat(dims));
  const ttype = bytes(1, Buffer.concat([vint(1, 1), shape])); // FLOAT=1
  return bytes(field, Buffer.concat([str(1, name), bytes(2, ttype)]));
}
function initializer(name, w2d) {
  const r = w2d.length;
  const c = w2d[0].length;
  const dims = [];
  for (const d of [r, c]) dims.push(Buffer.concat([tag(1, 0), u32(d)]));
  const data = Buffer.alloc(4 * r * c);
  for (let i = 0; i < r; i++) {
    if (w2d[i].length !== c) throw new Error('onnx-model: lignes irrégulières');
    for (let j = 0; j < c; j++) {
      const v = Number(w2d[i][j]);
      if (!Number.isFinite(v)) throw new Error('onnx-model: valeur non finie');
      data.writeFloatLE(v, 4 * (i * c + j));
    }
  }
  return bytes(5, Buffer.concat([Buffer.concat(dims), vint(2, 1), str(8, name), bytes(9, data)]));
}

/** Y = X·W, W matrice carrée n×n (1..256). Retourne le Buffer .onnx. */
function buildGemmModel(w2d) {
  const n = w2d.length;
  if (!Number.isInteger(n) || n < 1 || n > 256 || w2d[0].length !== n) {
    throw new Error(`onnx-model: W carrée 1..256 requise (reçu ${n}×${w2d[0] && w2d[0].length})`);
  }
  const node = bytes(1, Buffer.concat([
    str(1, 'X'), str(1, 'W'), str(2, 'Y'), str(3, 'gemm1'), str(4, 'Gemm'),
  ]));
  const graph = Buffer.concat([
    node,
    str(2, 'snapmesh-gemm'),
    valueInfo(11, 'X', n, n),
    valueInfo(12, 'Y', n, n),
    initializer('W', w2d),
  ]);
  const opset = bytes(8, Buffer.concat([str(1, ''), vint(2, 13)]));
  return Buffer.concat([vint(1, 7), str(2, 'snapmesh-nt-compat'), opset, bytes(7, graph)]);
}

module.exports = { buildGemmModel };
