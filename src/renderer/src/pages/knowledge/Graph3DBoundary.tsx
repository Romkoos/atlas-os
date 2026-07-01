import { Component, type ReactNode } from 'react'

interface Graph3DBoundaryProps {
  children: ReactNode
  onError: () => void
}

interface Graph3DBoundaryState {
  failed: boolean
}

// Class component required: React error boundaries have no hook equivalent.
// Catches lazy-chunk load rejection and three/WebGL throws from Galaxy3D,
// reverting the parent tab back to the 2D view.
export class Graph3DBoundary extends Component<Graph3DBoundaryProps, Graph3DBoundaryState> {
  state: Graph3DBoundaryState = { failed: false }

  static getDerivedStateFromError(): Graph3DBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.error(error)
    this.props.onError()
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <div className="kb-graph-empty">{'// 3D view unavailable — reverting to 2D…'}</div>
    }
    return this.props.children
  }
}
