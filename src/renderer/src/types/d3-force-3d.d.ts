// Minimal typings for the subset of d3-force-3d we use. The library mirrors
// d3-force with a third (z) dimension. Accessors are a constant or a per-node
// function. No official @types package exists.
declare module 'd3-force-3d' {
  type Accessor = number | ((node: any, i: number, nodes: any[]) => number)

  interface PositionForce {
    (alpha: number): void
    strength(s: Accessor): this
    x(x: Accessor): this
    y(y: Accessor): this
    z(z: Accessor): this
  }

  interface CollideForce {
    (alpha: number): void
    radius(r: Accessor): this
    strength(s: number): this
    iterations(n: number): this
  }

  export function forceX(x?: Accessor): PositionForce
  export function forceY(y?: Accessor): PositionForce
  export function forceZ(z?: Accessor): PositionForce
  export function forceCollide(radius?: Accessor): CollideForce
}
