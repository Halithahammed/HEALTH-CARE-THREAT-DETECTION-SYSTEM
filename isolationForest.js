class IsolationTree {
  constructor(maxDepth = 8) { this.maxDepth = maxDepth; this.root = null; }
  fit(rows) { this.root = this._build(rows, 0); }
  _build(rows, depth) {
    if (!rows.length || depth >= this.maxDepth || rows.length <= 1) return { size: rows.length, leaf: true };
    const featureCount = rows[0].length;
    const candidates = [];
    for (let f = 0; f < featureCount; f++) {
      let min = Infinity, max = -Infinity;
      for (const r of rows) { min = Math.min(min, r[f]); max = Math.max(max, r[f]); }
      if (max > min) candidates.push({ f, min, max });
    }
    if (!candidates.length) return { size: rows.length, leaf: true };
    const c = candidates[Math.floor(Math.random() * candidates.length)];
    const split = c.min + Math.random() * (c.max - c.min);
    const left = rows.filter(r => r[c.f] < split);
    const right = rows.filter(r => r[c.f] >= split);
    if (!left.length || !right.length) return { size: rows.length, leaf: true };
    return { leaf: false, feature: c.f, split, left: this._build(left, depth + 1), right: this._build(right, depth + 1) };
  }
  pathLength(row) {
    let node = this.root, depth = 0;
    while (node && !node.leaf) { node = row[node.feature] < node.split ? node.left : node.right; depth++; }
    return depth + IsolationForest.c(node?.size || 1);
  }
}

class IsolationForest {
  constructor({ trees = 80, sampleSize = 256 } = {}) { this.treeCount = trees; this.sampleSize = sampleSize; this.trees = []; this.fittedSize = 0; }
  static c(n) {
    if (n <= 1) return 0;
    if (n === 2) return 1;
    const h = Math.log(n - 1) + 0.5772156649;
    return 2 * h - (2 * (n - 1)) / n;
  }
  fit(rows) {
    if (!rows || rows.length < 10) throw new Error('At least 10 samples are required');
    this.trees = [];
    const size = Math.min(this.sampleSize, rows.length);
    const maxDepth = Math.ceil(Math.log2(size));
    for (let i = 0; i < this.treeCount; i++) {
      const shuffled = rows.slice().sort(() => Math.random() - 0.5).slice(0, size);
      const tree = new IsolationTree(maxDepth); tree.fit(shuffled); this.trees.push(tree);
    }
    this.fittedSize = size;
    return this;
  }
  score(row) {
    if (!this.trees.length) throw new Error('Model not trained');
    const avgPath = this.trees.reduce((s, t) => s + t.pathLength(row), 0) / this.trees.length;
    return Math.pow(2, -avgPath / IsolationForest.c(this.fittedSize));
  }
}
module.exports = IsolationForest;
